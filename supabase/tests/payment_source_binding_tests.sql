begin;
create function pg_temp.assert(v boolean,msg text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',msg;end if;end$$;
create function pg_temp.reject(q text,fragment text) returns void language plpgsql as $$begin
 begin execute q;exception when others then
 if position(fragment in sqlerrm)=0 then raise exception 'FAIL wrong denial: %',sqlerrm;end if;return;end;
 raise exception 'FAIL accepted %',q;end$$;
create function pg_temp.id(n int) returns uuid language sql immutable as $$select ('a1020000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into public.tenants(id,name,slug,timezone,currency) values
(pg_temp.id(1),'Source A','source-a','UTC','USD'),(pg_temp.id(2),'Source B','source-b','UTC','USD');
insert into public.payment_connections(id,tenant_id,provider,status,account_id,charges_enabled) values
(pg_temp.id(11),pg_temp.id(1),'stripe_connect','connected','acct_testAAAA',true),
(pg_temp.id(12),pg_temp.id(2),'stripe_connect','connected','acct_testBBBB',true);
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values
(pg_temp.id(21),pg_temp.id(1),'SOURCE21',now(),now()+interval '1 hour','source-booking-key-21'),
(pg_temp.id(22),pg_temp.id(2),'SOURCE22',now(),now()+interval '1 hour','source-booking-key-22'),
(pg_temp.id(23),pg_temp.id(1),'SOURCE23',now(),now()+interval '1 hour','source-booking-key-23');
select pg_temp.assert(not has_table_privilege(r,t,v),'ledger privileges') from unnest(array['anon','authenticated','service_role']) r,
unnest(array['public.payment_source_scopes','public.booking_payment_attempt_sources']) t,
unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) v;
select pg_temp.assert(not has_table_privilege(r,t,'SELECT'),'client read denied') from unnest(array['anon','authenticated']) r,
unnest(array['public.payment_source_scopes','public.booking_payment_attempt_sources']) t;
-- Effective column grants are not reported by has_table_privilege.
select pg_temp.assert(not has_any_column_privilege(r,t,v),'column mutation/reference privileges denied')
 from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['public.payment_source_scopes','public.booking_payment_attempt_sources']) t,
 unnest(array['INSERT','UPDATE','REFERENCES']) v;
select pg_temp.assert(not has_any_column_privilege(r,t,'SELECT'),'client column read denied')
 from unnest(array['anon','authenticated']) r,
 unnest(array['public.payment_source_scopes','public.booking_payment_attempt_sources']) t;
select pg_temp.assert(not has_function_privilege(r,f,'EXECUTE'),'client RPC denied') from unnest(array['anon','authenticated']) r,
unnest(array['public.register_payment_source_scope(uuid,text,boolean)','public.bind_booking_payment_source(uuid,uuid,uuid)']) f;
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'forced RLS') from pg_class where oid in('public.payment_source_scopes'::regclass,'public.booking_payment_attempt_sources'::regclass);
select pg_temp.assert(count(*)=0,'no client policies') from pg_policy where polrelid in('public.payment_source_scopes'::regclass,'public.booking_payment_attempt_sources'::regclass);
set local role anon;
select pg_temp.reject($q$select public.register_payment_source_scope(null,null,null)$q$,'permission denied');
reset role;
set local role authenticated;
select pg_temp.reject($q$select public.bind_booking_payment_source(null,null,null)$q$,'permission denied');
reset role;
set local role service_role;
select public.register_payment_source_scope(pg_temp.id(1),'acct_platformA',false);
select public.register_payment_source_scope(pg_temp.id(1),'acct_platformA',false);
select public.register_payment_source_scope(pg_temp.id(1),'acct_platformA',true);
select public.register_payment_source_scope(pg_temp.id(1),'acct_platformB',false);
select public.register_payment_source_scope(pg_temp.id(2),'acct_platformA',false);
select pg_temp.assert(count(*)=4,'duplicate registration reused; modes/platform distinct') from public.payment_source_scopes where tenant_id in(pg_temp.id(1),pg_temp.id(2));
select pg_temp.reject($q$select public.register_payment_source_scope(pg_temp.id(1),'bad',false)$q$,'INVALID_PAYMENT_SOURCE');
select pg_temp.reject($q$select public.register_payment_source_scope(pg_temp.id(1),'acct_platformA',null)$q$,'INVALID_PAYMENT_SOURCE');
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(2),pg_temp.id(21),null)$q$,'BOOKING_NOT_FOUND');
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),null)$q$,'PAYMENT_SOURCE_REQUIRED');
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),(select id from public.payment_source_scopes where tenant_id=pg_temp.id(2)))$q$,'PAYMENT_SOURCE_CONFLICT');
select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),(select id from public.payment_source_scopes where tenant_id=pg_temp.id(1) and not livemode and platform_account_id='acct_platformA'));
select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),null);
select pg_temp.assert(count(*)=1,'retry reuses one attempt') from public.booking_payment_attempt_sources where tenant_id=pg_temp.id(1);
select pg_temp.assert(idempotency_key='source-booking-key-21','booking derived key') from public.booking_payment_attempt_sources where tenant_id=pg_temp.id(1);
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),(select id from public.payment_source_scopes where tenant_id=pg_temp.id(1) and livemode))$q$,'PAYMENT_SOURCE_CONFLICT');
select pg_temp.reject($q$update public.payment_source_scopes set livemode=not livemode$q$,'permission denied');
reset role;
select pg_temp.reject($q$update public.payment_source_scopes set livemode=not livemode$q$,'PAYMENT_SOURCE_IMMUTABLE');
select pg_temp.reject($q$delete from public.booking_payment_attempt_sources$q$,'PAYMENT_SOURCE_IMMUTABLE');
-- Simulate owner-authorized reconnect at trusted fixture level; no provider call.
update public.payment_connections set status='revoked',charges_enabled=false,blocked_reason='credentials_invalid' where id=pg_temp.id(11);
set local role service_role;
select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),null);
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(23),(select id from public.payment_source_scopes where tenant_id=pg_temp.id(1) and not livemode and platform_account_id='acct_platformA'))$q$,'PAYMENT_CONNECTION_UNAVAILABLE');
reset role;
update public.payment_connections set account_id='acct_reconnectA',status='connected',charges_enabled=true,blocked_reason=null where id=pg_temp.id(11);
set local role service_role;
select public.register_payment_source_scope(pg_temp.id(1),'acct_platformA',false);
select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),null);
select pg_temp.assert(s.connected_account_id='acct_testAAAA','reconnect keeps original account') from public.booking_payment_attempt_sources a join public.payment_source_scopes s on s.id=a.source_scope_id where a.tenant_id=pg_temp.id(1);
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(23),(select id from public.payment_source_scopes where connected_account_id='acct_testAAAA' and not livemode and platform_account_id='acct_platformA'))$q$,'PAYMENT_CONNECTION_UNAVAILABLE');
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),(select id from public.payment_source_scopes where connected_account_id='acct_reconnectA'))$q$,'PAYMENT_SOURCE_CONFLICT');
select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(23),(select id from public.payment_source_scopes where connected_account_id='acct_reconnectA'));
reset role;
insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,amount,currency)
 values(pg_temp.id(2),pg_temp.id(22),'staging_mock','synthetic-source-test',100,'USD');
set local role service_role;
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(2),pg_temp.id(22),(select id from public.payment_source_scopes where tenant_id=pg_temp.id(2)))$q$,'PAYMENT_SOURCE_LEGACY_OR_TERMINAL');
reset role;
select pg_temp.assert(count(*)=1 and min(provider)='staging_mock','mock payment unchanged') from public.payments where booking_id=pg_temp.id(22);
update public.bookings set idempotency_key='changed-server-booking-key' where id=pg_temp.id(21);
set local role service_role;
select pg_temp.reject($q$select public.bind_booking_payment_source(pg_temp.id(1),pg_temp.id(21),null)$q$,'PAYMENT_SOURCE_CONFLICT');
reset role;
select pg_temp.assert(count(*)=0,'no payments or mock modifications') from public.payments where tenant_id=pg_temp.id(1);
rollback;
