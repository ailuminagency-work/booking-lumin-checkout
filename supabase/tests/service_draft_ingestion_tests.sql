-- Run after 0001..0033 in a disposable database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111133','draft-owner@example.test'),
 ('22222222-2222-2222-2222-222222222233','draft-staff@example.test'),
 ('33333333-3333-3333-3333-333333333333','draft-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','Draft A','draft-a-33','America/Chicago','USD','active'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb33','Draft B','draft-b-33','Europe/Amsterdam','EUR','active'),
 ('cccccccc-cccc-cccc-cccc-cccccccccc33','Draft suspended','draft-c-33','UTC','USD','suspended');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','11111111-1111-1111-1111-111111111133','BUSINESS_OWNER'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','22222222-2222-2222-2222-222222222233','BUSINESS_STAFF'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb33','33333333-3333-3333-3333-333333333333','BUSINESS_OWNER'),
 ('cccccccc-cccc-cccc-cccc-cccccccccc33','11111111-1111-1111-1111-111111111133','BUSINESS_OWNER');

create function pg_temp.expect_code(statement text, expected text) returns void language plpgsql as $fn$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected then return; end if;
    raise exception 'Wrong SQLSTATE: expected %, got %',expected,sqlstate;
  end;
  raise exception 'Expected rejection %: %',expected,statement;
end $fn$;

create temp table draft_fixture(payload jsonb,service_id uuid);
grant select,update on draft_fixture to service_role;
insert into draft_fixture(payload) values
 ('{"archetype":"cart","name":"Safe draft","description":"Review before use","basePrice":0,"durationMinutes":60,"taxRateBp":0,"items":[{"id":"chair","name":"Chair","unitPrice":1200,"minQty":0,"maxQty":10}],"addons":[{"id":"stairs","name":"Stairs","price":300}],"questions":[{"id":"count","prompt":"How many?","kind":"quantity","required":true,"choices":[],"unitPrice":100,"minQty":1,"maxQty":5}]}'::jsonb);

set local role service_role;
update draft_fixture set service_id=(public.ingest_service_draft(
 '11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33',
 'key_1234567890abcdef','junk-removal',payload)->>'serviceId')::uuid;
do $check$
declare s public.services; n integer; result jsonb;
begin
 select * into s from public.services where id=(select service_id from draft_fixture);
 if not found or s.active or s.currency<>'USD' or s.tenant_id<>'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33' then
   raise exception 'FAIL: tenant-derived inactive service'; end if;
 select count(*) into n from public.service_items where service_id=s.id;
 if n<>1 or (select count(*) from public.service_addons where service_id=s.id)<>1
   or (select count(*) from public.service_questions where service_id=s.id)<>1 then
   raise exception 'FAIL: incomplete children'; end if;
 result:=public.flow_owner_services('11111111-1111-1111-1111-111111111133',s.tenant_id);
 if result::text like '%'||s.id::text||'%' then raise exception 'FAIL: inactive draft listed to flow builder'; end if;
end $check$;
do $replay$
declare first uuid; again uuid; p jsonb;
begin
 select service_id,payload into first,p from draft_fixture;
 again:=(public.ingest_service_draft('11111111-1111-1111-1111-111111111133',
 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','key_1234567890abcdef','junk-removal',p)->>'serviceId')::uuid;
 if first<>again or (select count(*) from public.services where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33')<>1 then
   raise exception 'FAIL: idempotent replay'; end if;
end $replay$;
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','key_1234567890abcdef','housekeeping',(select payload from draft_fixture))$q$,'40001');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','key_1234567890abcdef','junk-removal',jsonb_set((select payload from draft_fixture),'{name}','"Changed"'))$q$,'40001');
select pg_temp.expect_code($q$select public.ingest_service_draft('22222222-2222-2222-2222-222222222233','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','staff_1234567890ab','junk-removal',(select payload from draft_fixture))$q$,'42501');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb33','foreign_123456789','junk-removal',(select payload from draft_fixture))$q$,'42501');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','cccccccc-cccc-cccc-cccc-cccccccccc33','suspend_123456789','junk-removal',(select payload from draft_fixture))$q$,'42501');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','inject_1234567890','junk-removal',jsonb_set((select payload from draft_fixture),'{active}','true'))$q$,'22023');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','child_12345678900','junk-removal',jsonb_set((select payload from draft_fixture),'{items,0,maxQty}','-1'))$q$,'22023');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','choice_1234567890','junk-removal',jsonb_set((select payload from draft_fixture),'{questions,0,choices}','[{"id":"x","label":"Bad","priceDelta":-1,"priceMultiplierBp":10000}]'))$q$,'22023');
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','rental_123456789','junk-removal',jsonb_set(jsonb_set((select payload from draft_fixture),'{archetype}','"rental"'),'{rental}','{"periodMinutes":60,"pricePerPeriod":-1,"minPeriods":1,"maxPeriods":2,"depositAmount":0}'))$q$,'22023');
reset role;
do $rollback$
begin
 if (select count(*) from public.services where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33')<>1
   or (select count(*) from public.service_draft_ingestions where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33')<>1 then
   raise exception 'FAIL: invalid child left partial service or receipt'; end if;
end $rollback$;
set local role service_role;
-- An activation or deletion after the original operation may not turn an
-- idempotent retry into a false draft receipt or a second service.
update public.services set active=true where id=(select service_id from draft_fixture);
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','key_1234567890abcdef','junk-removal',(select payload from draft_fixture))$q$,'40001');
delete from public.services where id=(select service_id from draft_fixture);
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','key_1234567890abcdef','junk-removal',(select payload from draft_fixture))$q$,'40001');
reset role;
do $tombstone$
begin
 if (select count(*) from public.service_draft_ingestions where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33')<>1
   or exists(select 1 from public.services where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33') then
   raise exception 'FAIL: deletion lost idempotency tombstone or created a duplicate'; end if;
end $tombstone$;
set local role anon;
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','anon_123456789012','junk-removal','{}'::jsonb)$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.expect_code($q$select public.ingest_service_draft('11111111-1111-1111-1111-111111111133','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa33','auth_123456789012','junk-removal','{}'::jsonb)$q$,'42501');
reset role;
do $acl$
begin
 if has_function_privilege('anon','public.ingest_service_draft(uuid,uuid,text,text,jsonb)','EXECUTE')
   or has_function_privilege('authenticated','public.ingest_service_draft(uuid,uuid,text,text,jsonb)','EXECUTE')
   or not has_function_privilege('service_role','public.ingest_service_draft(uuid,uuid,text,text,jsonb)','EXECUTE') then
   raise exception 'FAIL: RPC execute ACL'; end if;
end $acl$;
rollback;
\echo ALL SERVICE DRAFT INGESTION TESTS PASSED
