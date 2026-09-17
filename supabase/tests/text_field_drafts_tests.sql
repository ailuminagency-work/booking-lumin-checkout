-- Disposable local PostgreSQL only; root allocates/runs after independent review.
-- All fixtures roll back. No claim of parallel-race certification from this suite.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','text-owner@example.test'),
 ('22222222-2222-4222-8222-222222222222','text-staff@example.test'),
 ('33333333-3333-4333-8333-333333333333','text-foreign@example.test'),
 ('44444444-4444-4444-8444-444444444444','text-worker@example.test'),
 ('55555555-5555-4555-8555-555555555555','text-manager@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A','text-draft-a','UTC','USD'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B','text-draft-b','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','BUSINESS_OWNER'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','BUSINESS_STAFF'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','BUSINESS_OWNER');
-- WORKER/MANAGER are not tenant_members roles in the accepted schema. Neither
-- absent membership nor pretending to be one of these labels grants ownership.
select pg_temp.reject($q$insert into public.tenant_members values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','WORKER',now())$q$,'23514');
select pg_temp.reject($q$insert into public.tenant_members values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555','MANAGER',now())$q$,'23514');
insert into public.services(id,tenant_id,archetype,name,currency,base_price) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','simple','Text parent','USD',0);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','count','Count','quantity',true,0,1,5,'[]');
create function pg_temp.parent_save(revision bigint) returns jsonb language sql as $$
 select public.save_configurable_flow_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001',revision,'Text parent','{"authoringVersion":2,"config":{"key":"parent","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]},"questionOverrides":{}}')
$$;
create function pg_temp.definition() returns jsonb language sql immutable as $$select '{"schemaVersion":1,"fields":[{"key":"notes","kind":"text","required":true,"minLength":1,"maxLength":4096}]}'::jsonb$$;
create function pg_temp.save_text(revision bigint,parent_revision bigint) returns jsonb language sql as $$
 select public.save_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002',revision,parent_revision,pg_temp.definition())
$$;
create function pg_temp.read_text() returns jsonb language sql as $$
 select public.get_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002')
$$;
set local role service_role;
select pg_temp.parent_save(0);
select pg_temp.assert(pg_temp.read_text()='{"status":"missing","textDraftVersion":1,"parentAuthoringVersion":2,"currentParentRevision":1,"runtimePublishable":false}'::jsonb,'explicit missing');
select pg_temp.reject($q$select pg_temp.save_text(1,1)$q$,'40001');
select pg_temp.reject($q$select pg_temp.save_text(0,2)$q$,'40001');
select pg_temp.assert(pg_temp.save_text(0,1)='{"textDraftVersion":1,"parentAuthoringVersion":2,"draftRevision":1,"savedParentRevision":1,"currentParentRevision":1,"definition":{"schemaVersion":1,"fields":[{"key":"notes","kind":"text","required":true,"minLength":1,"maxLength":4096}]},"runtimePublishable":false}'::jsonb,'create exact raw receipt');
select pg_temp.assert(pg_temp.read_text()->'receipt'->'definition'=pg_temp.definition(),'definition roundtrip');
select public.save_bound_flow_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001',0,'Legacy parent','{"key":"legacy","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}');
select pg_temp.reject($q$select public.get_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000003')$q$,'0A000');
select pg_temp.reject($q$select public.save_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000003',0,1,pg_temp.definition())$q$,'0A000');
select pg_temp.reject($q$select pg_temp.save_text(0,1)$q$,'40001');
select pg_temp.assert(pg_temp.save_text(1,1)->'draftRevision'='2'::jsonb,'update CAS');
select pg_temp.reject($q$select pg_temp.save_text(1,1)$q$,'40001');
select pg_temp.parent_save(1);
select pg_temp.assert(pg_temp.read_text()->'receipt'->'savedParentRevision'='1'::jsonb and pg_temp.read_text()->'receipt'->'currentParentRevision'='2'::jsonb and not (pg_temp.read_text()->'receipt' ? 'stale'),'stale history exposed without auto-rebase or trusted stale');
select pg_temp.reject($q$select pg_temp.save_text(2,1)$q$,'40001');
select pg_temp.assert(pg_temp.save_text(2,2)->'savedParentRevision'='2'::jsonb,'explicit resubmit binds new parent');
select pg_temp.reject($q$select * from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$update public.text_field_drafts set draft_revision=99$q$,'42501');
select pg_temp.reject($q$delete from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$insert into public.text_field_drafts values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002',1,1,pg_temp.definition())$q$,'42501');
select pg_temp.reject($q$select public.get_text_field_draft('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.reject($q$select public.get_text_field_draft('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000002')$q$,'P0002');
-- Each non-owner identity is checked on both RPCs, including a fresh membership lookup.
do $$declare actor uuid;begin
 foreach actor in array array['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555']::uuid[] loop
  perform pg_temp.reject(format('select public.get_text_field_draft(%L,%L,%L)',actor,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002'),'42501');
  perform pg_temp.reject(format('select public.save_text_field_draft(%L,%L,%L,3,2,pg_temp.definition())',actor,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002'),'42501');
 end loop;
end$$;
reset role;
-- Database validator parity, including shape, duplicate keys, budgets and bounds.
do $$declare bad jsonb; field jsonb:=pg_temp.definition()->'fields'->0;begin
 foreach bad in array array['null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"schemaVersion":2,"fields":[]}'::jsonb,
  '{"schemaVersion":1,"fields":[],"answers":[]}'::jsonb,
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field,field)),
  jsonb_build_object('schemaVersion',1,'fields',(select jsonb_agg(field||jsonb_build_object('key','f'||i)) from generate_series(1,65)i)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"required":true,"minLength":0,"maxLength":0}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"minLength":1.5}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"minLength":-1}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"maxLength":4097}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"minLength":5,"maxLength":4}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"key":"constructor"}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"kind":"textarea"}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"required":"true"}'::jsonb)),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field-'maxLength')),
  jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||jsonb_build_object('key',repeat('a',32769))))] loop
  perform pg_temp.assert(not lumin.text_field_definition_valid(bad),'invalid definition');
  perform pg_temp.reject(format('select public.save_text_field_draft(%L,%L,%L,3,2,%L::jsonb)','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002',bad::text),'22023');
 end loop;
 perform pg_temp.assert(lumin.text_field_definition_valid('{"schemaVersion":1,"fields":[]}'),'empty fields valid');
 perform pg_temp.assert(lumin.text_field_definition_valid(jsonb_build_object('schemaVersion',1,'fields',jsonb_build_array(field||'{"required":false,"minLength":0,"maxLength":0}'::jsonb))),'optional zero valid');
 perform pg_temp.assert(lumin.text_field_definition_valid(jsonb_build_object('schemaVersion',1,'fields',(select jsonb_agg(field||jsonb_build_object('key','f'||i)) from generate_series(1,64)i))),'64 fields valid');
end$$;
select pg_temp.assert((select draft_revision=3 and saved_parent_revision=2 from public.text_field_drafts),'rejected writes unchanged');
select pg_temp.reject($q$select pg_temp.save_text(null,2)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_text(-1,2)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_text(3,null)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_text(3,0)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_text(9007199254740992,2)$q$,'22023');
update public.text_field_drafts set draft_revision=9007199254740991;
set local role service_role;
select pg_temp.assert(pg_temp.read_text()->'receipt'->'draftRevision'='9007199254740991'::jsonb,'terminal revision readable');
select pg_temp.reject($q$select pg_temp.save_text(9007199254740991,2)$q$,'22023');
reset role;
update public.text_field_drafts set draft_revision=3;
-- Composite FK cannot bind this sidecar to another tenant's flow.
select pg_temp.reject($q$insert into public.text_field_drafts values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000002',1,1,pg_temp.definition())$q$,'23503');
update public.tenant_members set role='BUSINESS_STAFF' where user_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select pg_temp.reject($q$select pg_temp.read_text()$q$,'42501'); select pg_temp.reject($q$select pg_temp.save_text(3,2)$q$,'42501');
reset role;
update public.tenant_members set role='BUSINESS_OWNER' where user_id='11111111-1111-4111-8111-111111111111';
update public.tenants set status='suspended' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.reject($q$select pg_temp.read_text()$q$,'42501'); select pg_temp.reject($q$select pg_temp.save_text(3,2)$q$,'42501');
reset role;
update public.tenants set status='active' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.flows set status='archived' where id='a0000000-0000-4000-8000-000000000002';
set local role service_role;
select pg_temp.reject($q$select pg_temp.read_text()$q$,'P0002'); select pg_temp.reject($q$select pg_temp.save_text(3,2)$q$,'P0002');
reset role;
select pg_temp.assert((select draft_revision=3 and saved_parent_revision=2 from public.text_field_drafts),'archive leaves sidecar intact');
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.text_field_drafts'::regclass),'forced RLS');
select pg_temp.assert(not exists(select 1 from pg_policy where polrelid='public.text_field_drafts'::regclass),'no permissive policies');
set local role anon;
select pg_temp.reject($q$select pg_temp.read_text()$q$,'42501'); select pg_temp.reject($q$select pg_temp.save_text(3,2)$q$,'42501');
select pg_temp.reject($q$select * from public.text_field_drafts$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.reject($q$select pg_temp.read_text()$q$,'42501'); select pg_temp.reject($q$select pg_temp.save_text(3,2)$q$,'42501');
select pg_temp.reject($q$delete from public.text_field_drafts$q$,'42501');
reset role;
select pg_temp.assert((select count(*)=1 from public.text_field_drafts),'no extra sidecar');
select pg_temp.assert((select revision=2 and authoring_version=2 from public.flow_drafts where flow_id='a0000000-0000-4000-8000-000000000002'),'sidecar never mutates parent');
select pg_temp.assert((select bool_and(published_version_id is null) from public.flows),'sidecar never publishes');
rollback;
