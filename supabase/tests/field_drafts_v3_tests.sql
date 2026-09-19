-- Disposable local PostgreSQL only; root allocates/runs after independent review.
-- All fixtures roll back. No claim of parallel-race certification from this suite.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'FAIL accepted %',q;end$$;
-- Upgrade fixture is mandatory evidence, never synthesized after the migration.
select pg_temp.assert((select family=1 from public.field_draft_families where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002'),'existing V1 retained family1');
select pg_temp.assert((select draft_revision=2 and saved_parent_revision=1 and definition='{"schemaVersion":1,"fields":[{"key":"legacy_note","kind":"text","required":false,"minLength":0,"maxLength":20,"prompt":" Before upgrade "}]}'::jsonb from public.text_field_drafts where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002'),'upgrade retains exact V1 data and revisions');
set local role service_role;
select pg_temp.assert(public.get_text_field_draft('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000002')->'receipt'->'draftRevision'='2'::jsonb,'upgraded V1 remains readable');
select pg_temp.reject($q$select public.get_field_draft_v3('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000002')$q$,'23514');
select pg_temp.reject($q$select public.save_field_draft_v3('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000002',0,1,'{"schemaVersion":3,"fields":[]}')$q$,'23514');
reset role;
-- Remove only this exact synthetic upgrade sidecar from this test transaction.
-- Its durable family remains; rollback below restores the sidecar for scoped cleanup.
delete from public.text_field_drafts where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002' and draft_revision=2 and saved_parent_revision=1;
select pg_temp.assert(not exists(select 1 from public.text_field_drafts where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002'),'upgrade sidecar isolated from legacy fixture queries');
-- Existing V2 is independently preserved, not converted to V3.
select pg_temp.assert((select family=2 from public.field_draft_families where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000003'),'existing V2 family retained');
select pg_temp.assert((select draft_revision=1 and saved_parent_revision=1 and definition='{"schemaVersion":2,"fields":[{"key":"old_details","kind":"textarea","required":false,"minLength":0,"maxLength":20,"prompt":" V2 before upgrade "}]}'::jsonb from public.field_drafts_v2 where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000003'),'V2 exact data retained');
set local role service_role;
select pg_temp.assert(public.get_field_draft_v2('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000003')->'receipt'->'draftRevision'='1'::jsonb,'V2 remains readable');
select pg_temp.reject($q$select public.get_field_draft_v3('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000003')$q$,'23514');
select pg_temp.reject($q$select public.save_field_draft_v3('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000003',0,1,'{"schemaVersion":3,"fields":[]}')$q$,'23514');
reset role;
delete from public.field_drafts_v2 where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000003';
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

create function pg_temp.v3_definition() returns jsonb language sql immutable as $$select '{"schemaVersion":3,"fields":[{"key":"notes","kind":"text","required":false,"minLength":0,"maxLength":100,"prompt":"  Exact label  "},{"key":"details","kind":"textarea","required":true,"minLength":1,"maxLength":4096},{"key":"option","kind":"dropdown","required":false,"choices":[{"id":"first","label":" Same label "},{"id":"second","label":" Same label "}]}]}'::jsonb$$;
create function pg_temp.parent_b(revision bigint) returns jsonb language sql as $$
 select public.save_configurable_flow_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',revision,'V3 parent','{"authoringVersion":2,"config":{"key":"parent","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]},"questionOverrides":{}}')
$$;
create function pg_temp.save_v3(revision bigint,parent_revision bigint) returns jsonb language sql as $$
 select public.save_field_draft_v3('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004',revision,parent_revision,pg_temp.v3_definition())
$$;
create function pg_temp.read_v3() returns jsonb language sql as $$
 select public.get_field_draft_v3('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004')
$$;
select pg_temp.assert(lumin.field_definition_v3_valid(pg_temp.v3_definition()),'mixed definition valid');
select pg_temp.assert(not lumin.field_definition_v3_valid(pg_temp.definition()),'V1 version rejects');
do $$declare v jsonb; prompt text;begin
 foreach v in array array[
  jsonb_set(pg_temp.v3_definition(),'{fields,0,kind}','"email"'),
  jsonb_set(pg_temp.v3_definition(),'{fields,0,prompt}','null'),
  jsonb_set(pg_temp.v3_definition(),'{fields,1,maxLength}','0'),
  jsonb_set(pg_temp.v3_definition(),'{fields,0,key}','"constructor"'),
  jsonb_set(pg_temp.v3_definition(),'{fields,1,key}','"notes"'),
  jsonb_set(pg_temp.v3_definition(),'{fields,0,extra}','true')
 ] loop perform pg_temp.assert(not lumin.field_definition_v3_valid(v),'invalid V3 definition');end loop;
 foreach prompt in array array['',chr(160),chr(65279),'a'||chr(10),repeat('a',201)] loop
  perform pg_temp.assert(not lumin.field_definition_v3_valid(jsonb_set(pg_temp.v3_definition(),'{fields,0,prompt}',to_jsonb(prompt))),'invalid prompt');end loop;
 foreach prompt in array array[chr(133),chr(8203),repeat(chr(128512),200)] loop
  perform pg_temp.assert(lumin.field_definition_v3_valid(jsonb_set(pg_temp.v3_definition(),'{fields,0,prompt}',to_jsonb(prompt))),'exact prompt parity');end loop;
 perform pg_temp.assert(not lumin.field_definition_v3_valid(jsonb_build_object('schemaVersion',3,'fields',(select jsonb_agg(jsonb_build_object('key','n'||i,'kind','textarea','required',false,'minLength',0,'maxLength',1)) from generate_series(1,65)i))),'65 fields reject');
 perform pg_temp.assert(not lumin.field_definition_v3_valid(jsonb_build_object('schemaVersion',3,'fields',(select jsonb_agg(jsonb_build_object('key','n'||i,'kind','textarea','required',false,'minLength',0,'maxLength',1,'prompt',repeat(chr(128512),200))) from generate_series(1,64)i))),'32KiB SQL cap');
end$$;
-- Dropdown-specific boundaries are independent from the native parity corpus.
do $$declare v jsonb; options jsonb; fields jsonb;begin
 foreach v in array array[
  jsonb_set(pg_temp.v3_definition(),'{schemaVersion}','2'),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices}','[]'),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices,1,id}','"first"'),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices,0,id}','"constructor"'),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices,0,label}','null'),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices,0,label}',to_jsonb(chr(160))),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices,0,label}',to_jsonb('x'||chr(10))),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,choices,0,price}','1'),
  jsonb_set(pg_temp.v3_definition(),'{fields,2,minLength}','0')
 ] loop perform pg_temp.assert(not lumin.field_definition_v3_valid(v),'invalid dropdown');end loop;
 select jsonb_agg(jsonb_build_object('id','c'||i,'label','Choice')) into options from generate_series(1,32)i;
 select jsonb_agg(jsonb_build_object('key','f'||i,'kind','dropdown','required',false,'choices',options)) into fields from generate_series(1,8)i;
 perform pg_temp.assert(lumin.field_definition_v3_valid(jsonb_build_object('schemaVersion',3,'fields',fields)),'256 options accepted');
 perform pg_temp.assert(not lumin.field_definition_v3_valid(jsonb_build_object('schemaVersion',3,'fields',fields||jsonb_build_array(jsonb_build_object('key','extra','kind','dropdown','required',false,'choices',jsonb_build_array(jsonb_build_object('id','c','label','Choice')))))),'257 options rejected');
 perform pg_temp.assert(not lumin.field_definition_v3_valid(jsonb_set(pg_temp.v3_definition(),'{fields,2,choices}',options||jsonb_build_array(jsonb_build_object('id','extra','label','Choice')))),'33 choices rejected');
end$$;
set local role service_role;
select pg_temp.parent_save(0);select pg_temp.parent_b(0);
select pg_temp.assert(pg_temp.read_v3()='{"status":"missing","fieldDraftVersion":3,"parentAuthoringVersion":2,"currentParentRevision":1,"runtimePublishable":false}'::jsonb,'explicit V3 missing');
-- Invalid create-CAS claims must roll back entirely.
select pg_temp.reject($q$select pg_temp.save_v3(1,1)$q$,'40001');
reset role;
select pg_temp.assert(not exists(select 1 from public.field_draft_families where flow_id='a0000000-0000-4000-8000-000000000004'),'failed create has no family');
set local role service_role;
select pg_temp.save_text(0,1);
select pg_temp.reject($q$select public.get_field_draft_v3('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002')$q$,'23514');
select pg_temp.reject($q$select public.save_field_draft_v3('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002',77,77,pg_temp.v3_definition())$q$,'23514');
select pg_temp.assert(pg_temp.save_v3(0,1)=('{"fieldDraftVersion":3,"parentAuthoringVersion":2,"draftRevision":1,"savedParentRevision":1,"currentParentRevision":1,"runtimePublishable":false}'::jsonb||jsonb_build_object('definition',pg_temp.v3_definition())),'exact raw V3 create');
select pg_temp.assert(pg_temp.read_v3()->'receipt'->'definition'=pg_temp.v3_definition(),'exact persisted definition');
select pg_temp.reject($q$select public.get_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004')$q$,'23514');
select pg_temp.reject($q$select public.save_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004',77,77,pg_temp.definition())$q$,'23514');
select pg_temp.reject($q$select pg_temp.save_v3(0,1)$q$,'40001');
select pg_temp.assert(pg_temp.save_v3(1,1)->'draftRevision'='2'::jsonb,'V3 update');
select pg_temp.parent_b(1);
select pg_temp.assert(pg_temp.read_v3()->'receipt'->'savedParentRevision'='1'::jsonb and pg_temp.read_v3()->'receipt'->'currentParentRevision'='2'::jsonb and not(pg_temp.read_v3()->'receipt'?'stale'),'stale raw history');
select pg_temp.reject($q$select pg_temp.save_v3(2,1)$q$,'40001');
select pg_temp.assert(pg_temp.save_v3(2,2)->'savedParentRevision'='2'::jsonb,'explicit new parent CAS');
do $$declare actor uuid;begin
 foreach actor in array array['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333']::uuid[] loop
  perform pg_temp.reject(format('select public.get_field_draft_v3(%L,%L,%L)',actor,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004'),'42501');
  perform pg_temp.reject(format('select public.save_field_draft_v3(%L,%L,%L,3,2,pg_temp.v3_definition())',actor,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004'),'42501');
 end loop;
end$$;
reset role;
update public.field_drafts_v3 set draft_revision=9007199254740991 where flow_id='a0000000-0000-4000-8000-000000000004';
set local role service_role;
select pg_temp.reject($q$select pg_temp.save_v3(9007199254740991,2)$q$,'22023');
reset role;
select pg_temp.reject($q$update public.field_draft_families set family=1 where flow_id='a0000000-0000-4000-8000-000000000004'$q$,'23514');
select pg_temp.reject($q$delete from public.field_draft_families where flow_id='a0000000-0000-4000-8000-000000000004'$q$,'23514');
select pg_temp.reject($q$update public.field_drafts_v3 set flow_id='a0000000-0000-4000-8000-000000000002' where flow_id='a0000000-0000-4000-8000-000000000004'$q$,'23514');
savepoint archived_parent;
update public.flows set status='archived' where id='a0000000-0000-4000-8000-000000000004';
set local role service_role;
select pg_temp.reject($q$select pg_temp.read_v3()$q$,'P0002');
select pg_temp.reject($q$select pg_temp.save_v3(9007199254740991,2)$q$,'P0002');
reset role;
rollback to savepoint archived_parent;
set local role service_role;
select public.save_bound_flow_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001',0,'Legacy','{"key":"legacy","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}');
select pg_temp.reject($q$select public.get_field_draft_v3('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000005')$q$,'0A000');
select pg_temp.reject($q$select public.save_field_draft_v3('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000005',0,1,pg_temp.v3_definition())$q$,'0A000');
select pg_temp.reject($q$select public.get_field_draft_v3('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000004')$q$,'P0002');
reset role;
-- Direct privileged fixture insertion preserves composite-FK behavior in both families.
select pg_temp.reject($q$insert into public.text_field_drafts(tenant_id,flow_id,draft_revision,saved_parent_revision,definition) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000002',1,1,pg_temp.definition())$q$,'23503');
select pg_temp.reject($q$insert into public.field_drafts_v3(tenant_id,flow_id,draft_revision,saved_parent_revision,definition) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000004',1,1,pg_temp.v3_definition())$q$,'23503');
set local role service_role;
select pg_temp.reject($q$select public.get_field_draft_v2('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004')$q$,'23514');
select pg_temp.reject($q$select public.save_field_draft_v2('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004',0,2,'{"schemaVersion":2,"fields":[]}')$q$,'23514');
reset role;
-- Removing a sidecar does not switch its durable family.
delete from public.field_drafts_v3 where flow_id='a0000000-0000-4000-8000-000000000004';
set local role service_role;
select pg_temp.reject($q$select public.save_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000004',0,2,pg_temp.definition())$q$,'23514');
reset role;
do $$declare role_name text; table_name text; privilege_name text;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach table_name in array array['public.field_draft_families','public.field_drafts_v3','public.text_field_drafts'] loop
   foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    perform pg_temp.assert(not has_table_privilege(role_name,table_name,privilege_name),'no direct privilege');end loop;
  end loop;
  perform pg_temp.assert(not has_function_privilege(role_name,'lumin.check_field_family(uuid,uuid,smallint,boolean)','EXECUTE'),'family helper private');
  perform pg_temp.assert(not has_function_privilege(role_name,'lumin.field_definition_v3_valid(jsonb)','EXECUTE'),'validator private');
 end loop;
end$$;
set local role anon;
select pg_temp.reject($q$select * from public.field_draft_families$q$,'42501');
select pg_temp.reject($q$insert into public.field_draft_families default values$q$,'42501');
select pg_temp.reject($q$update public.field_draft_families set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.field_draft_families$q$,'42501');
select pg_temp.reject($q$truncate public.field_draft_families$q$,'42501');
select pg_temp.reject($q$select * from public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$insert into public.field_drafts_v3 default values$q$,'42501');
select pg_temp.reject($q$update public.field_drafts_v3 set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$truncate public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$select * from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$insert into public.text_field_drafts default values$q$,'42501');
select pg_temp.reject($q$update public.text_field_drafts set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$truncate public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$select lumin.check_field_family(null,null,1::smallint,false)$q$,'42501');
select pg_temp.reject($q$select lumin.field_definition_v3_valid('{}'::jsonb)$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.reject($q$select * from public.field_draft_families$q$,'42501');
select pg_temp.reject($q$insert into public.field_draft_families default values$q$,'42501');
select pg_temp.reject($q$update public.field_draft_families set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.field_draft_families$q$,'42501');
select pg_temp.reject($q$truncate public.field_draft_families$q$,'42501');
select pg_temp.reject($q$select * from public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$insert into public.field_drafts_v3 default values$q$,'42501');
select pg_temp.reject($q$update public.field_drafts_v3 set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$truncate public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$select * from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$insert into public.text_field_drafts default values$q$,'42501');
select pg_temp.reject($q$update public.text_field_drafts set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$truncate public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$select lumin.check_field_family(null,null,1::smallint,false)$q$,'42501');
select pg_temp.reject($q$select lumin.field_definition_v3_valid('{}'::jsonb)$q$,'42501');
reset role;
set local role service_role;
select pg_temp.reject($q$select * from public.field_draft_families$q$,'42501');
select pg_temp.reject($q$insert into public.field_draft_families default values$q$,'42501');
select pg_temp.reject($q$update public.field_draft_families set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.field_draft_families$q$,'42501');
select pg_temp.reject($q$truncate public.field_draft_families$q$,'42501');
select pg_temp.reject($q$select * from public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$insert into public.field_drafts_v3 default values$q$,'42501');
select pg_temp.reject($q$update public.field_drafts_v3 set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$truncate public.field_drafts_v3$q$,'42501');
select pg_temp.reject($q$select * from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$insert into public.text_field_drafts default values$q$,'42501');
select pg_temp.reject($q$update public.text_field_drafts set flow_id=flow_id$q$,'42501');
select pg_temp.reject($q$delete from public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$truncate public.text_field_drafts$q$,'42501');
select pg_temp.reject($q$select lumin.check_field_family(null,null,1::smallint,false)$q$,'42501');
select pg_temp.reject($q$select lumin.field_definition_v3_valid('{}'::jsonb)$q$,'42501');
reset role;
select pg_temp.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('public.field_draft_families'::regclass,'public.field_drafts_v3'::regclass)),'forced RLS');
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select pg_temp.reject($q$select pg_temp.read_v3()$q$,'42501');select pg_temp.reject($q$select pg_temp.save_v3(0,2)$q$,'42501');
reset role;
rollback;

-- This suite must execute immediately after 0035 and before unchanged legacy suites.
-- Successful rollback restored the committed upgrade row. Remove that exact test
-- sidecar only, preserving its owner, tenant, flow and permanent family authority.
begin;
do $$declare removed integer;begin
 if not exists(select 1 from public.text_field_drafts where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002' and draft_revision=2 and saved_parent_revision=1 and definition='{"schemaVersion":1,"fields":[{"key":"legacy_note","kind":"text","required":false,"minLength":0,"maxLength":20,"prompt":" Before upgrade "}]}'::jsonb) then
  raise exception 'UPGRADE_FIXTURE_CLEANUP_MISMATCH'; end if;
 delete from public.text_field_drafts where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002' and draft_revision=2 and saved_parent_revision=1;
 get diagnostics removed=row_count;
 if removed<>1 then raise exception 'UPGRADE_FIXTURE_CLEANUP_MISMATCH'; end if;
 if not exists(select 1 from public.field_draft_families where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000002' and family=1) then
  raise exception 'UPGRADE_FIXTURE_FAMILY_LOST'; end if;
end$$;
do $$declare removed integer;begin
 if not exists(select 1 from public.field_drafts_v2 where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000003' and draft_revision=1 and saved_parent_revision=1 and definition='{"schemaVersion":2,"fields":[{"key":"old_details","kind":"textarea","required":false,"minLength":0,"maxLength":20,"prompt":" V2 before upgrade "}]}'::jsonb) then raise exception 'UPGRADE_V2_CLEANUP_MISMATCH'; end if;
 delete from public.field_drafts_v2 where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000003';
 get diagnostics removed=row_count;
 if removed<>1 or not exists(select 1 from public.field_draft_families where tenant_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' and flow_id='d0000000-0000-4000-8000-000000000003' and family=2) then raise exception 'UPGRADE_V2_CLEANUP_MISMATCH'; end if;
end$$;
commit;
