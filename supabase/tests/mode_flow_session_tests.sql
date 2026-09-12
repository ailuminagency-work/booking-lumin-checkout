-- Trusted synthetic SQL fixtures. Every row/helper/fault is transactionally rolled back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='5s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='1s';
create function pg_temp.ms_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
create function pg_temp.ms_reject(q text,code text,label text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code and sqlerrm=label then return;end if;raise;end;raise exception 'FAIL accepted: %',q;end $$;
create function pg_temp.ms_state(t uuid) returns jsonb language sql as $$select jsonb_build_object(
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.mode_flow_sessions x where tenant_id=t),
 'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by session_id),'[]') from public.mode_flow_requests x where tenant_id=t),
 'customers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.customers x where tenant_id=t),
 'bookings',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.bookings x where tenant_id=t),
 'history',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.booking_state_history x where booking_id in(select id from public.bookings where tenant_id=t)),
 'outbox',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.durable_outbox x where tenant_id=t)) $$;
create function pg_temp.ms_fault() returns trigger language plpgsql as $$begin raise exception 'TEST_LATE_OUTBOX' using errcode='P0001';end $$;
create function pg_temp.ms_late_mutation() returns trigger language plpgsql as $$begin update public.bookings set pricing='{"unexpected":1}' where id=new.booking_id;return new;end $$;
create function pg_temp.ms_customer_mutation() returns trigger language plpgsql as $$begin new.name:='Unexpected replacement';return new;end $$;
do $test$
declare a uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();t uuid:=gen_random_uuid();f uuid:=gen_random_uuid();s uuid:=gen_random_uuid();f2 uuid:=gen_random_uuid();f3 uuid:=gen_random_uuid();s3 uuid:=gen_random_uuid();v3 uuid;i3 uuid;astral jsonb;v uuid;v2 uuid;i uuid;i2 uuid;
 cfg jsonb:='{"key":"unit","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}';
 r jsonb;issued jsonb;issued2 jsonb;accepted jsonb;before_state jsonb;start_at timestamptz:=clock_timestamp()+interval '2 days';raw public.mode_flow_sessions;request_row public.mode_flow_requests;
 role_name text;tab text;priv text;col record;forged jsonb;actual text;actual_table text;sig text;signatures text[];
begin
 perform pg_temp.ms_assert((select count(*)=0 from lumin.installation_profiles),'no profile activated by migration');
 signatures:=array[
 'public.mode_publish_flow(uuid,uuid,uuid,bigint,text)',
 'public.mode_install_flow(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text)',
 'public.mode_apply_flow_version(uuid,uuid,uuid,uuid,bigint,uuid,uuid,text)',
 'public.mode_update_flow_policy(uuid,uuid,uuid,uuid,bigint,boolean,jsonb,text)',
 'public.mode_public_installation_policy(uuid)',
 'public.mode_owner_installations(uuid,uuid,uuid,uuid,integer)',
 'public.mode_owner_installation_history(uuid,uuid,uuid,uuid,bigint,integer)',
 'public.mode_owner_operation(uuid,uuid,uuid,text,text)',
 'public.mode_issue_flow_session(uuid,text,text,text,text,uuid,bigint,bigint)',
 'public.mode_submit_flow_request(text,text,text,text,jsonb,jsonb,timestamp with time zone)',
 'public.mode_owner_request_history(uuid,uuid,uuid,timestamp with time zone,uuid,integer)'];
 perform pg_temp.ms_assert((select count(*)=11 and bool_and(p.oid=any(array(select x::regprocedure::oid from unnest(signatures)x))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'mode\_%' escape '\'),'exact combined eleven signatures without unexpected overloads');
 foreach sig in array signatures[9:11] loop
  perform pg_temp.ms_assert((select prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid=sig::regprocedure),'new RPC security '||sig);
  perform pg_temp.ms_assert(has_function_privilege('service_role',sig,'EXECUTE') and not has_function_privilege('anon',sig,'EXECUTE') and not has_function_privilege('authenticated',sig,'EXECUTE'),'new RPC grants '||sig);
 end loop;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  foreach tab in array array['public.mode_flow_sessions','public.mode_flow_requests'] loop
   foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop perform pg_temp.ms_assert(not has_table_privilege(role_name,tab,priv),'raw deny '||role_name||tab||priv);end loop;
   perform pg_temp.ms_assert((select relrowsecurity and relforcerowsecurity from pg_class where oid=tab::regclass),'forced RLS');
  end loop;
  for col in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lumin' and p.proname like 'mode_session\_%' escape '\' loop perform pg_temp.ms_assert(not has_function_privilege(role_name,col.oid,'EXECUTE'),'private helper denied');end loop;
  execute format('set local role %I',role_name);
  foreach tab in array array['public.mode_flow_sessions','public.mode_flow_requests'] loop
   begin execute 'select * from '||tab;raise exception 'FAIL raw select';exception when insufficient_privilege then null;end;
   begin execute 'insert into '||tab||' default values';raise exception 'FAIL raw insert';exception when insufficient_privilege then null;end;
   begin execute 'update '||tab||' set tenant_id=tenant_id';raise exception 'FAIL raw update';exception when insufficient_privilege then null;end;
   begin execute 'delete from '||tab;raise exception 'FAIL raw delete';exception when insufficient_privilege then null;end;
  end loop;
  execute 'set local role none';
 end loop;
 raise notice 'PASS S2 exact RPC inventory, raw roles, helper revocations and forced RLS';
 insert into lumin.installation_profiles values('session-unit','https://renderer.test','https://api.test','https://portal.test',repeat('a',64));
 insert into auth.users(id,email) values(a,a||'@test.invalid'),(staff,staff||'@test.invalid');
 insert into public.tenants(id,name,slug,timezone,currency) values(t,'Session unit',t::text,'UTC','USD');
 insert into public.tenant_members(tenant_id,user_id,role) values(t,a,'BUSINESS_OWNER'),(t,staff,'BUSINESS_STAFF');
 insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values(s,t,'simple','Unit','USD',0,60);
 insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty) values(t,s,'count','How many?','quantity',true,0,1,5);
 execute 'set local role service_role';
 perform public.save_bound_flow_draft(a,t,f,s,0,'Unit V1',cfg);
 r:=public.mode_publish_flow(a,t,f,1,'publish_session_01');v:=(r->>'versionId')::uuid;
 r:=public.mode_install_flow(a,t,f,v,v,'iframe','session-unit','["https://merchant.test"]','install_session_01');i:=(r->>'installationId')::uuid;
 issued:=public.mode_issue_flow_session(i,repeat('a',64),'https://renderer.test','https://merchant.test','session-unit',v,1,1);
 perform pg_temp.ms_assert(issued=public.mode_issue_flow_session(i,repeat('a',64),'https://renderer.test','https://merchant.test','session-unit',v,1,1),'same hash identical receipt');
 perform pg_temp.ms_assert(issued->'render'->'service'->'questions'->0->'required'='true','required V1 issue succeeds');
 perform pg_temp.ms_reject(format('select public.mode_issue_flow_session(%L,%L,%L,%L,%L,%L,1,1)',i,repeat('b',64),'https://api.test','https://merchant.test','session-unit',v),'42501','MODE_SESSION_FORBIDDEN');
 perform pg_temp.ms_reject(format('select public.mode_owner_request_history(%L,%L,null,null,null,10)',staff,t),'42501','FORBIDDEN');
 perform public.save_configurable_flow_draft(a,t,f2,s,0,'Unit V2',jsonb_build_object('authoringVersion',2,'config',cfg,'questionOverrides','{}'::jsonb));
 r:=public.mode_publish_flow(a,t,f2,1,'publish_session_v2');v2:=(r->>'versionId')::uuid;
 r:=public.mode_install_flow(a,t,f2,v2,v2,'hosted','session-unit','[]','install_session_v2');i2:=(r->>'installationId')::uuid;
 issued2:=public.mode_issue_flow_session(i2,repeat('b',64),'https://renderer.test',null,'session-unit',v2,1,1);
 perform pg_temp.ms_assert(issued2->'render'->'renderSchemaVersion'='2' and issued2->'render'->'service'->'questions'->0->'required'='true','required V2 issue succeeds without fabricated answers');
 perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,null,%L,%L,%L,%L)',repeat('b',64),'https://renderer.test','request_session_v2','{}','{"name":"Unit","email":"unit@test.invalid"}',start_at),'22023','MODE_REQUEST_INVALID_ANSWERS');
 r:=public.mode_submit_flow_request(repeat('b',64),'https://renderer.test',null,'request_session_v2','{"count":{"quantity":1}}','{"name":"Unit","email":"unit@test.invalid"}',start_at);
 perform pg_temp.ms_assert(r->>'state'='draft' and r->'replayed'='false','V2 first request draft');
 execute 'set local role none';

 -- Actual accepted V1 publisher supports PG character counts rather than UTF16 units.
 insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values(s3,t,'simple',repeat(chr(128512),200),'USD',0,60);
 insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,choices) values(t,s3,repeat(chr(128512),100),repeat(chr(128512),500),'multi_choice',true,jsonb_build_array(jsonb_build_object('id','constructor','label',repeat(chr(128512),200)),jsonb_build_object('id',repeat(chr(128512),100),'label','Second choice')));
 execute 'set local role service_role';
 perform public.save_bound_flow_draft(a,t,f3,s3,0,'Astral V1',jsonb_build_object('key','astral','steps',jsonb_build_array(jsonb_build_object('key','legacy','questionKey',repeat(chr(128512),100),'kind','question','required',true))));
 astral:=public.mode_publish_flow(a,t,f3,1,'publish_astral_01');v3:=(astral->>'versionId')::uuid;
 astral:=public.mode_install_flow(a,t,f3,v3,v3,'hosted','session-unit','[]','install_astral_01');i3:=(astral->>'installationId')::uuid;
 astral:=public.mode_issue_flow_session(i3,repeat('f',64),'https://renderer.test',null,'session-unit',v3,1,1);
 perform pg_temp.ms_assert(length(astral->'render'->'service'->>'name')=200 and octet_length(astral->'render'->'service'->>'name')=800,'V1 original astral character semantics');
 r:=public.mode_submit_flow_request(repeat('f',64),'https://renderer.test',null,'request_astral_01',jsonb_build_object(repeat(chr(128512),100),jsonb_build_object('choiceIds',jsonb_build_array('constructor',repeat(chr(128512),100)))),'{"name":"Astral","email":"astral@test.invalid"}',start_at);
 perform pg_temp.ms_assert(r->>'state'='draft','legacy reserved choice ID accepted through actual V1 publication');
 execute 'set local role none';
 perform lumin.mode_session_v1_catalog(astral->'render'->'service');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',(astral->'render'->'service')||jsonb_build_object('name',repeat(chr(128512),201))),'55000','MODE_REQUEST_CORRUPT');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',(astral->'render'->'service')||'{"extra":1}'::jsonb),'55000','MODE_REQUEST_CORRUPT');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',jsonb_set(astral->'render'->'service','{questions,0,id}','"constructor"')),'55000','MODE_REQUEST_CORRUPT');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',jsonb_set(astral->'render'->'service','{questions,0,prompt}',to_jsonb(repeat(chr(128512),501)))),'55000','MODE_REQUEST_CORRUPT');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',jsonb_set(astral->'render'->'service','{questions,0,id}',to_jsonb(repeat(chr(128512),101)))),'55000','MODE_REQUEST_CORRUPT');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',jsonb_set(astral->'render'->'service','{questions,0,choices,1,id}',to_jsonb(repeat(chr(128512),101)))),'55000','MODE_REQUEST_CORRUPT');
 perform pg_temp.ms_reject(format('select lumin.mode_session_v1_catalog(%L)',jsonb_set(astral->'render'->'service','{questions,0,choices,0,label}',to_jsonb(repeat(chr(128512),201)))),'55000','MODE_REQUEST_CORRUPT');
 raise notice 'PASS S2 accepted V1 astral text/reserved choice compatibility and malformed catalog controls';
 raise notice 'PASS S2 V1/required V2 render, hosted/iframe issue and owner scope';
 insert into public.customers(tenant_id,name,email) values(t,'Existing name','known@test.invalid');
 before_state:=pg_temp.ms_state(t);
 execute 'set local role service_role';
 accepted:=public.mode_submit_flow_request(repeat('a',64),'https://renderer.test','https://merchant.test','request_session_01','{"count":{"quantity":1.0}}','{"name":" Submitted name ","email":" known@test.invalid "}',start_at);
 r:=public.mode_submit_flow_request(repeat('a',64),'https://renderer.test','https://merchant.test','request_session_01','{"count":{"quantity":1}}','{"name":"Submitted name","email":"known@test.invalid"}',start_at);
 perform pg_temp.ms_assert(r->'replayed'='true' and r-'replayed'=accepted-'replayed','normalized replay preserves receipt');
 perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,%L,%L,%L,%L,%L)',repeat('a',64),'https://renderer.test','https://merchant.test','request_session_01','{"count":{"quantity":2}}','{"name":"Submitted name","email":"known@test.invalid"}',start_at),'40001','MODE_REQUEST_CONFLICT');
 execute 'set local role none';
 perform pg_temp.ms_assert((select name='Existing name' from public.customers where tenant_id=t and email='known@test.invalid'),'existing customer name untouched');
 select * into raw from public.mode_flow_sessions where token_hash=repeat('a',64);
 select * into request_row from public.mode_flow_requests where session_id=raw.id;
 perform pg_temp.ms_assert(request_row.canonical_payload->'customer'->>'name'='Submitted name' and request_row.canonical_payload->'answers'->'count'->>'quantity'='1','canonical intent and numeric scale');
 perform pg_temp.ms_assert((select count(*)=1 from public.booking_state_history where booking_id=request_row.booking_id and from_state is null and to_state='draft'),'initial state audit exists');
 perform pg_temp.ms_assert((select count(*)=1 from public.durable_outbox where tenant_id=t and booking_id=request_row.booking_id and event_type='booking.requested'),'exact outbox once');
 perform pg_temp.ms_assert(lumin.mode_session_customer('{"name":"A","email":"x@y.z"}')->>'email'='x@y.z','actual email predicate positive');
 perform pg_temp.ms_reject($q$select lumin.mode_session_customer('{"name":"A","email":"x@yz"}')$q$,'22023','MODE_REQUEST_INVALID_CUSTOMER');
 perform pg_temp.ms_reject($q$select lumin.mode_session_customer('{"name":"A","email":"x@y z"}')$q$,'22023','MODE_REQUEST_INVALID_CUSTOMER');
 perform pg_temp.ms_reject('select lumin.mode_session_customer(null)','22023','MODE_REQUEST_INVALID_CUSTOMER');
 perform pg_temp.ms_reject($q$select lumin.mode_session_customer('null')$q$,'22023','MODE_REQUEST_INVALID_CUSTOMER');
 perform pg_temp.ms_reject($q$select lumin.mode_session_customer('{"name":"A","email":"x@y.z","extra":1}')$q$,'22023','MODE_REQUEST_INVALID_CUSTOMER');
 perform pg_temp.ms_reject('select lumin.mode_session_limit(to_jsonb(repeat(''a'',16383)),16384)','54000','MODE_SESSION_LIMIT');
 perform pg_temp.ms_assert(octet_length(lumin.mode_session_limit(to_jsonb(repeat('a',16382)),16384)::text)=16384,'exact 16KiB scalar byte control');
 perform pg_temp.ms_reject('select lumin.mode_session_limit(to_jsonb(repeat(''a'',1048575)),1048576)','54000','MODE_SESSION_LIMIT');
 perform pg_temp.ms_assert(octet_length(lumin.mode_session_limit(to_jsonb(repeat('a',1048574)),1048576)::text)=1048576,'exact 1MiB scalar byte control');
 -- These byte controls exercise the cap helper, not claims of valid maximal render/owner DTOs.
 raise notice 'PASS S2 canonical replay, exact customer reuse and transactional after-state';
 perform pg_temp.ms_reject(format('update public.mode_flow_sessions set expires_at=expires_at where id=%L',raw.id),'55000','MODE_SESSION_IMMUTABLE');
 perform pg_temp.ms_reject(format('delete from public.mode_flow_requests where session_id=%L',raw.id),'55000','MODE_REQUEST_IMMUTABLE');
 -- Trusted fault injection; request/session state must survive exactly as before the failed call.
 execute 'set local role service_role';
 r:=public.mode_issue_flow_session(i,repeat('c',64),'https://renderer.test','https://merchant.test','session-unit',v,1,1);
 execute 'set local role none';before_state:=pg_temp.ms_state(t);
 execute 'create trigger zz_ms_fault before insert on public.durable_outbox for each row execute function pg_temp.ms_fault()';
 execute 'set local role service_role';
 perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,%L,%L,%L,%L,%L)',repeat('c',64),'https://renderer.test','https://merchant.test','request_session_03','{"count":{"quantity":1}}','{"name":"New","email":"new@test.invalid"}',start_at),'P0001','TEST_LATE_OUTBOX');
 execute 'set local role none';execute 'drop trigger zz_ms_fault on public.durable_outbox';
 perform pg_temp.ms_assert(pg_temp.ms_state(t)=before_state,'late outbox rollback keeps committed session and all prior state');
 execute 'create trigger zz_ms_mutation before insert on public.durable_outbox for each row execute function pg_temp.ms_late_mutation()';
 execute 'set local role service_role';
 perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,%L,%L,%L,%L,%L)',repeat('c',64),'https://renderer.test','https://merchant.test','request_session_03','{"count":{"quantity":1}}','{"name":"New","email":"new@test.invalid"}',start_at),'55000','MODE_REQUEST_CORRUPT');
 execute 'set local role none';execute 'drop trigger zz_ms_mutation on public.durable_outbox';
 perform pg_temp.ms_assert(pg_temp.ms_state(t)=before_state,'late pricing alteration full rollback');
 execute 'create trigger zz_ms_customer before insert on public.customers for each row execute function pg_temp.ms_customer_mutation()';
 execute 'set local role service_role';
 perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,%L,%L,%L,%L,%L)',repeat('c',64),'https://renderer.test','https://merchant.test','request_session_03','{"count":{"quantity":1}}','{"name":"New","email":"new@test.invalid"}',start_at),'55000','MODE_REQUEST_CORRUPT');
 execute 'set local role none';execute 'drop trigger zz_ms_customer on public.customers';
 perform pg_temp.ms_assert(pg_temp.ms_state(t)=before_state,'new customer altered name full rollback');
 execute 'set local role service_role';
 r:=public.mode_submit_flow_request(repeat('c',64),'https://renderer.test','https://merchant.test','request_session_03','{"count":{"quantity":1}}','{"name":"New","email":"new@test.invalid"}',start_at);
 perform pg_temp.ms_assert(r->'replayed'='false','clean retry after full rollback');
 r:=public.mode_owner_request_history(a,t,null,null,null,1);
 perform pg_temp.ms_assert(jsonb_array_length(r->'requests')=1 and r->'nextCursor' is not null and r->'nextCursor'<>'null','bounded owner cursor');
 accepted:=public.mode_owner_request_history(a,t,null,(r->'nextCursor'->>'createdAt')::timestamptz,(r->'nextCursor'->>'bookingId')::uuid,100);
 perform pg_temp.ms_assert(jsonb_array_length(accepted->'requests')=3,'owner cursor excludes first tuple');
 execute 'set local role none';

 -- Catalog-level NOT NULL proof: trusted fixture disables only user triggers so the
 -- exact declarative column constraint, not an earlier provenance guard, is tested.
 foreach tab in array array['mode_flow_sessions','mode_flow_requests'] loop
  execute format('alter table public.%I disable trigger user',tab);
  for col in select attname from pg_attribute where attrelid=('public.'||tab)::regclass and attnum>0 and not attisdropped and attnotnull loop
   forged:=case when tab='mode_flow_sessions' then to_jsonb(raw) else to_jsonb(request_row) end||jsonb_build_object(col.attname,null);
   begin
    execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).*',tab,tab) using forged;
    raise exception 'FAIL accepted NULL %',col.attname;
   exception when not_null_violation then
    get stacked diagnostics actual=COLUMN_NAME,actual_table=TABLE_NAME;
    perform pg_temp.ms_assert(actual=col.attname and actual_table=tab,'exact NOT NULL column '||tab||'.'||col.attname);
   end;
  end loop;
  execute format('alter table public.%I enable trigger user',tab);
 end loop;
 perform pg_temp.ms_assert((select array_agg(attname::text order by attname)=array['parent_origin'] from pg_attribute where attrelid='public.mode_flow_sessions'::regclass and attnum>0 and not attisdropped and not attnotnull),'exact session nullable set');
 perform pg_temp.ms_assert(not exists(select 1 from pg_attribute where attrelid='public.mode_flow_requests'::regclass and attnum>0 and not attisdropped and not attnotnull),'request nullable set empty');
 perform pg_temp.ms_reject(format('delete from public.mode_flow_sessions where id=%L',raw.id),'55000','MODE_SESSION_IMMUTABLE');
 perform pg_temp.ms_reject(format('update public.mode_flow_requests set idempotency_key=idempotency_key where session_id=%L',raw.id),'55000','MODE_REQUEST_IMMUTABLE');
 -- Every forged row is based on a known accepted neighboring row, with fresh primary token identity.
 foreach priv in array array['tenant_id','flow_id','installation_id','version_id','service_id'] loop
  forged:=to_jsonb(raw)||jsonb_build_object('id',gen_random_uuid(),'token_hash',repeat('d',64),priv,gen_random_uuid());
  begin
   execute 'insert into public.mode_flow_sessions select (jsonb_populate_record(null::public.mode_flow_sessions,$1)).*' using forged;
   raise exception 'FAIL forged session %',priv;
  exception when sqlstate '55000' then perform pg_temp.ms_assert(sqlerrm='MODE_REQUEST_CORRUPT','specific provenance guard');
  when foreign_key_violation then perform pg_temp.ms_assert(priv='service_id','only service substitution reaches exact composite FK');
  end;
 end loop;
 forged:=to_jsonb(raw)||jsonb_build_object('id',gen_random_uuid(),'token_hash',repeat('d',64),'issued_history_sequence',2);
 perform pg_temp.ms_reject(format('insert into public.mode_flow_sessions select (jsonb_populate_record(null::public.mode_flow_sessions,%L::jsonb)).*',forged),'55000','MODE_REQUEST_CORRUPT');
 execute 'insert into public.mode_flow_requests select (jsonb_populate_record(null::public.mode_flow_requests,$1)).* on conflict(session_id) do nothing' using to_jsonb(request_row);
 foreach priv in array array['tenantId','flowId','sessionId','installationId','versionId','serviceId','unexpected'] loop
  forged:=to_jsonb(request_row)||jsonb_build_object('canonical_payload',request_row.canonical_payload||jsonb_build_object(priv,gen_random_uuid()));
  forged:=forged||jsonb_build_object('request_hash',encode(sha256(convert_to((forged->'canonical_payload')::text,'UTF8')),'hex'));
  perform pg_temp.ms_reject(format('insert into public.mode_flow_requests select (jsonb_populate_record(null::public.mode_flow_requests,%L::jsonb)).*',forged),'55000','MODE_REQUEST_CORRUPT');
 end loop;
 forged:=to_jsonb(request_row)||jsonb_build_object('accepted_receipt',request_row.accepted_receipt||'{"requestAccepted":false}'::jsonb);
 perform pg_temp.ms_reject(format('insert into public.mode_flow_requests select (jsonb_populate_record(null::public.mode_flow_requests,%L::jsonb)).*',forged),'55000','MODE_REQUEST_CORRUPT');
 forged:=to_jsonb(request_row)||jsonb_build_object('request_hash',repeat('0',64));
 perform pg_temp.ms_reject(format('insert into public.mode_flow_requests select (jsonb_populate_record(null::public.mode_flow_requests,%L::jsonb)).*',forged),'55000','MODE_REQUEST_CORRUPT');
 -- Strict actual helper/input caps; strings within cap followed by over-cap controls.
 perform pg_temp.ms_assert(lumin.utf16_length(lumin.mode_session_customer(jsonb_build_object('name',repeat('A',200),'email','x@y.z'))->>'name')=200,'200 unit name positive');
 perform pg_temp.ms_reject(format('select lumin.mode_session_customer(%L)',jsonb_build_object('name',repeat('A',201),'email','x@y.z')),'22023','MODE_REQUEST_INVALID_CUSTOMER');
 perform pg_temp.ms_assert(lumin.utf16_length(lumin.mode_session_customer(jsonb_build_object('name','A','email',repeat('x',250)||'@y.z'))->>'email')=254,'254 unit email positive');
 perform pg_temp.ms_reject(format('select lumin.mode_session_customer(%L)',jsonb_build_object('name','A','email',repeat('x',251)||'@y.z')),'22023','MODE_REQUEST_INVALID_CUSTOMER');
 foreach actual in array array['2048','4096','32768','131072'] loop
  perform pg_temp.ms_assert(octet_length(lumin.mode_session_limit(to_jsonb(repeat('x',actual::int-2)),actual::int)::text)=actual::int,'cap positive '||actual);
  perform pg_temp.ms_reject(format('select lumin.mode_session_limit(to_jsonb(repeat(''x'',%s)),%s)',actual::int-1,actual),'54000','MODE_SESSION_LIMIT');
 end loop;
 foreach actual in array array['statement_timeout','lock_timeout','idle_in_transaction_session_timeout'] loop
  perform pg_temp.ms_reject(format('select set_config(%L,''0'',true);select lumin.mode_session_protocol()',actual),'55000','MODE_SESSION_PROTOCOL');
  perform pg_temp.ms_reject(format('select set_config(%L,%L,true);select lumin.mode_session_protocol()',actual,case when actual='idle_in_transaction_session_timeout' then '1001ms' else '5001ms' end),'55000','MODE_SESSION_PROTOCOL');
 end loop;
 perform lumin.mode_session_protocol();
 execute 'set local role service_role';
 foreach actual in array array[null,'',repeat('a',63),repeat('a',65),repeat('A',64),repeat('g',64)] loop
  perform pg_temp.ms_reject(format('select public.mode_issue_flow_session(%L,%L,%L,%L,%L,%L,1,1)',i,actual,'https://renderer.test','https://merchant.test','session-unit',v),'22023','MODE_SESSION_INVALID');
 end loop;
 foreach actual in array array[null,'',repeat('x',15),repeat('x',129),'spaces in key are invalid'] loop
  perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,%L,%L,%L,%L,%L)',repeat('a',64),'https://renderer.test','https://merchant.test',actual,'{"count":{"quantity":1}}','{"name":"Submitted name","email":"known@test.invalid"}',start_at),'22023','MODE_SESSION_INVALID');
 end loop;
 foreach actual in array array[null,'',repeat('x',65),'UPPER','bad_profile'] loop
  perform pg_temp.ms_reject(format('select public.mode_issue_flow_session(%L,%L,%L,%L,%L,%L,1,1)',i,repeat('e',64),'https://renderer.test','https://merchant.test',actual,v),'22023','MODE_SESSION_INVALID');
 end loop;
 perform pg_temp.ms_reject(format('select public.mode_owner_request_history(%L,%L,null,null,null,0)',a,t),'22023','MODE_SESSION_INVALID');
 perform pg_temp.ms_reject(format('select public.mode_owner_request_history(%L,%L,null,null,null,101)',a,t),'22023','MODE_SESSION_INVALID');
 perform pg_temp.ms_reject(format('select public.mode_owner_request_history(%L,%L,null,%L,null,10)',a,t,start_at),'22023','MODE_SESSION_INVALID');
 perform pg_temp.ms_reject(format('select public.mode_owner_request_history(%L,%L,null,null,%L,10)',a,t,gen_random_uuid()),'22023','MODE_SESSION_INVALID');
 execute 'set local role none';
 -- A legitimate terminal transition changes current state, never immutable acceptance.
 update public.bookings set state='failed' where id=request_row.booking_id;
 execute 'set local role service_role';
 r:=public.mode_submit_flow_request(repeat('a',64),'https://renderer.test','https://merchant.test','request_session_01','{"count":{"quantity":1}}','{"name":"Submitted name","email":"known@test.invalid"}',start_at);
 perform pg_temp.ms_assert(r->>'state'='failed' and r->>'initialState'='draft' and r->'replayed'='true','actual replay state separate immutable acceptance');
 execute 'set local role none';
 update public.flows set status='archived' where id=f;
 execute 'set local role service_role';r:=public.mode_owner_request_history(a,t,f,null,null,100);
 perform pg_temp.ms_assert(jsonb_array_length(r->'requests')=2,'archived flow owner history retained');
 perform pg_temp.ms_reject(format('select public.mode_submit_flow_request(%L,%L,%L,%L,%L,%L,%L)',repeat('a',64),'https://renderer.test','https://merchant.test','request_session_01','{"count":{"quantity":1}}','{"name":"Submitted name","email":"known@test.invalid"}',start_at),'42501','MODE_SESSION_FORBIDDEN');
 execute 'set local role none';
 raise notice 'PASS S2 every NOT NULL column, provenance attacks, protocol and input bounds, actual state and archive retention';
 raise notice 'PASS S2 late rollback, recovery, immutable evidence and owner pagination';
end $test$;
rollback;

-- Separate transaction proves the exact isolation guard before any fixture query.
begin isolation level repeatable read;
set local statement_timeout='5s';set local lock_timeout='5s';set local idle_in_transaction_session_timeout='1s';
do $$begin
 begin perform public.mode_issue_flow_session(null,null,null,null,null,null,null,null);raise exception 'FAIL isolation accepted';
 exception when sqlstate '55000' then if sqlerrm<>'MODE_SESSION_PROTOCOL' then raise;end if;end;
 raise notice 'PASS S2 non-READ-COMMITTED protocol denial';
end $$;
rollback;
