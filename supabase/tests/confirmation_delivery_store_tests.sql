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

-- Store tests are disposable loopback only, NEVER hosted. Fixture transaction rolls back.
select public.confirm_succeeded_payment(pg_temp.id(110)),public.confirm_succeeded_payment(pg_temp.id(111));
select pg_temp.assert(count(*)=0,'no historical receipt backfill') from public.confirmation_delivery_receipts where tenant_id=pg_temp.id(3);
select public.outbox_enqueue(pg_temp.id(3),pg_temp.id(12),'booking.requested',pg_temp.id(212));
select public.outbox_enqueue(pg_temp.id(3),pg_temp.id(13),'booking.changed',pg_temp.id(213));
-- Both exhausted and reclaimable expired unrelated events must remain exact.
update public.durable_outbox set state='leased',attempts=5,generation=1,lease_token=pg_temp.id(900),lease_until=clock_timestamp()-interval '1 minute' where tenant_id=pg_temp.id(3) and event_type='booking.requested';
update public.durable_outbox set state='leased',attempts=1,generation=1,lease_token=pg_temp.id(901),lease_until=clock_timestamp()-interval '1 minute' where tenant_id=pg_temp.id(3) and event_type='booking.changed';
create temp table unrelated_before as select * from public.durable_outbox where tenant_id=pg_temp.id(3) and event_type<>'booking.confirmed';
create function pg_temp.store_denials() returns void language plpgsql as $$
begin
 perform pg_temp.reject('select * from public.confirmation_delivery_receipts','42501');
 perform pg_temp.reject('select public.outbox_lease_confirmed(pg_temp.id(3))','42501');
 perform pg_temp.reject('select public.outbox_confirmation_current(pg_temp.id(3),pg_temp.id(10),pg_temp.id(10),pg_temp.id(900),1)','42501');
 perform pg_temp.reject($q$select public.outbox_confirmation_delivered(pg_temp.id(3),pg_temp.id(10),'email')$q$,'42501');
 perform pg_temp.reject($q$select public.outbox_confirmation_record(pg_temp.id(3),pg_temp.id(10),pg_temp.id(10),pg_temp.id(900),1,'email')$q$,'42501');
end$$;
set local role anon;select pg_temp.store_denials();reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;select pg_temp.store_denials();reset role;
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;select pg_temp.store_denials();reset role;
set local role service_role;
select pg_temp.reject('select * from public.confirmation_delivery_receipts','42501');
select pg_temp.reject($q$insert into public.confirmation_delivery_receipts values(pg_temp.id(3),pg_temp.id(10),'email',clock_timestamp())$q$,'42501');
select pg_temp.reject('update public.confirmation_delivery_receipts set delivered_at=clock_timestamp()','42501');
select pg_temp.reject('delete from public.confirmation_delivery_receipts','42501');
reset role;
create temp table store_leases as select * from public.outbox_lease_confirmed(pg_temp.id(3),10,60);
grant select on store_leases to service_role;
select pg_temp.assert(count(*)=2 and bool_and(event_type='booking.confirmed' and attempts=1 and generation=1),'filtered lease only confirmed') from store_leases;
select pg_temp.assert(not exists((select * from public.durable_outbox where tenant_id=pg_temp.id(3) and event_type<>'booking.confirmed' except select * from unrelated_before) union all (select * from unrelated_before except select * from public.durable_outbox where tenant_id=pg_temp.id(3) and event_type<>'booking.confirmed')),'unrelated expired/exhausted rows unchanged');
set local role service_role;
select pg_temp.assert(public.outbox_confirmation_current(tenant_id,booking_id,id,lease_token,generation),'current lease') from store_leases;
select pg_temp.assert(not public.outbox_confirmation_current(pg_temp.id(4),booking_id,id,lease_token,generation),'foreign current denied') from store_leases;
select pg_temp.assert(not public.outbox_confirmation_record(pg_temp.id(4),booking_id,id,lease_token,generation,'email'),'foreign record denied') from store_leases;
select pg_temp.assert(not public.outbox_confirmation_record(tenant_id,booking_id,id,pg_temp.id(999),generation,'email'),'wrong token denied') from store_leases;
select pg_temp.assert(not public.outbox_confirmation_record(tenant_id,booking_id,id,lease_token,generation+1,'email'),'wrong generation denied') from store_leases;
select pg_temp.assert(public.outbox_confirmation_record(tenant_id,booking_id,id,lease_token,generation,'email'),'record success') from store_leases;
select pg_temp.assert(public.outbox_confirmation_record(tenant_id,booking_id,id,lease_token,generation,'email'),'same receipt replay') from store_leases;
select pg_temp.assert(public.outbox_confirmation_delivered(tenant_id,booking_id,'email') and not public.outbox_confirmation_delivered(tenant_id,booking_id,'sms'),'channel-specific durable read') from store_leases;
select pg_temp.assert(not public.outbox_confirmation_delivered(pg_temp.id(4),booking_id,'email'),'foreign read reveals no receipt') from store_leases;
select pg_temp.reject($q$select public.outbox_confirmation_record(pg_temp.id(3),pg_temp.id(10),pg_temp.id(10),pg_temp.id(900),1,'push')$q$,'22023');
reset role;
select pg_temp.assert(count(*)=2,'one receipt per logical channel') from public.confirmation_delivery_receipts where tenant_id=pg_temp.id(3);
create temp table receipts_before as select * from public.confirmation_delivery_receipts where tenant_id=pg_temp.id(3);
select public.outbox_retry(tenant_id,id,lease_token,generation,'transient') from store_leases;
update public.durable_outbox set available_at=clock_timestamp()-interval '1 minute' where tenant_id=pg_temp.id(3) and event_type='booking.confirmed';
create temp table store_reclaimed as select * from public.outbox_lease_confirmed(pg_temp.id(3),10,60);
select pg_temp.assert(generation=2 and attempts=2,'retry generation advances') from store_reclaimed;
select pg_temp.assert(not public.outbox_confirmation_record(tenant_id,booking_id,id,lease_token,generation,'sms'),'old worker fenced after reclaim') from store_leases;
select pg_temp.assert(not exists((select * from public.confirmation_delivery_receipts where tenant_id=pg_temp.id(3) except select * from receipts_before) union all (select * from receipts_before except select * from public.confirmation_delivery_receipts where tenant_id=pg_temp.id(3))),'receipt persists unchanged after retry/replay');
update public.durable_outbox set lease_until=clock_timestamp()-interval '1 minute',attempts=max_attempts where tenant_id=pg_temp.id(3) and event_type='booking.confirmed';
select pg_temp.assert(not public.outbox_confirmation_record(tenant_id,booking_id,id,lease_token,generation,'sms'),'expired record denied') from store_reclaimed;
select pg_temp.assert(count(*)=0,'exhausted expired confirmed not leased') from public.outbox_lease_confirmed(pg_temp.id(3),10,60);
select pg_temp.assert(count(*)=2 and bool_and(state='dead' and last_failure='lease_expired'),'only confirmed exhausted rows dead') from public.durable_outbox where tenant_id=pg_temp.id(3) and event_type='booking.confirmed';
select pg_temp.assert(not exists((select * from public.durable_outbox where tenant_id=pg_temp.id(3) and event_type<>'booking.confirmed' except select * from unrelated_before) union all (select * from unrelated_before except select * from public.durable_outbox where tenant_id=pg_temp.id(3) and event_type<>'booking.confirmed')),'unrelated rows still exact after exhaustion sweep');
select pg_temp.reject($q$insert into public.confirmation_delivery_receipts values(pg_temp.id(4),pg_temp.id(10),'sms',clock_timestamp())$q$,'23503');
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'forced receipt RLS') from pg_class where oid='public.confirmation_delivery_receipts'::regclass;
select pg_temp.assert(count(*)=4,'receipt columns contain no payload or provider identifiers') from information_schema.columns where table_schema='public' and table_name='confirmation_delivery_receipts';
rollback;
\echo 'confirmation delivery store tests PASS (fixtures rolled back)'