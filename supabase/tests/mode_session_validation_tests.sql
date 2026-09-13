-- Synthetic fixtures and detector triggers are rolled back; run after all migrations.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='5s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='1s';
create function pg_temp.mv_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.mv_call(h text,r jsonb) returns jsonb language sql as $$
 select public.mode_validate_existing_flow_session(h,(r->>'sessionId')::uuid,
 (r->>'installationId')::uuid,r->>'rendererOrigin',r->>'parentOrigin',r->>'deploymentProfileVersion',
 (r->>'versionId')::uuid,(r->>'targetRevision')::bigint,(r->>'policyRevision')::bigint,
 (r->>'issuedAt')::timestamptz,(r->>'expiresAt')::timestamptz)
$$;
create function pg_temp.mv_deny(h text,r jsonb,expected text default '42501') returns void language plpgsql as $$
begin
 begin perform pg_temp.mv_call(h,r);
 exception when others then
  if sqlstate=expected and sqlerrm=(case when expected='42501' then 'MODE_SESSION_FORBIDDEN' else 'MODE_SESSION_INVALID' end) then return; end if;
  raise;
 end;
 raise exception 'FAIL: validation accepted a denied tuple';
end $$;
create function pg_temp.mv_no_write() returns trigger language plpgsql as $$
begin
 if current_setting('mode_validation_test.detect',true)='on' then
  raise exception 'VALIDATOR_ATTEMPTED_WRITE' using errcode='P0001';
 end if;
 return null;
end $$;
create function pg_temp.mv_state() returns jsonb language plpgsql as $$
declare tab text; r jsonb:='{}'; v jsonb;
begin
 foreach tab in array array['mode_flow_sessions','mode_flow_requests','mode_flow_installations',
 'mode_flow_installation_history','mode_flow_owner_operations','customers','bookings','booking_state_history','durable_outbox'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]''::jsonb) from public.%I x',tab) into v;
  r:=r||jsonb_build_object(tab,v);
 end loop;
 return r;
end $$;
do $test$
declare
 a uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
 f uuid:=gen_random_uuid(); f2 uuid:=gen_random_uuid(); v uuid; v2 uuid; i uuid;
 cfg jsonb:='{"key":"validation","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}';
 r jsonb; original jsonb; second jsonb; expired jsonb; before_state jsonb; changed jsonb; raw public.mode_flow_sessions;
 field text; tab text; sig text:='public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamp with time zone,timestamp with time zone)';
begin
 perform pg_temp.mv_assert((select prosecdef and provolatile='v' and proconfig=array['search_path=pg_catalog'] from pg_proc where oid=sig::regprocedure),'exact definer/search path/volatility');
 perform pg_temp.mv_assert((select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='mode_validate_existing_flow_session'),'no overload');
 perform pg_temp.mv_assert(has_function_privilege('service_role',sig,'EXECUTE') and not has_function_privilege('anon',sig,'EXECUTE') and not has_function_privilege('authenticated',sig,'EXECUTE'),'exact caller grants');
 perform pg_temp.mv_assert(not exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=sig::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'),'PUBLIC revoked');
 foreach tab in array array['mode_flow_sessions','mode_flow_requests'] loop
  perform pg_temp.mv_assert(not has_table_privilege('service_role','public.'||tab,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'raw tables remain private');
 end loop;
 insert into lumin.installation_profiles values('validation-unit','https://renderer.test','https://api.test','https://portal.test',repeat('a',64));
 insert into auth.users(id,email) values(a,a||'@test.invalid');
 insert into public.tenants(id,name,slug,timezone,currency) values(t,'Validation unit',t::text,'UTC','USD');
 insert into public.tenant_members(tenant_id,user_id,role) values(t,a,'BUSINESS_OWNER');
 insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values(s,t,'simple','Unit','USD',0,60);
 insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty) values(t,s,'count','How many?','quantity',true,0,1,5);
 execute 'set local role service_role';
 perform public.save_bound_flow_draft(a,t,f,s,0,'V1',cfg);
 r:=public.mode_publish_flow(a,t,f,1,'validation_publish_01'); v:=(r->>'versionId')::uuid;
 r:=public.mode_install_flow(a,t,f,v,v,'iframe','validation-unit','["https://merchant.test"]','validation_install_01'); i:=(r->>'installationId')::uuid;
 original:=public.mode_issue_flow_session(i,repeat('a',64),'https://renderer.test','https://merchant.test','validation-unit',v,1,1);
 perform public.save_configurable_flow_draft(a,t,f2,s,0,'V2',jsonb_build_object('authoringVersion',2,'config',cfg,'questionOverrides','{}'::jsonb));
 r:=public.mode_publish_flow(a,t,f2,1,'validation_publish_02'); v2:=(r->>'versionId')::uuid;
 r:=public.mode_install_flow(a,t,f2,v2,v2,'hosted','validation-unit','[]','validation_install_02');
 second:=public.mode_issue_flow_session((r->>'installationId')::uuid,repeat('b',64),'https://renderer.test',null,'validation-unit',v2,1,1);
 execute 'set local role none';
 -- Privileged fixture inserts an already expired immutable row through real constraints.
 select * into raw from public.mode_flow_sessions where id=(second->>'sessionId')::uuid;
 raw.id:=gen_random_uuid(); raw.token_hash:=repeat('d',64);
 raw.expires_at:=clock_timestamp()-interval '1 second'; raw.issued_at:=raw.expires_at-interval '15 minutes';
 insert into public.mode_flow_sessions select raw.*;
 expired:=second||jsonb_build_object('sessionId',raw.id,'issuedAt',lumin.mode_session_stamp(raw.issued_at),'expiresAt',lumin.mode_session_stamp(raw.expires_at));
 foreach tab in array array['mode_flow_sessions','mode_flow_requests','mode_flow_installations',
 'mode_flow_installation_history','mode_flow_owner_operations','customers','bookings','booking_state_history','durable_outbox'] loop
  execute format('create trigger validation_no_write before insert or update or delete or truncate on public.%I for each statement execute function pg_temp.mv_no_write()',tab);
 end loop;
 before_state:=pg_temp.mv_state();
 perform set_config('mode_validation_test.detect','on',true);
 -- Positive detector control: even a zero-row attempted write must be observed.
 begin
  update public.mode_flow_sessions set token_hash=token_hash where false;
  raise exception 'FAIL: write detector inactive';
 exception when sqlstate 'P0001' then
  if sqlerrm<>'VALIDATOR_ATTEMPTED_WRITE' then raise; end if;
 end;
 execute 'set local role service_role';
 perform pg_temp.mv_assert(pg_temp.mv_call(repeat('a',64),original)=original,'V1 exact original receipt');
 perform pg_temp.mv_assert(pg_temp.mv_call(repeat('b',64),second)=second,'V2 exact original receipt');
 perform pg_temp.mv_deny(repeat('c',64),original);
 perform pg_temp.mv_deny(repeat('d',64),expired);
 foreach field in array array['sessionId','installationId','versionId'] loop
  perform pg_temp.mv_deny(repeat('a',64),original||jsonb_build_object(field,gen_random_uuid()));
 end loop;
 perform pg_temp.mv_deny(repeat('a',64),original||'{"targetRevision":2}');
 perform pg_temp.mv_deny(repeat('a',64),original||'{"policyRevision":2}');
 perform pg_temp.mv_deny(repeat('a',64),original||'{"deploymentProfileVersion":"other"}');
 perform pg_temp.mv_deny(repeat('a',64),original||'{"rendererOrigin":"https://other.test"}');
 perform pg_temp.mv_deny(repeat('a',64),original||'{"parentOrigin":"https://other.test"}');
 changed:=original||jsonb_build_object('issuedAt',((original->>'issuedAt')::timestamptz+interval '1 microsecond'),'expiresAt',((original->>'expiresAt')::timestamptz+interval '1 microsecond'));
 perform pg_temp.mv_deny(repeat('a',64),changed);
 perform pg_temp.mv_deny(null,original,'22023');
 perform pg_temp.mv_deny(repeat('A',64),original,'22023');
 perform pg_temp.mv_deny(repeat('a',64),original||'{"issuedAt":"infinity"}','22023');
 execute 'set local role none';
 perform pg_temp.mv_assert(pg_temp.mv_state()=before_state,'validation leaves complete state unchanged');
 perform set_config('mode_validation_test.detect','off',true);
 raise notice 'PASS validator ACL, V1/V2 receipt, exact tuple and attempted-write controls';

 execute 'set local role service_role';
 perform public.save_bound_flow_draft(a,t,f,s,1,'V1 next',cfg);
 r:=public.mode_publish_flow(a,t,f,2,'validation_publish_03');
 perform public.mode_apply_flow_version(a,t,f,i,1,v,(r->>'versionId')::uuid,'validation_apply_01');
 perform pg_temp.mv_assert(pg_temp.mv_call(repeat('a',64),original)=original,'target advance preserves old pin');
 perform public.mode_update_flow_policy(a,t,f,i,1,false,'["https://merchant.test"]','validation_policy_01');
 perform pg_temp.mv_deny(repeat('a',64),original);
 perform public.mode_update_flow_policy(a,t,f,i,2,true,'["https://merchant.test"]','validation_policy_02');
 perform pg_temp.mv_deny(repeat('a',64),original);
 execute 'set local role none';
 update public.services set active=false where id=s;
 perform pg_temp.mv_deny(repeat('b',64),second);
 update public.services set active=true where id=s;
 perform pg_temp.mv_assert(pg_temp.mv_call(repeat('b',64),second)=second,'service active neighbor');
 update public.flows set status='archived' where id=f2;
 perform pg_temp.mv_deny(repeat('b',64),second);
 update public.flows set status='active' where id=f2;
 update public.tenants set status='inactive' where id=t;
 perform pg_temp.mv_deny(repeat('b',64),second);
 update public.tenants set status='active' where id=t;
 perform pg_temp.mv_assert(pg_temp.mv_call(repeat('b',64),second)=second,'all active authority neighbor');
 raise notice 'PASS validator old pin, current policy, expiry and source authority';
end $test$;
rollback;
