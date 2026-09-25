-- DISPOSABLE DATABASE FIXTURE ONLY. Invoked only by mode_session_validation_compatibility.py --run.
\set ON_ERROR_STOP on
begin;
set local transaction isolation level read committed;
set local statement_timeout='5s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='1s';
create schema compat_test;
create table compat_test.fixture(tenant_id uuid, flow_id uuid, installation_id uuid,
 version_id uuid, session_id uuid, issued_at timestamptz, expires_at timestamptz,
 token_hash text, issue_receipt jsonb, rotation_version_id uuid, concurrent_version_id uuid);
create table compat_test.expiry_race(session_id uuid primary key, token_hash text not null unique,
 expires_at timestamptz not null);
insert into lumin.installation_profiles values('compat-unit','https://renderer.test','https://api.test','https://portal.test',repeat('a',64));
insert into auth.users(id,email) values('e1000000-0000-4000-8000-000000000001','owner@test.invalid');
insert into public.tenants(id,name,slug,timezone,currency) values('e1000000-0000-4000-8000-000000000002','Compatibility test','compat-test-tenant','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values('e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000002','simple','Compatibility service','USD',0,60);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty) values('e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','count','How many?','quantity',true,0,1,5);
do $fixture$
declare owner_id uuid:='e1000000-0000-4000-8000-000000000001'; tenant_id uuid:='e1000000-0000-4000-8000-000000000002';
 flow_id uuid:='e1000000-0000-4000-8000-000000000004'; service_id uuid:='e1000000-0000-4000-8000-000000000003';
 config jsonb:='{"key":"unit","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}';
 published jsonb; installed jsonb; issued jsonb; version_id uuid; installation_id uuid; next_version uuid; concurrent_version uuid; row public.mode_flow_sessions;
begin
 perform public.save_bound_flow_draft(owner_id,tenant_id,flow_id,service_id,0,'Compatibility',config);
 published:=public.mode_publish_flow(owner_id,tenant_id,flow_id,1,'compat_publish_01');
 version_id:=(published->>'versionId')::uuid;
 installed:=public.mode_install_flow(owner_id,tenant_id,flow_id,version_id,version_id,'iframe','compat-unit','["https://merchant.test"]','compat_install_01');
 installation_id:=(installed->>'installationId')::uuid;
 issued:=public.mode_issue_flow_session(installation_id,repeat('a',64),'https://renderer.test','https://merchant.test','compat-unit',version_id,1,1);
 select * into row from public.mode_flow_sessions where id=(issued->>'sessionId')::uuid;
 if row.id is null then raise exception 'COMPAT_FIXTURE_ISSUE_MISSING';end if;
 perform public.save_bound_flow_draft(owner_id,tenant_id,flow_id,service_id,1,'Compatibility version two',config);
 published:=public.mode_publish_flow(owner_id,tenant_id,flow_id,2,'compat_publish_03');next_version:=(published->>'versionId')::uuid;
 perform public.save_bound_flow_draft(owner_id,tenant_id,flow_id,service_id,2,'Compatibility version three',config);
 published:=public.mode_publish_flow(owner_id,tenant_id,flow_id,3,'compat_publish_04');concurrent_version:=(published->>'versionId')::uuid;
 insert into compat_test.fixture values(tenant_id,flow_id,installation_id,version_id,row.id,row.issued_at,row.expires_at,row.token_hash,issued,next_version,concurrent_version);
end $fixture$;
insert into public.tenants(id,name,slug,timezone,currency) values('e2000000-0000-4000-8000-000000000002','Foreign compatibility test','compat-test-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values('e2000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000002','simple','Foreign compatibility service','USD',0,60);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty) values('e2000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000003','count','How many?','quantity',true,0,1,5);
do $foreign$
declare owner_id uuid:='e1000000-0000-4000-8000-000000000001'; tenant_id uuid:='e2000000-0000-4000-8000-000000000002';
 flow_id uuid:='e2000000-0000-4000-8000-000000000004'; service_id uuid:='e2000000-0000-4000-8000-000000000003';
 config jsonb:='{"key":"unit","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}';
 published jsonb; installed jsonb; issued jsonb; version_id uuid; installation_id uuid; row public.mode_flow_sessions;
begin
 perform public.save_bound_flow_draft(owner_id,tenant_id,flow_id,service_id,0,'Foreign compatibility',config);
 published:=public.mode_publish_flow(owner_id,tenant_id,flow_id,1,'compat_publish_02');version_id:=(published->>'versionId')::uuid;
 installed:=public.mode_install_flow(owner_id,tenant_id,flow_id,version_id,version_id,'iframe','compat-unit','["https://merchant.test"]','compat_install_02');
 installation_id:=(installed->>'installationId')::uuid;
 issued:=public.mode_issue_flow_session(installation_id,repeat('b',64),'https://renderer.test','https://merchant.test','compat-unit',version_id,1,1);
 select * into row from public.mode_flow_sessions where id=(issued->>'sessionId')::uuid;
 if row.id is null then raise exception 'COMPAT_FOREIGN_ISSUE_MISSING';end if;
 insert into compat_test.fixture(tenant_id,flow_id,installation_id,version_id,session_id,issued_at,expires_at,token_hash,issue_receipt)
 values(tenant_id,flow_id,installation_id,version_id,row.id,row.issued_at,row.expires_at,row.token_hash,issued);
end $foreign$;
commit;
