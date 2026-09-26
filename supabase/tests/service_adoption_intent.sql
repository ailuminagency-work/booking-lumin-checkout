-- Run after 0001..0034 in a disposable database. Fixtures roll back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111134','intent-owner@example.test'),
 ('22222222-2222-2222-2222-222222222234','intent-staff@example.test'),
 ('33333333-3333-3333-3333-333333333334','intent-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','Intent A','intent-a-34','UTC','USD','active'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb34','Intent B','intent-b-34','UTC','EUR','active');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','11111111-1111-1111-1111-111111111134','BUSINESS_OWNER'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','22222222-2222-2222-2222-222222222234','BUSINESS_STAFF'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb34','33333333-3333-3333-3333-333333333334','BUSINESS_OWNER');
create function pg_temp.expect_code(statement text, expected text) returns void language plpgsql as $fn$
begin
  begin execute statement;
  exception when others then if sqlstate=expected then return; end if;
    raise exception 'Expected SQLSTATE %, got %',expected,sqlstate;
  end;
  raise exception 'Expected rejection %',expected;
end $fn$;
create temp table intent_fixture(payload jsonb,service_id uuid);
grant select,update on intent_fixture to service_role;
insert into intent_fixture(payload) values
 ('{"archetype":"cart","name":"Tent draft","basePrice":0,"durationMinutes":60,"taxRateBp":0,"items":[],"addons":[],"questions":[]}'::jsonb);
set local role service_role;
do $checks$
declare a jsonb; b jsonb; p jsonb; sid uuid;
begin
 select payload into p from intent_fixture;
 a:=public.begin_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a','tent-rental',p);
 if a->>'state'<>'pending' or a->>'serviceId' is not null then raise exception 'FAIL: initial pending intent'; end if;
 b:=public.begin_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a','tent-rental',p);
 if b<>a then raise exception 'FAIL: same-key intent replay'; end if;
 if public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a')->>'state'<>'pending' then raise exception 'FAIL: pending lookup'; end if;
 sid:=(public.ingest_service_draft('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a','tent-rental',p)->>'serviceId')::uuid;
 update intent_fixture set service_id=sid;
 a:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a');
 if a->>'state'<>'committed' or (a->>'serviceId')::uuid<>sid or a->>'active'<>'false' then raise exception 'FAIL: atomic intent commit'; end if;
 if jsonb_array_length(public.list_service_draft_intents('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34',20))<>1 then raise exception 'FAIL: owner list'; end if;
 if public.lookup_service_draft_intent('33333333-3333-3333-3333-333333333334','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb34','intent_1234567890a') is not null then raise exception 'FAIL: cross-tenant lookup'; end if;
 -- Old callers of 0033 still get a committed journal row from the trigger.
 sid:=(public.ingest_service_draft('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','legacy_1234567890a','tent-rental',p)->>'serviceId')::uuid;
 a:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','legacy_1234567890a');
 if a->>'state'<>'committed' or (a->>'serviceId')::uuid<>sid then raise exception 'FAIL: legacy atomic journal'; end if;
 update public.services set active=true where id=sid;
 a:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','legacy_1234567890a');
 if a->>'state'<>'changed' or a ? 'active' then raise exception 'FAIL: activated draft falsely marked inactive'; end if;
 b:=public.list_service_draft_intents('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34',20);
 if b->0->>'state'<>'changed' or (b->0) ? 'active' then raise exception 'FAIL: list falsely marked activated draft inactive'; end if;
 delete from public.services where id=sid;
 a:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','legacy_1234567890a');
 if a->>'state'<>'changed' or a ? 'active' then raise exception 'FAIL: deleted draft falsely marked inactive'; end if;
end $checks$;
select pg_temp.expect_code($q$select public.begin_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a','other-template',(select payload from intent_fixture))$q$,'40001');
select pg_temp.expect_code($q$select public.begin_service_draft_intent('22222222-2222-2222-2222-222222222234','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','staff_1234567890ab','tent-rental',(select payload from intent_fixture))$q$,'42501');
select pg_temp.expect_code($q$select public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb34','intent_1234567890a')$q$,'42501');
select pg_temp.expect_code($q$select public.list_service_draft_intents('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34',51)$q$,'22023');
reset role;
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34' and user_id='11111111-1111-1111-1111-111111111134';
set local role service_role;
select pg_temp.expect_code($q$select public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a')$q$,'42501');
select pg_temp.expect_code($q$select public.list_service_draft_intents('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34',20)$q$,'42501');
reset role;
set local role anon;
select pg_temp.expect_code($q$select public.list_service_draft_intents('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34',20)$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.expect_code($q$select public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','intent_1234567890a')$q$,'42501');
reset role;
do $acl$
begin
 if has_table_privilege('service_role','public.service_draft_intents','SELECT')
   or has_function_privilege('anon','public.begin_service_draft_intent(uuid,uuid,text,text,jsonb)','EXECUTE')
   or has_function_privilege('authenticated','public.list_service_draft_intents(uuid,uuid,integer)','EXECUTE')
 then raise exception 'FAIL: intent ACL'; end if;
end $acl$;
rollback;
-- Multi-transaction durability probe. This file runs only in a disposable DB;
-- committed fixture rows intentionally remain for the runner to drop with DB.
begin;
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111134','intent-owner-durable@example.test'),
 ('33333333-3333-3333-3333-333333333334','intent-other-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','Intent durable','intent-durable-34','UTC','USD','active');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','11111111-1111-1111-1111-111111111134','BUSINESS_OWNER'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','33333333-3333-3333-3333-333333333334','BUSINESS_OWNER');
create temp table durable_fixture(payload jsonb);
grant select on durable_fixture to service_role;
insert into durable_fixture(payload) values
 ('{"archetype":"cart","name":"Durable draft","basePrice":0,"durationMinutes":60,"taxRateBp":0,"items":[],"addons":[],"questions":[]}'::jsonb);
commit;
begin;
set local role service_role;
select public.begin_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890','tent-rental',(select payload from durable_fixture));
commit;
begin;
set local role service_role;
do $durable$
declare r jsonb;
begin
 r:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890');
 if r->>'state'<>'pending' then raise exception 'FAIL: intent did not survive transaction'; end if;
 if public.lookup_service_draft_intent('33333333-3333-3333-3333-333333333334','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890') is not null then raise exception 'FAIL: other owner saw intent'; end if;
 begin
  perform public.ingest_service_draft('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890','tent-rental',jsonb_set((select payload from durable_fixture),'{active}','true'));
  raise exception 'FAIL: invalid ingest was accepted';
 exception when sqlstate '22023' then null; end;
 r:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890');
 if r->>'state'<>'pending' then raise exception 'FAIL: failed ingest erased pending intent'; end if;
end $durable$;
commit;
begin;
set local role service_role;
select public.ingest_service_draft('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890','tent-rental',(select payload from durable_fixture));
commit;
begin;
set local role service_role;
do $committed$
declare r jsonb;
begin
 r:=public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890');
 if r->>'state'<>'committed' or r->>'serviceId' is null then raise exception 'FAIL: intent did not commit across transactions'; end if;
end $committed$;
commit;
begin;
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34' and user_id='11111111-1111-1111-1111-111111111134';
commit;
begin;
set local role service_role;
do $revoked$
begin
 begin
  perform public.lookup_service_draft_intent('11111111-1111-1111-1111-111111111134','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa34','durable_1234567890');
  raise exception 'FAIL: revoked owner read durable intent';
 exception when sqlstate '42501' then null; end;
end $revoked$;
commit;
\echo ALL SERVICE ADOPTION INTENT TESTS PASSED
