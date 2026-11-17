\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
select pg_temp.assert(not has_function_privilege('anon','public.owner_conditional_customer_field_install_health(uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.owner_conditional_customer_field_install_health(uuid,uuid,uuid)','EXECUTE'),'owner RPC private');
select pg_temp.assert(has_function_privilege('service_role','public.owner_conditional_customer_field_install_health(uuid,uuid,uuid)','EXECUTE'),'server RPC available');
select pg_temp.assert(not has_function_privilege('service_role','lumin.conditional_customer_field_health_request_valid(jsonb,jsonb,jsonb,timestamptz,text)','EXECUTE'),'private validator unavailable directly');
select pg_temp.assert(not has_table_privilege('service_role','public.flow_requests','SELECT') and not has_table_privilege('service_role','public.bound_flow_versions','SELECT'),'private table grants remain closed');
select pg_temp.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('public.flow_sessions'::regclass,'public.flow_requests'::regclass,'public.bound_flow_versions'::regclass)),'forced RLS preserved');
select pg_temp.assert(not lumin.conditional_customer_field_health_request_valid('[]','{}','{}',now(),'forged'),'invalid request cannot establish evidence');
select pg_temp.assert(lumin.conditional_customer_field_health_request_valid('[]','{}','{"name":"Fixture","email":"fixture@example.test"}',now(),lumin.customer_field_request_hash('{}','{"name":"Fixture","email":"fixture@example.test"}',now())),'exact pinned request hash');
select pg_temp.assert(not lumin.conditional_customer_field_health_request_valid('[]','{"custom_price":"1"}','{"name":"Fixture","email":"fixture@example.test"}',now(),'forged'),'unknown fields rejected');
select pg_temp.assert(not lumin.conditional_customer_field_health_request_valid('[]','{}','{"name":"Fixture","email":"bad"}',now(),'forged'),'malformed customer excluded');
select pg_temp.assert(not lumin.conditional_customer_field_health_request_valid('[{"id":"custom_note","kind":"text","label":"Note","required":true,"maxLength":2}]','{}','{"name":"Fixture","email":"fixture@example.test"}',now(),lumin.customer_field_request_hash('{}','{"name":"Fixture","email":"fixture@example.test"}',now())),'missing required field cannot count even with matching hash');
select pg_temp.assert(not lumin.conditional_customer_field_health_request_valid('[{"id":"custom_note","kind":"text","label":"Note","required":true,"maxLength":2}]','{"custom_note":"long"}','{"name":"Fixture","email":"fixture@example.test"}',now(),lumin.customer_field_request_hash('{"custom_note":"long"}','{"name":"Fixture","email":"fixture@example.test"}',now())),'pinned max length cannot count even with matching hash');
do $$
declare fields jsonb:='[{"id":"custom_access","kind":"text","label":"Access","required":true,"maxLength":10},{"id":"custom_code","kind":"text","label":"Code","required":true,"maxLength":4,"when":{"fieldId":"custom_access","equals":"gate"}}]';customer jsonb:='{"name":"Fixture","email":"fixture@example.test"}';start_at timestamptz:=now();answers jsonb;
begin
 answers:='{"custom_access":"door"}';
 if not lumin.conditional_customer_field_health_request_valid(fields,answers,customer,start_at,lumin.customer_field_request_hash(answers,customer,start_at)) then raise exception 'hidden required field incorrectly excludes historical evidence';end if;
 foreach answers in array array['{"custom_access":"door","custom_code":""}'::jsonb,'{"custom_access":"gate"}','{"custom_access":"gate","custom_code":"12345"}'] loop
  if lumin.conditional_customer_field_health_request_valid(fields,answers,customer,start_at,lumin.customer_field_request_hash(answers,customer,start_at)) then raise exception 'matching hash bypassed conditional answer authority';end if;
 end loop;
 if not exists(select 1 from pg_proc where oid='public.owner_conditional_customer_field_install_health(uuid,uuid,uuid)'::regprocedure and prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'fixed security definer missing';end if;
end $$;
rollback;
