begin;
create function pg_temp.assert(v boolean,msg text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL %',msg;end if;end$$;
create function pg_temp.reject(q text,fragment text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(fragment in sqlerrm)=0 then raise exception 'FAIL wrong denial %',sqlerrm;end if;return;end;
 raise exception 'FAIL accepted %',q;end$$;
create function pg_temp.id(n int) returns uuid language sql immutable as $$select ('a1040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.tenants(id,name,slug,timezone,currency) values
(pg_temp.id(1),'Intent A','intent-a','UTC','USD'),(pg_temp.id(2),'Intent B','intent-b','UTC','USD');
insert into public.payment_connections(tenant_id,provider,status,account_id,charges_enabled) values
(pg_temp.id(1),'stripe_connect','connected','acct_intentAAA',true),(pg_temp.id(2),'stripe_connect','connected','acct_intentBBB',true);
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key)
select pg_temp.id(n),pg_temp.id(case when n=24 then 2 else 1 end),'INTENT'||n,now(),now()+interval '1 hour','intent-request-booking-'||n from generate_series(20,25) n;
create temp table fixture(n int primary key,attempt uuid);
grant select on fixture to service_role;
insert into fixture select n,(public.bind_booking_payment_source(pg_temp.id(case when n=24 then 2 else 1 end),pg_temp.id(n),
 (public.register_payment_source_scope(pg_temp.id(case when n=24 then 2 else 1 end),'acct_platformA',n=23)).id)).id from generate_series(20,25) n;
select pg_temp.assert(not has_table_privilege(r,t,v),'no direct ledger access') from unnest(array['anon','authenticated','service_role']) r,
unnest(array['public.payment_attempt_requests','public.payment_attempt_intents']) t,unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) v;
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'forced RLS') from pg_class where oid in('public.payment_attempt_requests'::regclass,'public.payment_attempt_intents'::regclass);
select pg_temp.assert(count(*)=0,'no policies') from pg_policy where polrelid in('public.payment_attempt_requests'::regclass,'public.payment_attempt_intents'::regclass);
set local role anon;
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(null,null,100,'USD')$q$,'permission denied');
reset role;
set local role authenticated;
select pg_temp.reject($q$select public.associate_payment_attempt_intent(null,null,'x',null,null,false,100,'USD')$q$,'permission denied');
reset role;
set local role service_role;
select pg_temp.reject($q$select * from public.payment_attempt_intents$q$,'permission denied');
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(2),(select attempt from fixture where n=20),100,'USD')$q$,'PAYMENT_ATTEMPT_NOT_FOUND');
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=20),0,'USD')$q$,'INVALID_PAYMENT_REQUEST');
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=20),9007199254740992,'USD')$q$,'INVALID_PAYMENT_REQUEST');
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=20),100,'usd')$q$,'INVALID_PAYMENT_REQUEST');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',false,100,'USD')$q$,'PAYMENT_REQUEST_REQUIRED');
select public.snapshot_payment_attempt_request(pg_temp.id(case when n=24 then 2 else 1 end),attempt,100,'USD') from fixture where n<>25;
select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=20),100,'USD');
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=20),101,'USD')$q$,'PAYMENT_REQUEST_CONFLICT');
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=20),100,'EUR')$q$,'PAYMENT_REQUEST_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(2),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',false,100,'USD')$q$,'PAYMENT_ATTEMPT_NOT_FOUND');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformB','acct_intentAAA',false,100,'USD')$q$,'PAYMENT_SOURCE_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentBBB',false,100,'USD')$q$,'PAYMENT_SOURCE_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',null,100,'USD')$q$,'PAYMENT_SOURCE_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',true,100,'USD')$q$,'PAYMENT_SOURCE_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',false,101,'USD')$q$,'PAYMENT_REQUEST_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',false,100,'EUR')$q$,'PAYMENT_REQUEST_CONFLICT');
select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',false,100,'USD');
select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_same','acct_platformA','acct_intentAAA',false,100,'USD');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=20),'pi_changed','acct_platformA','acct_intentAAA',false,100,'USD')$q$,'PAYMENT_INTENT_CONFLICT');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=21),'pi_same','acct_platformA','acct_intentAAA',false,100,'USD')$q$,'PAYMENT_INTENT_CONFLICT');
-- Identical intent ID is safe to represent in distinct mode and account scopes.
select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=23),'pi_same','acct_platformA','acct_intentAAA',true,100,'USD');
select public.associate_payment_attempt_intent(pg_temp.id(2),(select attempt from fixture where n=24),'pi_same','acct_platformA','acct_intentBBB',false,100,'USD');
reset role;
select pg_temp.assert(count(*)=3,'three scoped associations, not global intent collision') from public.payment_attempt_intents where provider_intent_id='pi_same';
select pg_temp.reject($q$update public.payment_attempt_requests set amount=102$q$,'PAYMENT_SOURCE_IMMUTABLE');
select pg_temp.reject($q$delete from public.payment_attempt_intents$q$,'PAYMENT_SOURCE_IMMUTABLE');
update public.payment_connections set status='revoked',charges_enabled=false,blocked_reason='credentials_invalid' where tenant_id=pg_temp.id(1);
update public.payment_connections set account_id='acct_reconnectA',status='connected',charges_enabled=true,blocked_reason=null where tenant_id=pg_temp.id(1);
set local role service_role;
-- Observation of original attempt remains valid after reconnect, never re-routed.
select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=22),'pi_after_reconnect','acct_platformA','acct_intentAAA',false,100,'USD');
select pg_temp.reject($q$select public.associate_payment_attempt_intent(pg_temp.id(1),(select attempt from fixture where n=22),'pi_after_reconnect','acct_platformA','acct_reconnectA',false,100,'USD')$q$,'PAYMENT_SOURCE_CONFLICT');
reset role;
insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,amount,currency) values(pg_temp.id(1),pg_temp.id(25),'staging_mock','mock-untouched',100,'USD');
set local role service_role;
select pg_temp.reject($q$select public.snapshot_payment_attempt_request(pg_temp.id(1),(select attempt from fixture where n=25),100,'USD')$q$,'PAYMENT_SOURCE_LEGACY_OR_TERMINAL');
reset role;
select pg_temp.assert(count(*)=1 and min(provider)='staging_mock' and min(state)='requires_payment','no payment mutations') from public.payments where tenant_id in(pg_temp.id(1),pg_temp.id(2));
rollback;
