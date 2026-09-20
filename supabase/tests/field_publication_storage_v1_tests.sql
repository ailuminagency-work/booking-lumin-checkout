-- Sequential candidate-only fixture. Run only in a reviewed fresh disposable database.
-- No concurrency/race, deployed migration, HTTP identity or customer-runtime claim.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL: statement unexpectedly succeeded';end$$;
create function pg_temp.definition() returns jsonb language sql immutable as $$select '{"schemaVersion":3,"fields":[{"key":"notes","kind":"textarea","required":false,"minLength":0,"maxLength":100,"prompt":" Exact notes "},{"key":"choice","kind":"dropdown","required":false,"choices":[{"id":"First","label":" Same "},{"id":"second","label":" Same "}]}]}'::jsonb$$;
create function pg_temp.authoring() returns jsonb language sql immutable as $$select '{"authoringVersion":2,"config":{"key":"publication_test","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]},"questionOverrides":{}}'::jsonb$$;
create function pg_temp.call_sql(a uuid,t uuid,f uuid,p bigint,d bigint,v uuid) returns text language sql as $$select format('select public.publish_field_snapshot_v1(%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::bigint,%L::uuid)',a,t,f,p,d,v)$$;

do $$
declare owner_a uuid:=gen_random_uuid();owner_b uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();
 tenant_a uuid:=gen_random_uuid();tenant_b uuid:=gen_random_uuid();service_a uuid:=gen_random_uuid();service_b uuid:=gen_random_uuid();
 flow_a uuid:=gen_random_uuid();flow_b uuid:=gen_random_uuid();missing_flow uuid:=gen_random_uuid();family_flow uuid:=gen_random_uuid();
 version_a uuid:=gen_random_uuid();version_b uuid:=gen_random_uuid();artifact jsonb;expected jsonb;before_artifacts jsonb;legacy_before jsonb;role_name text;operation text;f uuid;function_oid oid;signature text;
begin
 insert into auth.users(id,email) values(owner_a,owner_a||'@example.test'),(owner_b,owner_b||'@example.test'),(staff,staff||'@example.test');
 insert into public.tenants(id,name,slug,timezone,currency) values(tenant_a,'Synthetic publication A',tenant_a::text,'UTC','USD'),(tenant_b,'Synthetic publication B',tenant_b::text,'UTC','USD');
 insert into public.tenant_members(tenant_id,user_id,role) values(tenant_a,owner_a,'BUSINESS_OWNER'),(tenant_b,owner_b,'BUSINESS_OWNER'),(tenant_a,staff,'BUSINESS_STAFF');
 insert into public.services(id,tenant_id,archetype,name,currency,base_price) values(service_a,tenant_a,'simple','Synthetic publication A','USD',0),(service_b,tenant_b,'simple','Synthetic publication B','USD',0);
 insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values(tenant_a,service_a,'count','Count','quantity',true,0,1,5,'[]'),(tenant_b,service_b,'count','Count','quantity',true,0,1,5,'[]');
 foreach f in array array[flow_a,missing_flow,family_flow] loop perform public.save_configurable_flow_draft(owner_a,tenant_a,f,service_a,0,'Synthetic field parent',pg_temp.authoring());end loop;
 perform public.save_configurable_flow_draft(owner_b,tenant_b,flow_b,service_b,0,'Foreign field parent',pg_temp.authoring());
 perform public.save_field_draft_v3(owner_a,tenant_a,flow_a,0,1,pg_temp.definition());
 perform public.save_field_draft_v3(owner_b,tenant_b,flow_b,0,1,pg_temp.definition());
 perform public.save_field_draft_v2(owner_a,tenant_a,family_flow,0,1,'{"schemaVersion":2,"fields":[]}');
 select jsonb_build_array((select count(*) from public.flow_versions),(select count(*) from public.bound_flow_versions),(select count(*) from public.flow_installations),(select count(*) from public.flow_sessions),(select count(*) from public.mode_flow_installations),(select count(*) from public.mode_flow_sessions),(select jsonb_agg(to_jsonb(x) order by id) from public.flows x where tenant_id in(tenant_a,tenant_b))) into legacy_before;

 perform pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.field_publication_versions_v1'::regclass),'FORCE RLS enabled');
 signature:='public.publish_field_snapshot_v1(uuid,uuid,uuid,bigint,bigint,uuid)';
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach operation in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop perform pg_temp.assert(not has_table_privilege(role_name,'public.field_publication_versions_v1',operation),'no direct table privilege '||role_name||' '||operation);end loop;
  perform pg_temp.assert(has_function_privilege(role_name,signature,'EXECUTE')=(role_name='service_role'),'RPC role grant '||role_name);
  if role_name<>'service_role' then execute format('set local role %I',role_name);perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,1,1,version_a),'42501');execute 'reset role';end if;
 end loop;
 perform pg_temp.assert(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'no PUBLIC RPC execution');
 -- Candidate helper names must remain unexposed, even to service_role.
 perform pg_temp.assert((select count(*)=2 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lumin' and p.proname in('field_publication_v1_valid','reject_field_publication_v1_mutation')),'both expected helpers exist');
 for function_oid in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lumin' and p.proname like '%field_publication%' loop
  foreach role_name in array array['anon','authenticated','service_role'] loop perform pg_temp.assert(not has_function_privilege(role_name,function_oid,'EXECUTE'),'helper unexposed');end loop;
  perform pg_temp.assert(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=function_oid and a.grantee=0 and a.privilege_type='EXECUTE'),'no PUBLIC helper execution');
 end loop;

 execute 'set local role service_role';
 perform pg_temp.reject('select * from public.field_publication_versions_v1','42501');
 perform pg_temp.reject('delete from public.field_publication_versions_v1','42501');
 perform pg_temp.reject('update public.field_publication_versions_v1 set envelope=envelope','42501');
 perform pg_temp.reject('truncate public.field_publication_versions_v1','42501');
 perform pg_temp.reject('insert into public.field_publication_versions_v1 default values','42501');
 perform pg_temp.reject('select lumin.field_publication_v1_valid(null)','42501');
 perform pg_temp.reject(pg_temp.call_sql(owner_b,tenant_a,flow_a,1,1,version_a),'42501');
 perform pg_temp.reject(pg_temp.call_sql(staff,tenant_a,flow_a,1,1,version_a),'42501');
 perform pg_temp.reject(pg_temp.call_sql(gen_random_uuid(),tenant_a,flow_a,1,1,version_a),'42501');
 execute 'reset role';
 perform pg_temp.assert(not exists(select 1 from public.field_publication_versions_v1 where tenant_id in(tenant_a,tenant_b)),'denials created no artifact');

 execute 'set local role service_role';
 artifact:=public.publish_field_snapshot_v1(owner_a,tenant_a,flow_a,1,1,version_a);
 execute 'reset role';
 expected:=jsonb_build_object('fieldPublicationVersion',1,'tenantId',tenant_a::text,'flowId',flow_a::text,'versionId',version_a::text,'parentAuthoringVersion',2,'sourceParentRevision',1,'sourceFieldDraftRevision',1,'definition',pg_temp.definition(),'submissionMode','unconfirmed_request');
 perform pg_temp.assert(artifact=expected,'exact authoritative canonical envelope');
 perform pg_temp.assert(lumin.field_publication_v1_valid(expected),'valid envelope parity');
 foreach operation in array array['fieldPublicationVersion','tenantId','flowId','versionId','parentAuthoringVersion','sourceParentRevision','sourceFieldDraftRevision','definition','submissionMode'] loop perform pg_temp.assert(not lumin.field_publication_v1_valid(expected-operation),'missing envelope key rejected');end loop;
 perform pg_temp.assert(not lumin.field_publication_v1_valid(expected||'{"authorized":true}'::jsonb),'unknown authority rejected');
 perform pg_temp.assert(not lumin.field_publication_v1_valid(jsonb_set(expected,'{sourceParentRevision}','0')),'zero source revision rejected');
 perform pg_temp.assert(not lumin.field_publication_v1_valid(jsonb_set(expected,'{sourceFieldDraftRevision}','9007199254740992')),'unsafe source revision rejected');
 perform pg_temp.assert(not lumin.field_publication_v1_valid(jsonb_set(expected,'{definition,schemaVersion}','2')),'cross-version definition rejected');
 perform pg_temp.assert(not lumin.field_publication_v1_valid(jsonb_set(expected,'{definition,fields,1,choices,1,id}','"First"')),'duplicate opaque choice ID rejected');
 perform pg_temp.assert((select envelope=expected and source_parent_revision=1 and source_field_draft_revision=1 from public.field_publication_versions_v1 where version_id=version_a and tenant_id=tenant_a and flow_id=flow_a),'stored tuple and envelope');
 select jsonb_agg(to_jsonb(x) order by version_id) into before_artifacts from public.field_publication_versions_v1 x;
 -- SQLSTATEs for storage conflicts are supplied by the independently reviewed candidate.
 perform pg_temp.reject(format('update public.field_publication_versions_v1 set envelope=envelope where version_id=%L',version_a),'23514');
 perform pg_temp.reject(format('delete from public.field_publication_versions_v1 where version_id=%L',version_a),'23514');
 execute 'set local role service_role';
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,1,1,version_a),'40001');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,1,1,gen_random_uuid()),'40001');
 perform pg_temp.reject(pg_temp.call_sql(owner_b,tenant_b,flow_b,1,1,version_a),'40001');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,2,1,gen_random_uuid()),'40001');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,1,2,gen_random_uuid()),'40001');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_b,1,1,gen_random_uuid()),'P0002');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,missing_flow,1,1,gen_random_uuid()),'0A000');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,family_flow,1,1,gen_random_uuid()),'23514');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,0,1,gen_random_uuid()),'22023');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,1,0,gen_random_uuid()),'22023');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,9007199254740992,1,gen_random_uuid()),'22023');
 perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,1,1,null),'22023');
 execute 'reset role';
 perform pg_temp.assert((select jsonb_agg(to_jsonb(x) order by version_id)=before_artifacts from public.field_publication_versions_v1 x),'all conflict and immutable attacks preserved artifacts');

 perform public.save_field_draft_v3(owner_a,tenant_a,flow_a,1,1,pg_temp.definition());
 execute 'set local role service_role';artifact:=public.publish_field_snapshot_v1(owner_a,tenant_a,flow_a,1,2,version_b);execute 'reset role';
 perform pg_temp.assert(artifact->'sourceParentRevision'='1'::jsonb and artifact->'sourceFieldDraftRevision'='2'::jsonb,'same parent accepts distinct field revision');
 perform pg_temp.assert((select count(*)=2 from public.field_publication_versions_v1 where tenant_id=tenant_a and flow_id=flow_a),'exactly two distinct artifacts');
 perform pg_temp.assert((select envelope=expected from public.field_publication_versions_v1 where version_id=version_a),'old artifact unchanged after new sidecar');
 perform pg_temp.assert(legacy_before=jsonb_build_array((select count(*) from public.flow_versions),(select count(*) from public.bound_flow_versions),(select count(*) from public.flow_installations),(select count(*) from public.flow_sessions),(select count(*) from public.mode_flow_installations),(select count(*) from public.mode_flow_sessions),(select jsonb_agg(to_jsonb(x) order by id) from public.flows x where tenant_id in(tenant_a,tenant_b))),'no legacy activation, installation or session changes');
 select jsonb_agg(to_jsonb(x) order by version_id) into before_artifacts from public.field_publication_versions_v1 x;
 -- Parent advance does not implicitly rebind the existing sidecar.
 perform public.save_configurable_flow_draft(owner_a,tenant_a,flow_a,service_a,1,'Synthetic field parent',pg_temp.authoring());
 execute 'set local role service_role';perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,2,2,gen_random_uuid()),'40001');execute 'reset role';
 update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=tenant_a and user_id=owner_a;
 execute 'set local role service_role';perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,2,2,gen_random_uuid()),'42501');execute 'reset role';
 update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=tenant_a and user_id=owner_a;
 delete from public.tenant_members where tenant_id=tenant_a and user_id=owner_a;
 execute 'set local role service_role';perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,2,2,gen_random_uuid()),'42501');execute 'reset role';
 insert into public.tenant_members(tenant_id,user_id,role) values(tenant_a,owner_a,'BUSINESS_OWNER');
 update public.tenants set status='suspended' where id=tenant_a;
 execute 'set local role service_role';perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,2,2,gen_random_uuid()),'42501');execute 'reset role';
 update public.tenants set status='active' where id=tenant_a;
 update public.flows set status='archived' where tenant_id=tenant_a and id=flow_a;
 execute 'set local role service_role';perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,flow_a,2,2,gen_random_uuid()),'P0002');execute 'reset role';
 -- Distinguish an absent family from a claimed family whose sidecar is missing.
 perform public.save_field_draft_v3(owner_a,tenant_a,missing_flow,0,1,pg_temp.definition());
 delete from public.field_drafts_v3 where tenant_id=tenant_a and flow_id=missing_flow;
 execute 'set local role service_role';perform pg_temp.reject(pg_temp.call_sql(owner_a,tenant_a,missing_flow,1,1,gen_random_uuid()),'P0002');execute 'reset role';
 perform pg_temp.assert((select jsonb_agg(to_jsonb(x) order by version_id)=before_artifacts from public.field_publication_versions_v1 x),'stale revocation archive and missing sidecar attacks preserve immutable artifacts');
end$$;
rollback;
