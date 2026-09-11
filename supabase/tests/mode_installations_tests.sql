-- Self-contained S1 units. Trusted synthetic fixtures are rolled back in full.
\set ON_ERROR_STOP on
begin;
create function pg_temp.mode_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.mode_reject(q text,expected text,message text default null) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=expected and (message is null or sqlerrm=message) then return;end if;raise;end;raise exception 'FAIL accepted: %',q;end $$;
create function pg_temp.mode_null_reject(q text,expected_table text,expected_column text) returns void language plpgsql as $$declare actual_column text;actual_table text;actual_schema text;begin begin execute q;exception when not_null_violation then get stacked diagnostics actual_column=COLUMN_NAME,actual_table=TABLE_NAME,actual_schema=SCHEMA_NAME;if actual_column=expected_column and actual_table=split_part(expected_table,'.',2) and actual_schema=split_part(expected_table,'.',1) then return;end if;raise exception 'FAIL NULL rejected wrong target: %.%.%',actual_schema,actual_table,actual_column;end;raise exception 'FAIL accepted NULL column: %',q;end $$;
create function pg_temp.mode_snapshot(t uuid) returns jsonb language sql as $$select jsonb_build_object(
 'flows',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.flows x where tenant_id=t),
 'versions',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.flow_versions x where tenant_id=t),
 'bindings',(select coalesce(jsonb_agg(to_jsonb(x) order by version_id),'[]') from public.bound_flow_versions x where tenant_id=t),
 'installations',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.mode_flow_installations x where tenant_id=t),
 'history',(select coalesce(jsonb_agg(to_jsonb(x) order by installation_id,sequence),'[]') from public.mode_flow_installation_history x where tenant_id=t),
 'operations',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,flow_id,operation,idempotency_key),'[]') from public.mode_flow_owner_operations x where tenant_id=t)) $$;
create function pg_temp.mode_update_marker() returns trigger language plpgsql as $$begin raise exception 'ROW_MUTATION_REACHED' using errcode='P0001';end $$;
create function pg_temp.mode_fault() returns trigger language plpgsql as $$begin if new.idempotency_key like 'forced_fault_%' then raise exception 'TEST_LATE_FAULT' using errcode='22023';end if;return new;end $$;
create trigger zz_mode_unit_fault before insert on public.mode_flow_owner_operations for each row execute function pg_temp.mode_fault();
do $test$
declare a uuid:=gen_random_uuid();a2 uuid:=gen_random_uuid();other uuid:=gen_random_uuid();t uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();s uuid:=gen_random_uuid();f uuid:=gen_random_uuid();f2 uuid:=gen_random_uuid();v uuid;v2 uuid;i uuid;i2 uuid;pub jsonb;inst jsonb;result jsonb;before_state jsonb;payload jsonb;rowop public.mode_flow_owner_operations;origin text;role_name text;tab text;priv text;col record;baseline jsonb;forged jsonb;names text[];j integer;page jsonb;rich jsonb;expected_count bigint;bulk_id uuid;
 cfg jsonb:='{"key":"unit","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}';
begin
 perform pg_temp.mode_assert((select count(*)=0 from lumin.installation_profiles),'migration has zero profiles');
 baseline:=jsonb_build_object('legacyInstall',(select count(*) from public.flow_installations),'sessions',(select count(*) from public.flow_sessions),'requests',(select count(*) from public.flow_requests),'bookings',(select count(*) from public.bookings));
 foreach origin in array array['https://localhost','https://example.test','https://0xg','https://x.example:8443','https://a-b.example:65535'] loop perform pg_temp.mode_assert(lumin.mode_origin(origin),'valid origin '||origin);end loop;
 foreach origin in array array['http://example.test','https://EXAMPLE.test','https://example.test/','https://example.test:443','https://example.test:0443','https://example.test:0','https://example.test:65536','https://0x7f000001','https://0x','https://example.0xabc','https://127.0.0.1','https://[::1]','https://xn--a.example','https://xn--abc.example','https://xn--bcher-kva.example','https://www.xn--bcher-kva.example','https://example..test','https://example.test.','https://*.example.test','https://example.test?x','https://a@example.test','https://a_b.example','https://x.example:1:2'] loop perform pg_temp.mode_assert(not lumin.mode_origin(origin),'reject origin '||origin);end loop;
 perform pg_temp.mode_assert(not lumin.mode_origin(null),'null origin');perform pg_temp.mode_assert(not lumin.mode_origin('https://'||repeat('a',64)||'.test'),'label bound');
 perform pg_temp.mode_assert(lumin.mode_parents('["https://z.test","https://a.test"]')='["https://a.test","https://z.test"]','canonical array sorting');
 perform pg_temp.mode_reject($q$select lumin.mode_parents('["https://a.test","https://a.test"]')$q$,'22023');perform pg_temp.mode_reject($q$select lumin.mode_parents('[null]')$q$,'22023');perform pg_temp.mode_reject($q$select lumin.mode_parents('null')$q$,'22023');
 perform pg_temp.mode_reject('select public.mode_public_installation_policy(null)','22023');perform pg_temp.mode_reject(format('select public.mode_public_installation_policy(%L)',gen_random_uuid()),'P0002');
 raise notice 'PASS S1 origin subset, canonical ordering and rejected aliases';
 foreach origin in array array[chr(10),chr(13)||chr(10),chr(8232)] loop
  perform pg_temp.mode_assert(not lumin.mode_origin('https://example.test'||origin),'origin control suffix');
  perform pg_temp.mode_assert(not lumin.mode_uuid(to_jsonb(a::text||origin)),'UUID control suffix');
  perform pg_temp.mode_reject(format('insert into lumin.installation_profiles values(%L,''https://r.test'',''https://a.test'',''https://p.test'',%L)','suffix'||origin,repeat('a',64)),'23514');
  perform pg_temp.mode_reject(format('select public.mode_publish_flow(%L,%L,%L,1,%L)',a,t,f,'publish_key_00001'||origin),'22023');
 end loop;

 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach tab in array array['lumin.installation_profiles','public.mode_flow_installations','public.mode_flow_installation_history','public.mode_flow_owner_operations'] loop
   foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop perform pg_temp.mode_assert(not has_table_privilege(role_name,tab,priv),'raw ACL '||role_name||tab||priv);end loop;
   perform pg_temp.mode_assert((select relrowsecurity and relforcerowsecurity from pg_class where oid=tab::regclass),'forced RLS '||tab);
  end loop;
  perform pg_temp.mode_assert(not has_function_privilege(role_name,'lumin.mode_finish(uuid,uuid,uuid,text,text,jsonb,jsonb)','EXECUTE'),'helper denied');
 end loop;
 -- Scope this retained S1 assertion by exact signatures; S2 units verify the complete combined namespace.
 perform pg_temp.mode_assert((with expected(signature) as (values
  ('public.mode_publish_flow(uuid,uuid,uuid,bigint,text)'),
  ('public.mode_install_flow(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text)'),
  ('public.mode_apply_flow_version(uuid,uuid,uuid,uuid,bigint,uuid,uuid,text)'),
  ('public.mode_update_flow_policy(uuid,uuid,uuid,uuid,bigint,boolean,jsonb,text)'),
  ('public.mode_public_installation_policy(uuid)'),
  ('public.mode_owner_operation(uuid,uuid,uuid,text,text)'),
  ('public.mode_owner_installations(uuid,uuid,uuid,uuid,integer)'),
  ('public.mode_owner_installation_history(uuid,uuid,uuid,uuid,bigint,integer)'))
 select bool_and(coalesce(p.prosecdef and p.proconfig=array['search_path=pg_catalog']
  and has_function_privilege('service_role',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE'),false))
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)),
 'exact eight S1 RPC signatures and grants');
 perform pg_temp.mode_assert(not exists(select 1 from pg_attribute where attrelid in('lumin.installation_profiles'::regclass,'public.mode_flow_installations'::regclass,'public.mode_flow_installation_history'::regclass,'public.mode_flow_owner_operations'::regclass) and attnum>0 and not attisdropped and not attnotnull),'all columns NOT NULL');
 insert into lumin.installation_profiles values('unit-v1','https://renderer.test','https://api.test','https://portal.test',repeat('a',64));
 perform pg_temp.mode_reject($q$update lumin.installation_profiles set loader_sha256=repeat('b',64)$q$,'55000');perform pg_temp.mode_reject($q$delete from lumin.installation_profiles$q$,'55000');
 insert into auth.users(id,email) values(a,a||'@example.test'),(a2,a2||'@example.test'),(other,other||'@example.test');
 insert into public.tenants(id,name,slug,timezone,currency) values(t,'Unit A',t::text,'UTC','USD'),(t2,'Unit B',t2::text,'UTC','USD');
 insert into public.tenant_members(tenant_id,user_id,role) values(t,a,'BUSINESS_OWNER'),(t,a2,'BUSINESS_OWNER'),(t2,other,'BUSINESS_OWNER');
 insert into public.services(id,tenant_id,archetype,name,currency,base_price) values(s,t,'simple','Unit Service','USD',0);
 insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values(t,s,'count','How many?','quantity',true,0,1,5,'[]');
 execute 'set local role service_role';
 perform pg_temp.mode_reject('select * from lumin.installation_profiles','42501');perform pg_temp.mode_reject('delete from public.mode_flow_installations','42501');perform pg_temp.mode_reject('select lumin.mode_origin(''https://example.test'')','42501');
 perform public.save_bound_flow_draft(a,t,f,s,0,'Unit flow',cfg);pub:=public.mode_publish_flow(a,t,f,1,'publish_key_00001');v:=(pub->>'versionId')::uuid;
 perform pg_temp.mode_assert(pub=public.mode_publish_flow(a,t,f,1,'publish_key_00001'),'exact publication retry');perform pg_temp.mode_assert(pub=public.mode_owner_operation(a,t,f,'publish','publish_key_00001'),'exact recovery');
 perform pg_temp.mode_reject(format('select public.mode_owner_operation(%L,%L,%L,''publish'',''publish_key_00001'')',a2,t,f),'P0002');
 perform pg_temp.mode_reject(format('select public.mode_publish_flow(%L,%L,%L,2,''publish_key_00001'')',a,t,f),'40001');perform pg_temp.mode_reject(format('select public.mode_publish_flow(%L,%L,%L,1,''publish_key_00002'')',a,t,f),'40001');
 perform pg_temp.mode_reject(format('select public.mode_publish_flow(%L,%L,%L,1,''publish_key_00003'')',other,t,f),'42501');
 inst:=public.mode_install_flow(a,t,f,v,v,'iframe','unit-v1','["https://z.test","https://a.test"]','install_key_00001');i:=(inst->>'installationId')::uuid;
 perform pg_temp.mode_assert(inst->'allowedParentOrigins'='["https://a.test","https://z.test"]','stored sorted parents');perform pg_temp.mode_assert(inst=public.mode_install_flow(a,t,f,v,v,'iframe','unit-v1','["https://a.test","https://z.test"]','install_key_00001'),'same set exact retry');
 result:=public.mode_install_flow(a2,t,f,v,v,'hosted','unit-v1','[]','install_key_00001');i2:=(result->>'installationId')::uuid;perform pg_temp.mode_assert(i<>i2 and result->>'actorId'=a2::text,'independent owner same-key scope');
 result:=public.mode_public_installation_policy(i);perform pg_temp.mode_assert(result-array['schemaVersion','installationId','mode','deploymentProfileVersion','rendererOrigin','apiOrigin','loaderUrl','currentVersionId','targetRevision','policyRevision','allowedParentOrigins','enabled']='{}','strict public keys');perform pg_temp.mode_assert(result->>'loaderUrl'='https://renderer.test/assets/booking-lumin-loader.'||repeat('a',64)||'.js','exact loader');
 perform pg_temp.mode_reject(format('select public.mode_install_flow(%L,%L,%L,%L,%L,''hosted'',''unit-v1'',''["https://a.test"]'',''install_key_bad01'')',a,t,f,v,v),'22023');
 perform pg_temp.mode_reject(format('select public.mode_install_flow(%L,%L,%L,%L,%L,''iframe'',''unit-v1'',''["https://portal.test"]'',''install_key_bad02'')',a,t,f,v,v),'22023');
 execute 'set local role none';
 perform pg_temp.mode_assert((select count(*)=2 from public.mode_flow_installations where tenant_id=t),'only explicitly installed modes');perform pg_temp.mode_assert((select count(*)=2 from public.mode_flow_installation_history where tenant_id=t),'initial history once');
 raise notice 'PASS S1 raw authority, publication-only, actor-scoped retry and explicit modes';
 foreach role_name in array array['anon','authenticated','service_role'] loop
  for col in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lumin' and p.proname like 'mode\_%' escape '\' loop
   perform pg_temp.mode_assert(not has_function_privilege(role_name,col.oid,'EXECUTE'),'all helper grants denied');
  end loop;
  execute format('set local role %I',role_name);
  foreach tab in array array['lumin.installation_profiles','public.mode_flow_installations','public.mode_flow_installation_history','public.mode_flow_owner_operations'] loop
   perform pg_temp.mode_reject('insert into '||tab||' default values','42501');
   perform pg_temp.mode_reject('delete from '||tab,'42501');
   perform pg_temp.mode_reject('truncate '||tab,'42501');
   perform pg_temp.mode_reject('update '||tab||case when tab='lumin.installation_profiles' then ' set version=version' else ' set tenant_id=tenant_id' end,'42501');
  end loop;
  execute 'set local role none';
 end loop;

 before_state:=pg_temp.mode_snapshot(t);
 execute 'set local role service_role';
 result:=public.mode_apply_flow_version(a,t,f,i,1,v,v,'apply_noop_000001');perform pg_temp.mode_assert(result->'changed'='false' and result->'targetRevision'='1','target no-op');
 result:=public.mode_update_flow_policy(a,t,f,i,1,true,'["https://z.test","https://a.test"]','policy_noop_00001');perform pg_temp.mode_assert(result->'changed'='false' and result->'policyRevision'='1','policy set no-op');
 execute 'set local role none';perform pg_temp.mode_assert((select count(*)=2 from public.mode_flow_installation_history where tenant_id=t),'no-op preserves history');
 execute 'set local role service_role';
 perform public.save_bound_flow_draft(a,t,f,s,1,'Updated flow',cfg);result:=public.mode_publish_flow(a,t,f,2,'publish_key_00002');v2:=(result->>'versionId')::uuid;
 result:=public.mode_apply_flow_version(a,t,f,i,1,v,v2,'apply_key_000001');perform pg_temp.mode_assert(result->'targetRevision'='2' and result->'policyRevision'='1','apply affects target only');
 perform pg_temp.mode_assert(inst=public.mode_install_flow(a,t,f,v,v,'iframe','unit-v1','["https://a.test","https://z.test"]','install_key_00001'),'historical install retry after target publication');
 result:=public.mode_update_flow_policy(a,t,f,i,1,false,'["https://a.test"]','policy_key_00001');perform pg_temp.mode_assert(result->'targetRevision'='2' and result->'policyRevision'='2','disable affects policy only');
 perform pg_temp.mode_reject(format('select public.mode_public_installation_policy(%L)',i),'P0002');
 result:=public.mode_apply_flow_version(a,t,f,i,2,v2,v,'apply_rollback01');perform pg_temp.mode_assert(result->'targetRevision'='3' and result->'currentVersionId'=to_jsonb(v::text),'retained old target rollback');
 result:=public.mode_update_flow_policy(a,t,f,i,2,true,'["https://a.test"]','policy_key_00002');perform pg_temp.mode_assert(result->'policyRevision'='3','reenable new revision');
 result:=public.mode_owner_installations(a,t,f,null,1);perform pg_temp.mode_assert(jsonb_array_length(result->'installations')=1 and result->>'nextCursor' is not null,'owner list cursor');result:=public.mode_owner_installations(a,t,f,(result->>'nextCursor')::uuid,1);perform pg_temp.mode_assert(jsonb_array_length(result->'installations')=1 and result->'nextCursor'='null','second page end');
 result:=public.mode_owner_installation_history(a,t,f,i,null,2);perform pg_temp.mode_assert(jsonb_array_length(result->'history')=2 and result->'history'->0->'sequence'='5' and result->'nextCursor'='4','descending history cursor');
 perform pg_temp.mode_reject(format('select public.mode_owner_installations(%L,%L,%L,null,101)',a,t,f),'22023');perform pg_temp.mode_reject(format('select public.mode_owner_installation_history(%L,%L,%L,%L,0,1)',a,t,f,i),'22023');
 perform pg_temp.mode_reject(format('select public.mode_apply_flow_version(%L,%L,%L,%L,1,%L,%L,''apply_bad_cas001'')',a,t,f,i,v,v2),'40001');
 perform pg_temp.mode_reject(format('select public.mode_update_flow_policy(%L,%L,%L,%L,1,true,''["https://a.test"]'',''policy_bad_cas01'')',a,t,f,i),'40001');
 execute 'set local role none';
 perform pg_temp.mode_assert((select count(*)=5 from public.mode_flow_installation_history where tenant_id=t and installation_id=i),'exact real transitions history');
 raise notice 'PASS S1 target/policy CAS, no-ops, immutable old receipts and pagination';
 -- Publication-only V2 preserves the accepted normalized snapshot implementation.
 execute 'set local role service_role';
 perform public.save_configurable_flow_draft(a,t,f2,s,0,'V2 flow',jsonb_build_object('authoringVersion',2,'config',cfg,'questionOverrides','{}'::jsonb));result:=public.mode_publish_flow(a,t,f2,1,'publish_v2_00001');
 execute 'set local role none';perform pg_temp.mode_assert(result->'renderSchemaVersion'='2','V2 marker');
 perform pg_temp.mode_assert((select configurable_snapshot=lumin.normalize_configurable_publication(lumin.flow_service_render(t,s),jsonb_build_object('authoringVersion',2,'config',cfg,'questionOverrides','{}'::jsonb))->'snapshot' from public.flow_versions where id=(result->>'versionId')::uuid),'V2 snapshot parity');
 perform pg_temp.mode_reject(format('update public.flow_versions set config=config where id=%L',v),'55000');
 before_state:=pg_temp.mode_snapshot(t);
 perform pg_temp.mode_reject(format('select public.mode_install_flow(%L,%L,%L,%L,%L,''hosted'',''unit-v1'',''[]'',''forced_fault_install'')',a,t,f,v2,v2),'22023','TEST_LATE_FAULT');perform pg_temp.mode_assert(pg_temp.mode_snapshot(t)=before_state,'late install receipt fault full rollback');
 perform pg_temp.mode_reject(format('select public.mode_apply_flow_version(%L,%L,%L,%L,3,%L,%L,''forced_fault_apply'')',a,t,f,i,v,v2),'22023','TEST_LATE_FAULT');perform pg_temp.mode_assert(pg_temp.mode_snapshot(t)=before_state,'late target receipt fault full rollback');
 perform pg_temp.mode_reject(format('select public.mode_update_flow_policy(%L,%L,%L,%L,3,false,''["https://a.test"]'',''forced_fault_policy'')',a,t,f,i),'22023','TEST_LATE_FAULT');perform pg_temp.mode_assert(pg_temp.mode_snapshot(t)=before_state,'late policy receipt fault full rollback');
 perform public.save_bound_flow_draft(a,t,f,s,2,'Next draft',cfg);before_state:=pg_temp.mode_snapshot(t);
 perform pg_temp.mode_reject(format('select public.mode_publish_flow(%L,%L,%L,3,''forced_fault_publish'')',a,t,f),'22023','TEST_LATE_FAULT');perform pg_temp.mode_assert(pg_temp.mode_snapshot(t)=before_state,'late publication receipt fault full rollback');
 raise notice 'PASS S1 V2 parity and forced late rollback for all owner mutation paths';
 -- Direct stored-shape attacks are independent from RPC input validation.
 for rowop in select * from public.mode_flow_owner_operations where tenant_id=t loop
  perform pg_temp.mode_assert(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,rowop.canonical_payload,rowop.receipt),'stored operation validates');
  perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,rowop.canonical_payload||'{"extra":true}',rowop.receipt),false),'payload extra key denied');
  perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,rowop.canonical_payload,rowop.receipt||'{"extra":true}'),false),'receipt extra key denied');
  for origin in select jsonb_object_keys(rowop.canonical_payload) loop
   perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,jsonb_set(rowop.canonical_payload,array[origin],'null'),rowop.receipt),false),'payload null '||rowop.operation||origin);
  end loop;
  for origin in select jsonb_object_keys(rowop.receipt) loop
   perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,rowop.canonical_payload,jsonb_set(rowop.receipt,array[origin],'null')),false),'receipt null '||rowop.operation||origin);
  end loop;
 end loop;
 select * into rowop from public.mode_flow_owner_operations where tenant_id=t and operation='policy' and idempotency_key='policy_key_00002';
 perform pg_temp.mode_reject(format('insert into public.mode_flow_owner_operations values(%L,%L,%L,%L,%L,%L,%L,%L,clock_timestamp())',t,a,f,'policy','forged_hash_00001',rowop.canonical_payload::text,repeat('0',64),rowop.receipt::text),'23514');
 perform pg_temp.mode_reject(format('insert into public.mode_flow_owner_operations values(%L,%L,%L,%L,%L,%L,%L,%L,clock_timestamp())',t,a2,f,'policy','forged_actor_001',rowop.canonical_payload::text,rowop.payload_sha256,rowop.receipt::text),'23514');
 perform pg_temp.mode_reject(format('update public.mode_flow_installations set mode=''hosted'',allowed_parent_origins=''[]'' where id=%L',i),'55000');
 perform pg_temp.mode_reject(format('delete from public.mode_flow_installations where id=%L',i),'55000');
 perform pg_temp.mode_reject(format('update public.mode_flow_installation_history set enabled=false where installation_id=%L',i),'55000');
 perform pg_temp.mode_reject(format('delete from public.mode_flow_owner_operations where tenant_id=%L',t),'55000');
 perform pg_temp.mode_reject(format('insert into public.mode_flow_installation_history select tenant_id,flow_id,installation_id,sequence+2,operation,target_revision,policy_revision,version_id,enabled,allowed_parent_origins,created_at from public.mode_flow_installation_history where installation_id=%L and sequence=5',i),'23514');
 raise notice 'PASS S1 operation null/unknown keys, forged actor/hash and immutable row attacks';
 -- Trusted exhaustion fixture; only the immutable-history UPDATE trigger is disabled.
 alter table public.mode_flow_installation_history disable trigger mode_history_immutable;
 update public.mode_flow_installation_history set sequence=9007199254740991 where installation_id=i and sequence=5;
 alter table public.mode_flow_installation_history enable trigger mode_history_immutable;
 create trigger zz_mode_before_mutation_marker before update on public.mode_flow_installations for each row execute function pg_temp.mode_update_marker();
 before_state:=pg_temp.mode_snapshot(t);
 perform pg_temp.mode_reject(format('select public.mode_update_flow_policy(%L,%L,%L,%L,3,false,''["https://a.test"]'',''history_exhaust01'')',a,t,f,i),'54000','MODE_REVISION_EXHAUSTED');
 perform pg_temp.mode_assert(pg_temp.mode_snapshot(t)=before_state,'history exhaustion before mutation and no marker reached');
 result:=public.mode_update_flow_policy(a,t,f,i,3,true,'["https://a.test"]','history_noop_001');perform pg_temp.mode_assert(result->'changed'='false','exhausted history no-op still records receipt without update');
 drop trigger zz_mode_before_mutation_marker on public.mode_flow_installations;
 alter table public.mode_flow_installation_history disable trigger mode_history_immutable;
 update public.mode_flow_installation_history set sequence=5 where installation_id=i and sequence=9007199254740991;
 alter table public.mode_flow_installation_history enable trigger mode_history_immutable;
 raise notice 'PASS S1 history exhaustion preempts later BEFORE mutation marker; no-op is retained';

 before_state:=pg_temp.mode_snapshot(t);
 foreach tab in array array['lumin.installation_profiles','public.mode_flow_installations','public.mode_flow_installation_history','public.mode_flow_owner_operations'] loop
  execute 'select to_jsonb(x) from '||tab||' x'||case when tab='public.mode_flow_owner_operations' then ' where idempotency_key=''policy_key_00002''' when tab='public.mode_flow_installation_history' then ' order by sequence desc' else '' end||' limit 1' into payload;
  -- Trusted transaction-only probe isolates NOT NULL from unrelated before triggers.
  perform pg_temp.mode_assert(not exists(select 1 from pg_trigger where tgrelid=tab::regclass and not tgisinternal and tgenabled<>'O'),'trigger fixture initially enabled');
  execute 'alter table '||tab||' disable trigger user';
  for col in select attname from pg_attribute where attrelid=tab::regclass and attnum>0 and not attisdropped loop
   execute format('insert into %s select (jsonb_populate_record(null::%s,%L::jsonb)).* on conflict do nothing',tab,tab,payload::text); -- Unchanged valid clone control under identical trigger isolation.
   forged:=jsonb_set(payload,array[col.attname],'null');
   perform pg_temp.mode_null_reject(format('insert into %s select (jsonb_populate_record(null::%s,%L::jsonb)).* on conflict do nothing',tab,tab,forged::text),tab,col.attname);
  end loop;
  execute 'alter table '||tab||' enable trigger user';
  perform pg_temp.mode_assert(not exists(select 1 from pg_trigger where tgrelid=tab::regclass and not tgisinternal and tgenabled<>'O'),'trigger fixture restored');
 end loop;
 perform pg_temp.mode_assert(pg_temp.mode_snapshot(t)=before_state,'all per-column NULL attacks unchanged state');
 for rowop in select * from public.mode_flow_owner_operations where tenant_id=t loop
  for origin in select jsonb_object_keys(rowop.canonical_payload) loop
   forged:=jsonb_set(rowop.canonical_payload,array[origin],case when origin='allowedParentOrigins' then '{}'::jsonb else '[]'::jsonb end);perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,forged,rowop.receipt),false),'wrong payload primitive '||origin);
  end loop;
  for origin in select jsonb_object_keys(rowop.receipt) loop
   -- Empty arrays are valid only for hosted parents; every other field rejects them.
   if origin<>'allowedParentOrigins' then forged:=jsonb_set(rowop.receipt,array[origin],'[]');perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid(rowop.operation,rowop.actor_id,rowop.flow_id,rowop.canonical_payload,forged),false),'wrong receipt primitive '||origin);end if;
  end loop;
 end loop;
 perform pg_temp.mode_assert(not lumin.mode_revision('1.5') and not lumin.mode_revision('0') and not lumin.mode_revision('9007199254740992') and not lumin.mode_revision('"1"'),'fraction and range primitive rejection');
 select * into rowop from public.mode_flow_owner_operations where tenant_id=t and idempotency_key='policy_key_00002';
 forged:=jsonb_set(rowop.receipt,'{changed}','false');perform pg_temp.mode_assert(not coalesce(lumin.mode_operation_valid('policy',a,f,rowop.canonical_payload,forged),false),'false no-op revision binding');
 forged:=jsonb_set(rowop.receipt,'{currentVersionId}',to_jsonb(gen_random_uuid()::text));perform pg_temp.mode_reject(format('insert into public.mode_flow_owner_operations values(%L,%L,%L,''policy'',''forged_version01'',%L,%L,%L,clock_timestamp())',t,a,f,rowop.canonical_payload::text,rowop.payload_sha256,forged::text),'23514');
 payload:=jsonb_set(rowop.canonical_payload,'{installationId}',to_jsonb(i2::text));forged:=jsonb_set(rowop.receipt,'{installationId}',to_jsonb(i2::text));perform pg_temp.mode_reject(format('insert into public.mode_flow_owner_operations values(%L,%L,%L,''policy'',''forged_install01'',%L,%L,%L,clock_timestamp())',t,a,f,payload::text,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),forged::text),'23514');
 raise notice 'PASS S1 every-column NULL, malformed primitives and forged cross-row/no-op receipts';
 perform pg_temp.mode_reject(format('insert into public.mode_flow_installations(tenant_id,flow_id,mode,profile_version,current_version_id,allowed_parent_origins) values(%L,%L,''hosted'',''unit-v1'',%L,''[]'')',t2,f,v),'23503');
 select id into bulk_id from public.flow_versions where tenant_id=t and flow_id=f2;
 perform pg_temp.mode_reject(format('select public.mode_apply_flow_version(%L,%L,%L,%L,3,%L,%L,''foreign_flow_001'')',a,t,f,i,v,bulk_id),'P0002');

 -- Real maximal count pages are much larger than public policy's16KiB limit.
 select lumin.mode_parents(jsonb_agg('https://h'||lpad(g::text,2,'0')||'.'||repeat('a',63)||'.'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',50)||'.test')) into rich from generate_series(1,20) g;
 for j in 1..101 loop result:=public.mode_install_flow(a,t,f,v2,v2,'iframe','unit-v1',rich,'bulk_install_'||lpad(j::text,5,'0'));bulk_id:=(result->>'installationId')::uuid;end loop;
 page:=public.mode_owner_installations(a,t,f,null,100);perform pg_temp.mode_assert(jsonb_array_length(page->'installations')=100 and page->>'nextCursor' is not null and octet_length(convert_to(page::text,'UTF8'))>16384 and octet_length(convert_to(page::text,'UTF8'))<=1048576,'100 complete rich installations');
 result:=public.mode_owner_installations(a,t,f,(page->>'nextCursor')::uuid,100);perform pg_temp.mode_assert(jsonb_array_length(result->'installations')=3 and result->'nextCursor'='null','remaining three page entries');
 for j in 1..100 loop perform public.mode_update_flow_policy(a,t,f,bulk_id,j,j%2=0,rich,'bulk_policy_'||lpad(j::text,5,'0'));end loop;
 page:=public.mode_owner_installation_history(a,t,f,bulk_id,null,100);perform pg_temp.mode_assert(jsonb_array_length(page->'history')=100 and page->'nextCursor'='2' and octet_length(convert_to(page::text,'UTF8'))>16384 and octet_length(convert_to(page::text,'UTF8'))<=1048576,'100 complete rich history entries');
 perform pg_temp.mode_reject($q$select lumin.mode_owner_page(jsonb_build_object('history',repeat('x',1048576),'nextCursor',null))$q$,'54000','MODE_RESPONSE_TOO_LARGE');perform pg_temp.mode_reject('select lumin.mode_owner_page(null)','54000','MODE_RESPONSE_TOO_LARGE');perform pg_temp.mode_reject('select lumin.mode_owner_page(''[]'')','54000','MODE_RESPONSE_TOO_LARGE');
 raise notice 'PASS S1 real max-count rich pages and synthetic whole-result byte overflow faults';

 update public.services set active=false where id=s;
 perform pg_temp.mode_reject(format('select public.mode_public_installation_policy(%L)',i),'P0002');
 perform public.mode_update_flow_policy(a,t,f,i,3,false,'["https://a.test"]','disable_inactive01');
 perform pg_temp.mode_reject(format('select public.mode_update_flow_policy(%L,%L,%L,%L,4,true,''["https://a.test"]'',''enable_inactive01'')',a,t,f,i),'P0002');update public.services set active=true where id=s;
 update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=t and user_id=a;
 perform pg_temp.mode_reject(format('select public.mode_owner_operation(%L,%L,%L,''publish'',''publish_key_00001'')',a,t,f),'42501');
 update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=t and user_id=a;
 update public.flows set status='archived' where tenant_id=t and id=f;
 perform pg_temp.mode_reject(format('select public.mode_owner_operation(%L,%L,%L,''publish'',''publish_key_00001'')',a,t,f),'P0002');perform pg_temp.mode_reject(format('select public.mode_publish_flow(%L,%L,%L,1,''publish_key_00001'')',a,t,f),'P0002');
 perform pg_temp.mode_assert(baseline=jsonb_build_object('legacyInstall',(select count(*) from public.flow_installations),'sessions',(select count(*) from public.flow_sessions),'requests',(select count(*) from public.flow_requests),'bookings',(select count(*) from public.bookings)),'no legacy installation/session/request/booking effects');
 raise notice 'PASS S1 current service/owner/archive authority and no legacy side effects';
end $test$;
rollback;
select 'PASS mode_installations_tests: all synthetic changes rolled back' as result;
