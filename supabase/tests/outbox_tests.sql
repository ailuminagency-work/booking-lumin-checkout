-- Disposable Postgres only, after 0001..0015. Synthetic data fully rolled back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','outbox-owner@example.test'),
 ('22222222-2222-2222-2222-222222222222','outbox-admin@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A','outbox-a','UTC','USD'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B','outbox-b','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','BUSINESS_OWNER');
insert into public.platform_admins(user_id) values('22222222-2222-2222-2222-222222222222');
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values
 ('a0000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','OUTBOX-A','2030-01-01T10:00Z','2030-01-01T11:00Z','outbox-synthetic-aaaa'),
 ('b0000000-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','OUTBOX-B','2030-01-01T10:00Z','2030-01-01T11:00Z','outbox-synthetic-bbbb');
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then
  if sqlstate=expected then return; end if;
  raise exception 'FAIL expected % got %',expected,sqlstate;
 end;
 raise exception 'FAIL accepted forbidden operation';
end $$;
create function pg_temp.expect_denied() returns void language plpgsql as $$
begin
 perform pg_temp.expect_error('select * from public.durable_outbox','42501');
 perform pg_temp.expect_error('delete from public.durable_outbox','42501');
 perform pg_temp.expect_error($q$select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.requested','00000000-0000-0000-0000-000000000001')$q$,'42501');
 perform pg_temp.expect_error($q$select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$,'42501');
 perform pg_temp.expect_error('select public.outbox_ack(null,null,null,null)','42501');
 perform pg_temp.expect_error('select public.outbox_retry(null,null,null,null)','42501');
end $$;
set local role anon;
select pg_temp.expect_denied();
reset role;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_denied();
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_denied();
reset role;
create temp table outbox_leases as select * from public.durable_outbox with no data;
grant all on outbox_leases to service_role;
set local role service_role;
select pg_temp.expect_error('select * from public.durable_outbox','42501');
select pg_temp.expect_error('update public.durable_outbox set attempts=0','42501');
select pg_temp.expect_error($q$select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','b0000000-0000-0000-0000-000000000003','booking.requested','00000000-0000-0000-0000-000000000001')$q$,'23503');
select pg_temp.expect_error($q$select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.requested','00000000-0000-0000-0000-000000000001','{"token":"synthetic"}')$q$,'22023');
select pg_temp.expect_error($q$select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','payment.succeeded','00000000-0000-0000-0000-000000000001')$q$,'22023');
select pg_temp.expect_error('select * from public.outbox_lease(null)','22023');
select pg_temp.expect_error($q$select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',101)$q$,'22023');
select pg_temp.expect_error($q$select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',1,301)$q$,'22023');
do $$ declare a uuid; b uuid; begin
 a:=public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.requested','00000000-0000-0000-0000-000000000001','{}',2);
 b:=public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.requested','00000000-0000-0000-0000-000000000001','{}',2);
 perform pg_temp.assert(a=b,'dedup stable');
 perform pg_temp.expect_error($q$select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.changed','00000000-0000-0000-0000-000000000001','{}',2)$q$,'22023');
 b:=public.outbox_enqueue('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b0000000-0000-0000-0000-000000000003','booking.requested','00000000-0000-0000-0000-000000000001');
 perform pg_temp.assert(a<>b,'dedup scoped tenant');
end $$;
insert into outbox_leases select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.assert(count(*)=1 and bool_and(tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and attempts=1 and generation=1),'lease tenant and generation') from outbox_leases;
select pg_temp.assert(count(*)=0,'active lease not redelivered') from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.assert(not public.outbox_ack('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',id,lease_token,generation),'cross tenant ack') from outbox_leases;
select pg_temp.assert(not public.outbox_ack(tenant_id,id,gen_random_uuid(),generation),'wrong token') from outbox_leases;
select pg_temp.assert(not public.outbox_ack(tenant_id,id,lease_token,generation+1),'wrong generation') from outbox_leases;
select pg_temp.assert(public.outbox_retry(tenant_id,id,lease_token,generation),'retry accepted') from outbox_leases;
select pg_temp.assert(not public.outbox_retry(tenant_id,id,lease_token,generation),'retry replay refused') from outbox_leases;
select pg_temp.assert(count(*)=0,'backoff prevents immediate lease') from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;
-- Test clock manipulation is superuser-only, never exposed through service RPC.
select pg_temp.assert(state='ready' and available_at>clock_timestamp(),'retry persists backoff') from public.durable_outbox where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.durable_outbox set available_at=clock_timestamp()-interval '1 second' where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role service_role;
insert into outbox_leases select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.assert(not public.outbox_ack(tenant_id,id,lease_token,generation),'old lease cannot ack new generation') from outbox_leases where generation=1;
select pg_temp.assert(public.outbox_retry(tenant_id,id,lease_token,generation),'last attempt deadletters') from outbox_leases where generation=2;
select pg_temp.assert(count(*)=0,'dead job cannot reclaim') from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;
select pg_temp.assert(state='dead' and attempts=2,'bounded exhaustion persisted') from public.durable_outbox where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
truncate outbox_leases;
set local role service_role;
insert into outbox_leases select * from public.outbox_lease('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
reset role;
update public.durable_outbox set lease_until=clock_timestamp()-interval '1 second' where tenant_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
set local role service_role;
select pg_temp.assert(not public.outbox_ack(tenant_id,id,lease_token,generation),'expired ack refused before reclaim') from outbox_leases;
select pg_temp.assert(not public.outbox_retry(tenant_id,id,lease_token,generation),'expired retry refused') from outbox_leases;
insert into outbox_leases select * from public.outbox_lease('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select pg_temp.assert(count(distinct lease_token)=2 and max(generation)=2,'expiry creates fresh fence') from outbox_leases;
select pg_temp.assert(not public.outbox_ack(tenant_id,id,lease_token,generation),'reclaimed stale ack refused') from outbox_leases where generation=1;
select pg_temp.assert(public.outbox_ack(tenant_id,id,lease_token,generation),'current ack accepted') from outbox_leases where generation=2;
select pg_temp.assert(public.outbox_ack(tenant_id,id,lease_token,generation),'ack replay idempotent') from outbox_leases where generation=2;
select pg_temp.assert(count(*)=0,'completed not reclaimed') from public.outbox_lease('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
reset role;
truncate outbox_leases;
set local role service_role;
select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.changed','00000000-0000-0000-0000-000000000002','{}',1);
insert into outbox_leases select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;
update public.durable_outbox set lease_until=clock_timestamp()-interval '1 second' where state='leased';
set local role service_role;
select pg_temp.assert(count(*)=0,'last crashed attempt not reclaimed') from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;
select pg_temp.assert(state='dead' and last_failure='lease_expired','crash exhaustion deadletter') from public.durable_outbox where dedup_key='00000000-0000-0000-0000-000000000002';
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'forced RLS') from pg_class where oid='public.durable_outbox'::regclass;
truncate outbox_leases;
set local role service_role;
select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.changed','00000000-0000-0000-0000-000000000003');
insert into outbox_leases select * from public.outbox_lease('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select pg_temp.assert(public.outbox_retry(tenant_id,id,lease_token,generation,'permanent'),'permanent failure accepted') from outbox_leases;
reset role;
select pg_temp.assert(state='dead' and attempts=1 and last_failure='permanent','permanent failure terminal immediately') from public.durable_outbox where dedup_key='00000000-0000-0000-0000-000000000003';
savepoint atomic_writer;
set local role service_role;
select public.outbox_enqueue('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000003','booking.changed','00000000-0000-0000-0000-000000000004');
rollback to atomic_writer;
select pg_temp.assert(count(*)=0,'enqueue rolls back with calling transaction') from public.durable_outbox where dedup_key='00000000-0000-0000-0000-000000000004';
rollback;
\echo 'outbox tests PASS (fixtures rolled back)'

