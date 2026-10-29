-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- All synthetic records and fixture-scoped failure injection roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'FAIL accepted forbidden operation: %',statement;
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('63000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values(pg_temp.id(1),'outbox-owner@example.test'),(pg_temp.id(2),'outbox-admin@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(3),'Confirmation outbox','confirmation-outbox-test','UTC','USD'),
 (pg_temp.id(4),'Foreign tenant','confirmation-outbox-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER');
insert into public.platform_admins(user_id) values(pg_temp.id(2));
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,rental) values
 (pg_temp.id(5),pg_temp.id(3),'Simple','simple','USD',100,60,null),
 (pg_temp.id(6),pg_temp.id(3),'Rental','rental','USD',0,60,'{"periodMinutes":60,"pricePerPeriod":100,"minPeriods":1,"maxPeriods":8,"depositAmount":50}');
insert into public.resources(id,tenant_id,name,kind,capacity,active) values(pg_temp.id(7),pg_temp.id(3),'Rental vehicle','vehicle',1,true);
insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values(pg_temp.id(3),pg_temp.id(6),pg_temp.id(7),1);
create function pg_temp.seed(n integer,is_rental boolean,with_payment boolean default true) returns void language plpgsql as $$
declare slot timestamptz:='2035-01-01T10:00Z'::timestamptz+make_interval(days=>n);
begin
 insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end)
 values(pg_temp.id(n),pg_temp.id(3),pg_temp.id(n)::text,pg_temp.id(n)::text,
  case when is_rental then jsonb_build_object('serviceId',pg_temp.id(6),'itemQuantities','{}'::jsonb,'addonIds','[]'::jsonb,'answers','{}'::jsonb,'rentalPeriods',3)
   else jsonb_build_object('serviceId',pg_temp.id(5)) end,
  case when is_rental then '{"total":{"amount":300,"currency":"USD"},"deposit":{"amount":50,"currency":"USD"}}'::jsonb
   else '{"total":{"amount":100,"currency":"USD"}}'::jsonb end,
  slot,slot+make_interval(hours=>case when is_rental then 3 else 1 end));
 if with_payment then
  insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
  values(pg_temp.id(n+100),pg_temp.id(3),pg_temp.id(n),'staging_mock',pg_temp.id(n+100)::text,'succeeded',case when is_rental then 350 else 100 end,'USD');
 end if;
 if is_rental then
  insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity)
  values(pg_temp.id(3),pg_temp.id(7),pg_temp.id(n),slot,slot+interval '3 hours',pg_temp.id(n)::text,'held',clock_timestamp()+interval '5 minutes',1);
 else
  insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
  values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(n),slot,slot+interval '1 hour',pg_temp.id(n)::text,'active',clock_timestamp()+interval '5 minutes');
 end if;
end$$;
select pg_temp.seed(10,false),pg_temp.seed(11,true),pg_temp.seed(12,false,false),pg_temp.seed(13,true,false),pg_temp.seed(14,false),pg_temp.seed(15,false),pg_temp.seed(16,false);

-- No new grants: browsers, owners and platform administrators cannot confirm,
-- inspect the queue, or invoke enqueue. Service callers still cannot fabricate
-- a confirmed event using the generic enqueue RPC or raw queue DML.
create function pg_temp.browser_denials() returns void language plpgsql as $$
begin
 perform pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(110))','42501');
 perform pg_temp.reject('select * from public.durable_outbox','42501');
 perform pg_temp.reject($q$select public.outbox_enqueue(pg_temp.id(3),pg_temp.id(10),'booking.confirmed',pg_temp.id(10))$q$,'42501');
end$$;
set local role anon;
select pg_temp.browser_denials();
reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.browser_denials();
reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.browser_denials();
reset role;
set local role service_role;
select pg_temp.reject('select * from public.durable_outbox','42501');
select pg_temp.reject('update public.durable_outbox set state=''completed''','42501');
select pg_temp.reject($q$select public.outbox_enqueue(pg_temp.id(3),pg_temp.id(10),'booking.confirmed',pg_temp.id(10))$q$,'22023');
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(110))->>'replayed'='false','simple first confirmation');
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(111))->>'replayed'='false','rental first confirmation');
reset role;
select pg_temp.assert(count(*)=2 and bool_and(event_type='booking.confirmed' and tenant_id=pg_temp.id(3) and dedup_key=booking_id and payload='{}'::jsonb and state='ready' and attempts=0 and max_attempts=5 and generation=0 and lease_token is null and lease_until is null and completed_at is null and last_failure is null),'exact tenant-bound empty envelopes') from public.durable_outbox where tenant_id=pg_temp.id(3);
select pg_temp.assert(state='confirmed' and payment_id=pg_temp.id(110),'simple confirmed and linked') from public.bookings where id=pg_temp.id(10);
select pg_temp.assert(status='consumed','simple hold consumed') from public.capacity_holds where booking_id=pg_temp.id(10);
select pg_temp.assert(state='confirmed' and payment_id=pg_temp.id(111),'rental confirmed and linked') from public.bookings where id=pg_temp.id(11);
select pg_temp.assert(status='consumed','rental reservation consumed') from public.resource_reservations where booking_id=pg_temp.id(11);
create temp table confirmed_envelopes as select * from public.durable_outbox where tenant_id=pg_temp.id(3);
set local role service_role;
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(110))->>'replayed'='true','simple replay');
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(111))->>'replayed'='true','rental replay');
reset role;
select pg_temp.assert(not exists((select * from public.durable_outbox where tenant_id=pg_temp.id(3) except select * from confirmed_envelopes) union all (select * from confirmed_envelopes except select * from public.durable_outbox where tenant_id=pg_temp.id(3))),'replay preserves complete envelope state');
select pg_temp.assert(count(*)=2 and bool_and(state='succeeded'),'confirmation never changes persisted financial evidence') from public.payments where id in(pg_temp.id(110),pg_temp.id(111));
select pg_temp.reject($q$insert into public.durable_outbox(tenant_id,booking_id,event_type,dedup_key) values(pg_temp.id(3),pg_temp.id(10),'booking.confirmed',pg_temp.id(999))$q$,'23505');
select pg_temp.reject($q$insert into public.durable_outbox(tenant_id,booking_id,event_type,dedup_key) values(pg_temp.id(4),pg_temp.id(10),'booking.confirmed',pg_temp.id(999))$q$,'23503');
select pg_temp.reject($q$insert into public.durable_outbox(tenant_id,booking_id,event_type,dedup_key,payload) values(pg_temp.id(3),pg_temp.id(14),'booking.confirmed',pg_temp.id(999),'{"email":"private@example.test"}')$q$,'23514');
select pg_temp.reject($q$insert into public.durable_outbox(tenant_id,booking_id,event_type,dedup_key) values(pg_temp.id(3),pg_temp.id(14),'payment.succeeded',pg_temp.id(999))$q$,'23514');

-- A historical confirmed booking has no event. Replay must not create one.
update public.capacity_holds set status='consumed' where booking_id=pg_temp.id(14);
update public.bookings set state='pending_payment' where id=pg_temp.id(14);
update public.bookings set state='confirmed',payment_id=pg_temp.id(114) where id=pg_temp.id(14);
set local role service_role;
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(114))->>'replayed'='true','historical confirmed replay');
reset role;
select pg_temp.assert(count(*)=0,'no historical backfill') from public.durable_outbox where booking_id=pg_temp.id(14);
update public.payments set tenant_id=pg_temp.id(4) where id=pg_temp.id(115);
set local role service_role;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(115))','22023');
reset role;
select pg_temp.assert(count(*)=0,'foreign payment cannot enqueue') from public.durable_outbox where booking_id=pg_temp.id(15);

-- Enqueue failure is deliberately injected after hold consumption and booking
-- mutation. Both service and rental payment-write transactions must fully abort.
create function pg_temp.fail_confirmation_enqueue() returns trigger language plpgsql as $$
begin if new.event_type='booking.confirmed' and new.tenant_id=pg_temp.id(3) and new.booking_id in(pg_temp.id(12),pg_temp.id(13)) then raise exception 'fixture enqueue failure' using errcode='23514';end if;return new;end$$;
create trigger confirmation_outbox_fixture_failure before insert on public.durable_outbox for each row execute function pg_temp.fail_confirmation_enqueue();
create function pg_temp.pay_and_confirm(n integer,is_rental boolean) returns void language plpgsql as $$
begin
 insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(n+100),pg_temp.id(3),pg_temp.id(n),'staging_mock',pg_temp.id(n+100)::text,'succeeded',case when is_rental then 350 else 100 end,'USD');
 perform public.confirm_succeeded_payment(pg_temp.id(n+100));
end$$;
select pg_temp.reject('select pg_temp.pay_and_confirm(12,false)','23514');
select pg_temp.reject('select pg_temp.pay_and_confirm(13,true)','23514');
drop trigger confirmation_outbox_fixture_failure on public.durable_outbox;
select pg_temp.assert(count(*)=2 and bool_and(state='draft' and payment_id is null),'enqueue failure rolls back booking and payment link') from public.bookings where id in(pg_temp.id(12),pg_temp.id(13));
select pg_temp.assert(count(*)=0,'enqueue failure rolls back new payment evidence') from public.payments where booking_id in(pg_temp.id(12),pg_temp.id(13));
select pg_temp.assert(status='active','enqueue failure restores simple hold') from public.capacity_holds where booking_id=pg_temp.id(12);
select pg_temp.assert(status='held','enqueue failure restores rental reservation') from public.resource_reservations where booking_id=pg_temp.id(13);
select pg_temp.assert(count(*)=2 and bool_and(to_state='draft'),'enqueue failure restores state history') from public.booking_state_history where booking_id in(pg_temp.id(12),pg_temp.id(13));
select pg_temp.assert(count(*)=0,'enqueue failure leaves no confirmation envelope') from public.durable_outbox where booking_id in(pg_temp.id(12),pg_temp.id(13));

-- A colliding requested-event key cannot be silently accepted as confirmation.
select public.outbox_enqueue(pg_temp.id(3),pg_temp.id(16),'booking.requested',pg_temp.id(16));
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(116))','23505');
select pg_temp.assert(state='draft' and payment_id is null,'dedup collision aborts confirmation') from public.bookings where id=pg_temp.id(16);
select pg_temp.assert(status='active','dedup collision restores hold') from public.capacity_holds where booking_id=pg_temp.id(16);
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'forced RLS unchanged') from pg_class where oid='public.durable_outbox'::regclass;
rollback;
\echo 'confirmation outbox tests PASS (fixtures rolled back)'
