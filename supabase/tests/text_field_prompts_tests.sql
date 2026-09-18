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

-- Scalar parity corpus matches fieldPrompts.test.ts. No JSON text normalization.
create function pg_temp.prompt_definition(value text) returns jsonb language sql immutable as $$
 select jsonb_set(pg_temp.definition(),'{fields,0,prompt}',to_jsonb(value))
$$;
do $$declare value text; code integer;begin
 foreach value in array array[' Question? ','<b>Plain text</b>',chr(133),chr(8203),repeat(chr(128512),200),repeat('a',200),repeat('e'||chr(769),100)] loop
  perform pg_temp.assert(lumin.text_field_definition_valid(pg_temp.prompt_definition(value)),'valid exact prompt');
 end loop;
 foreach value in array array['',repeat('a',201),repeat(chr(128512),201),'x'||chr(10)||'y','x'||chr(13)||'y','x'||chr(8232)||'y','x'||chr(8233)||'y'] loop
  perform pg_temp.assert(not lumin.text_field_definition_valid(pg_temp.prompt_definition(value)),'invalid prompt');
 end loop;
 foreach code in array array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279] loop
  perform pg_temp.assert(not lumin.text_field_definition_valid(pg_temp.prompt_definition(chr(code))),'ECMAScript blank');
 end loop;
 perform pg_temp.assert(lumin.text_field_definition_valid(pg_temp.definition()),'old omitted prompt valid');
 perform pg_temp.assert(not lumin.text_field_definition_valid(jsonb_set(pg_temp.definition(),'{fields,0,prompt}','null')),'explicit null rejected');
 perform pg_temp.assert(not lumin.text_field_definition_valid(jsonb_set(pg_temp.definition(),'{fields,0,prompt}','42')),'nonstring rejected');
end$$;
select pg_temp.assert((select provolatile='i' and not prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid='lumin.text_field_definition_valid(jsonb)'::regprocedure),'validator attributes preserved');
do $$declare app_role text;begin
 foreach app_role in array array['anon','authenticated','service_role'] loop
  perform pg_temp.assert(not has_function_privilege(app_role,'lumin.text_field_definition_valid(jsonb)','EXECUTE'),'helper denied');
  perform pg_temp.assert(not has_table_privilege(app_role,'public.text_field_drafts','INSERT,UPDATE,DELETE,TRUNCATE,SELECT'),'direct data denied');
 end loop;
end$$;
set local role service_role;
select pg_temp.parent_save(0);
select pg_temp.save_text(0,1);
select pg_temp.assert(not ((pg_temp.read_text()->'receipt'->'definition'->'fields'->0) ? 'prompt'),'old omitted roundtrip');
select pg_temp.assert(public.save_text_field_draft('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002',1,1,pg_temp.prompt_definition('  Question '||chr(128512)||' <b>text</b> '))->'draftRevision'='2'::jsonb,'prompt update CAS');
select pg_temp.assert(pg_temp.read_text()->'receipt'->'definition'=pg_temp.prompt_definition('  Question '||chr(128512)||' <b>text</b> '),'exact prompt roundtrip');
select pg_temp.reject($q$select pg_temp.save_text(1,1)$q$,'40001');
select pg_temp.parent_save(1);
select pg_temp.reject($q$select pg_temp.save_text(2,1)$q$,'40001');
select pg_temp.assert(pg_temp.read_text()->'receipt'->'savedParentRevision'='1'::jsonb and pg_temp.read_text()->'receipt'->'currentParentRevision'='2'::jsonb and pg_temp.read_text()->'receipt'->'draftRevision'='2'::jsonb,'conflicts preserve stale history');
select pg_temp.assert(pg_temp.read_text()->'receipt'->'definition'=pg_temp.prompt_definition('  Question '||chr(128512)||' <b>text</b> '),'conflicts preserve prompt');
select pg_temp.reject($q$select public.get_text_field_draft('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.reject($q$select public.get_text_field_draft('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.reject($q$update public.text_field_drafts set draft_revision=99$q$,'42501');
reset role;
rollback;
