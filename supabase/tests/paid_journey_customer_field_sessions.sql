\set ON_ERROR_STOP on
begin;
do $$begin if current_user<>'postgres' or not((host(inet_server_addr())='127.0.0.1' and inet_server_port()=59069 and current_database() ~ '^lumin_journey_fields_session_local_[a-z0-9_]+$') or (inet_server_port()=5432 and current_database()='lumin_journey_fields_session_ci' and (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))) then raise exception 'DISPOSABLE_V9_SESSION_TARGET_REQUIRED';end if;end$$;
create function pg_temp.must_fail(q text,code text) returns void language plpgsql as $$begin execute q;raise exception 'TEST_EXPECTED_FAILURE';exception when others then if sqlstate<>code then raise exception 'Expected %, got %: %',code,sqlstate,sqlerrm;end if;end$$;
insert into auth.users(id,email) values('82000000-0000-4000-8000-000000000001','session-owner@example.test'),('82000000-0000-4000-8000-000000000009','session-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('82000000-0000-4000-8000-000000000002','Fields','session-draft-test','UTC','USD'),('82000000-0000-4000-8000-000000000008','Foreign','session-draft-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','BUSINESS_OWNER'),('82000000-0000-4000-8000-000000000008','82000000-0000-4000-8000-000000000009','BUSINESS_OWNER');
select public.initialize_staging_business_profile('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','HOUSEKEEPING','field_sql_owner_fixture');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('82000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
create temp table fixture(form jsonb);
insert into fixture values('{
"name":"Cleaning","presentation":{"accentColor":"#0e7490","layout":"compact"},"journey":{"schemaVersion":1,"stages":[{"id":"service","kind":"service","label":"Service","enabled":true},{"id":"options","kind":"options","label":"Options","enabled":false},{"id":"schedule","kind":"schedule","label":"Schedule","enabled":true},{"id":"information","kind":"information","label":"Information","enabled":true},{"id":"informational_access","kind":"informational","label":"Access","enabled":true},{"id":"review_payment","kind":"review_payment","label":"Review","enabled":true},{"id":"confirmation","kind":"confirmation","label":"Confirmation","enabled":true}]},"customerFields":[{"id":"custom_gate","kind":"text","label":"Gate","required":false,"maxLength":100},{"id":"custom_code","kind":"text","label":"Code","required":false,"maxLength":100,"when":{"fieldId":"custom_gate","equals":"yes"}}],"fieldBindings":[{"fieldId":"custom_gate","stageId":"information"},{"fieldId":"custom_code","stageId":"informational_access"}]}');
do $$declare form jsonb;r jsonb;role text;begin
 select f.form into form from fixture f;
 perform public.save_paid_journey_customer_field_draft('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000003',0,form);
 perform public.publish_paid_journey_customer_field_draft('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000004',1,'82000000-0000-4000-8000-000000000005','82000000-0000-4000-8000-000000000006','["https://checkout.example.test"]','["https://checkout.example.test"]');
 r:=public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006',repeat('a',64),'https://checkout.example.test');
 assert r->'schemaVersion'='2' and r->>'installationId'='82000000-0000-4000-8000-000000000006' and r#>'{render,renderSchemaVersion}'='9';
 assert not(r ?| array['token_hash','tokenHash','token','tenantId','flowId','origin','generation','customer']);
 assert (r->>'expiresAt')::timestamptz>clock_timestamp() and (r->>'expiresAt')::timestamptz<=clock_timestamp()+interval '15 minutes';
 assert public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006',repeat('a',64),'https://checkout.example.test')=r;
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_journey_customer_field_sessions'::regclass);
 foreach role in array array['anon','authenticated','service_role'] loop
  assert not has_table_privilege(role,'public.paid_journey_customer_field_sessions','SELECT');assert not has_table_privilege(role,'public.paid_journey_customer_field_sessions','INSERT');assert not has_table_privilege(role,'public.paid_journey_customer_field_sessions','UPDATE');assert not has_table_privilege(role,'public.paid_journey_customer_field_sessions','DELETE');
  assert not has_function_privilege(role,'lumin.paid_journey_customer_field_session_context(uuid,text)','EXECUTE');assert not has_function_privilege(role,'lumin.guard_paid_journey_customer_field_session()','EXECUTE');
  if role<>'service_role' then assert not has_function_privilege(role,'public.issue_paid_journey_customer_field_session(uuid,text,text)','EXECUTE');end if;
 end loop;
end$$;
select pg_temp.must_fail($q$select public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006','plaintext','https://checkout.example.test')$q$,'22023');
select pg_temp.must_fail($q$select public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006',repeat('b',64),'https://checkout.example.test/')$q$,'22023');
select pg_temp.must_fail($q$select public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006',repeat('b',64),'https://foreign.example.test')$q$,'P0002');
select pg_temp.must_fail($q$update public.paid_journey_customer_field_sessions set origin='https://evil.example.test' where token_hash=repeat('a',64)$q$,'55000');
select pg_temp.must_fail($q$delete from public.paid_journey_customer_field_sessions where token_hash=repeat('a',64)$q$,'55000');
-- A controlled, already-expired row is inserted through the intact provenance guard.
insert into public.paid_journey_customer_field_sessions select repeat('e',64),tenant_id,flow_id,version_id,installation_id,service_id,publication_generation,origin,issued_at-interval '16 minutes',expires_at-interval '16 minutes' from public.paid_journey_customer_field_sessions where token_hash=repeat('a',64);
select pg_temp.must_fail($q$select public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006',repeat('e',64),'https://checkout.example.test')$q$,'42501');
select pg_temp.must_fail($q$insert into public.paid_journey_customer_field_sessions select repeat('f',64),tenant_id,flow_id,version_id,installation_id,service_id,publication_generation+1,origin,issued_at,expires_at from public.paid_journey_customer_field_sessions where token_hash=repeat('a',64)$q$,'55000');
select pg_temp.must_fail($q$insert into public.paid_journey_customer_field_sessions select repeat('d',64),'82000000-0000-4000-8000-000000000008'::uuid,flow_id,version_id,installation_id,service_id,publication_generation,origin,issued_at,expires_at from public.paid_journey_customer_field_sessions where token_hash=repeat('a',64)$q$,'55000');
update public.services set base_price=13000 where id='82000000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.issue_paid_journey_customer_field_session('82000000-0000-4000-8000-000000000006',repeat('b',64),'https://checkout.example.test')$q$,'40001');
update public.services set base_price=12500 where id='82000000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.must_fail($q$select * from public.paid_journey_customer_field_sessions$q$,'42501');
reset role;
rollback;
