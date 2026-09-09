-- Run after 0001..0013 in a disposable database. All synthetic fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A','integrity-a','UTC','USD','active'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B','integrity-b','UTC','USD','active');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency) values
 ('a0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','simple','A','USD'),
 ('b0000000-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','simple','B','USD');
insert into public.resources(id,tenant_id,name) values
 ('a0000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A'),
 ('b0000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','B');
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values
 ('a0000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','TEST-A','2030-01-01T10:00Z','2030-01-01T11:00Z','integrity-test-aaaa'),
 ('b0000000-0000-0000-0000-000000000003','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','TEST-B','2030-01-01T10:00Z','2030-01-01T11:00Z','integrity-test-bbbb');

-- INVOKER: the actual authenticated/service role executes each attempted write.
-- Require FK denial, not a generic permission failure that could mask the bug.
create function pg_temp.expect_fk(statement text) returns void language plpgsql as $fn$
begin
  begin
    execute statement;
  exception when foreign_key_violation then
    return;
  end;
  raise exception 'FAIL: cross-tenant relationship accepted: %', statement;
end;
$fn$;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
-- Positive controls: own links and nullable tenant-wide service areas still work.
insert into public.service_resources(tenant_id,service_id,resource_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
insert into public.service_areas(tenant_id,service_id,kind,definition) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,'radius','{}'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000001','radius','{}');
select pg_temp.expect_fk($q$insert into public.service_resources(tenant_id,service_id,resource_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002')$q$);
select pg_temp.expect_fk($q$insert into public.service_resources(tenant_id,service_id,resource_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002')$q$);
select pg_temp.expect_fk($q$insert into public.service_resources(tenant_id,service_id,resource_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002')$q$);
select pg_temp.expect_fk($q$update public.service_resources set service_id='b0000000-0000-0000-0000-000000000001'$q$);
select pg_temp.expect_fk($q$update public.service_resources set resource_id='b0000000-0000-0000-0000-000000000002'$q$);
select pg_temp.expect_fk($q$insert into public.service_areas(tenant_id,service_id,kind,definition) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','b0000000-0000-0000-0000-000000000001','radius','{}')$q$);
select pg_temp.expect_fk($q$update public.service_areas set service_id='b0000000-0000-0000-0000-000000000001'$q$);
reset role;
set local role service_role;
-- Server-internal reservations are constrained even though service_role bypasses RLS.
insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,expires_at) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','2030-01-01T10:00Z','2030-01-01T11:00Z','synthetic',now()+interval '5 minutes');
select pg_temp.expect_fk($q$insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,expires_at) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','2030-01-01T10:00Z','2030-01-01T11:00Z','synthetic',now()+interval '5 minutes')$q$);
select pg_temp.expect_fk($q$insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,expires_at) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003','2030-01-01T10:00Z','2030-01-01T11:00Z','synthetic',now()+interval '5 minutes')$q$);
select pg_temp.expect_fk($q$update public.resource_reservations set resource_id='b0000000-0000-0000-0000-000000000002'$q$);
select pg_temp.expect_fk($q$update public.resource_reservations set booking_id='b0000000-0000-0000-0000-000000000003'$q$);
-- Parent tenant reassignment cannot silently orphan valid child relationships.
select pg_temp.expect_fk($q$update public.resources set tenant_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' where id='a0000000-0000-0000-0000-000000000002'$q$);
reset role;
-- Existing cascade semantics preserved; tenant-wide area survives service delete.
delete from public.services where id='a0000000-0000-0000-0000-000000000001';
do $test$
begin
 if exists(select 1 from public.service_resources) then raise exception 'FAIL: link cascade'; end if;
 if (select count(*) from public.service_areas) <> 1 then raise exception 'FAIL: nullable area/cascade'; end if;
end;
$test$;
delete from public.resources where id='a0000000-0000-0000-0000-000000000002';
do $test$
begin
 if exists(select 1 from public.resource_reservations) then raise exception 'FAIL: reservation cascade'; end if;
end;
$test$;
rollback;
\echo ALL RESOURCE TENANT INTEGRITY TESTS PASSED
