\set ON_ERROR_STOP on
begin;
\ir group_lifecycle_fixture.sql
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a2800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(p boolean,label text) returns void language plpgsql as $$begin if p is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'EXPECTED %',code;end$$;
select pg_temp.fixture_parents(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7));
select pg_temp.fixture_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(8),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7),1,clock_timestamp()+interval '120 seconds');
set constraints all immediate;
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end)
select pg_temp.id(n),pg_temp.id(2),'FBOUND-'||n,'financial-boundary-fixture-'||n,jsonb_build_object('serviceId',pg_temp.id(4)),'2035-01-01T10:00Z','2035-01-01T11:00Z' from generate_series(20,23)n;
set local role service_role;
-- Ordinary server-owned bookkeeping remains available for non-managed bookings.
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(30),pg_temp.id(2),pg_temp.id(20),'fake','financial-boundary',1,'USD');
insert into public.refunds(id,tenant_id,booking_id,payment_id,amount,currency) values(pg_temp.id(31),pg_temp.id(2),pg_temp.id(20),pg_temp.id(30),1,'USD');
update public.bookings set payment_id=pg_temp.id(30) where id=pg_temp.id(20);
select pg_temp.reject($q$insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(2),pg_temp.id(3),'fake','denied-held',1,'USD')$q$,'0A000');
select pg_temp.reject($q$insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values(pg_temp.id(2),pg_temp.id(3),pg_temp.id(30),1,'USD')$q$,'0A000');
select pg_temp.reject('update public.payments set booking_id=pg_temp.id(3) where id=pg_temp.id(30)','0A000');
select pg_temp.reject('update public.refunds set booking_id=pg_temp.id(3) where id=pg_temp.id(31)','0A000');
-- Use an otherwise unused payment so the native UNIQUE link cannot mask guard.
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(32),pg_temp.id(2),pg_temp.id(21),'fake','financial-other',1,'USD');
select pg_temp.reject('update public.bookings set payment_id=pg_temp.id(32) where id=pg_temp.id(3)','0A000');
select public.release_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(8),1);
select pg_temp.reject('update public.payments set booking_id=pg_temp.id(3) where id=pg_temp.id(32)','0A000');
select pg_temp.reject('update public.bookings set payment_id=pg_temp.id(32) where id=pg_temp.id(3)','0A000');
select pg_temp.reject($q$insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values(pg_temp.id(2),pg_temp.id(3),pg_temp.id(32),1,'USD')$q$,'0A000');
select pg_temp.reject('select lumin.group_financial_fence()','42501');
reset role;
-- First association rejects financial history; native constraints stay intact.
set constraints all deferred;
select pg_temp.reject('insert into public.allocation_group_heads values(pg_temp.id(2),pg_temp.id(40),pg_temp.id(20),1)','0A000');
select pg_temp.reject('insert into public.allocation_group_heads values(pg_temp.id(2),pg_temp.id(41),pg_temp.id(21),1)','0A000');
-- Refund-only and booking-link-only history independently prevent first head.
insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values(pg_temp.id(2),pg_temp.id(22),pg_temp.id(32),1,'USD');
select pg_temp.reject('insert into public.allocation_group_heads values(pg_temp.id(2),pg_temp.id(43),pg_temp.id(22),1)','0A000');
update public.bookings set payment_id=pg_temp.id(32) where id=pg_temp.id(23);
select pg_temp.reject('insert into public.allocation_group_heads values(pg_temp.id(2),pg_temp.id(44),pg_temp.id(23),1)','0A000');
update public.bookings set payment_id=null where id=pg_temp.id(23);
-- Terminal expired generation retains the same financial exclusion.
select pg_temp.fixture_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(8),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7),2,clock_timestamp()-interval '1 second');
select public.release_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(8),2);
set constraints all immediate;
set local role service_role;
select pg_temp.reject($q$insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(2),pg_temp.id(3),'fake','denied-expired',1,'USD')$q$,'0A000');
reset role;
set constraints all deferred;
-- Mismatched tenant labels do not hide the globally identified booking.
insert into public.tenants(id,name,slug,timezone,currency) values(pg_temp.id(70),'Other fixture','financial-other-fixture','UTC','USD');
set local role service_role;
select pg_temp.reject($q$insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(70),pg_temp.id(3),'fake','denied-other-label',1,'USD')$q$,'0A000');
reset role;
-- A later BEFORE trigger cannot hide the final financial/booking association.
create function pg_temp.rewrite_payment() returns trigger language plpgsql as $$begin new.booking_id:=pg_temp.id(3);return new;end$$;
create trigger zz_review_rewrite before insert on public.payments for each row execute function pg_temp.rewrite_payment();
set local role service_role;
select pg_temp.reject($q$insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(2),pg_temp.id(22),'fake','rewritten',1,'USD')$q$,'0A000');
reset role;
drop trigger zz_review_rewrite on public.payments;
create function pg_temp.rewrite_head() returns trigger language plpgsql as $$begin new.booking_id:=pg_temp.id(21);return new;end$$;
create trigger zz_review_rewrite before insert on public.allocation_group_heads for each row execute function pg_temp.rewrite_head();
select pg_temp.reject('insert into public.allocation_group_heads values(pg_temp.id(2),pg_temp.id(42),pg_temp.id(22),1)','0A000');
drop trigger zz_review_rewrite on public.allocation_group_heads;
-- Hidden payment-column update reaches AFTER guard despite absent UPDATE OF.
create function pg_temp.rewrite_link() returns trigger language plpgsql as $$begin if new.id=pg_temp.id(3) then new.payment_id:=pg_temp.id(32);end if;return new;end$$;
create trigger zz_review_rewrite before update on public.bookings for each row execute function pg_temp.rewrite_link();
set local role service_role;
select pg_temp.reject('update public.bookings set notes=''fixture'' where id=pg_temp.id(3)','0A000');
reset role;
drop trigger zz_review_rewrite on public.bookings;
-- Existing native SET NULL and refund cascades remain for ordinary payments.
set local role service_role;
delete from public.payments where id=pg_temp.id(30);
select pg_temp.ok((select payment_id is null from public.bookings where id=pg_temp.id(20)) and not exists(select 1 from public.refunds where id=pg_temp.id(31)),'nongroup delete cascades retained');
reset role;
select pg_temp.reject('truncate public.payments cascade','0A000');
select pg_temp.ok((select count(*)=1 from public.allocation_group_heads) and(select count(*)=1 from public.payments) and(select payment_id is null and state='draft' from public.bookings where id=pg_temp.id(3)),'failed statements retain group and ordinary bookkeeping');
rollback;
begin isolation level repeatable read;
set local role service_role;
do $$begin
 begin update public.payments set amount=amount where false;raise exception 'RR accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;
 begin update public.refunds set amount=amount where false;raise exception 'RR accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;
 begin update public.bookings set payment_id=payment_id where false;raise exception 'RR accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;
 -- Unrelated booking update gets no new statement-level restriction.
 update public.bookings set notes=notes where false;
end$$;
rollback;
\echo GROUP FINANCIAL BOUNDARY TESTS PASS
