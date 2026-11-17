\set ON_ERROR_STOP on
begin;
do $$begin if current_user<>'postgres' or not((host(inet_server_addr())='127.0.0.1' and inet_server_port()=59069 and current_database() ~ '^lumin_journey_fields_hold_local_[a-z0-9_]+$') or (inet_server_port()=5432 and current_database()='lumin_journey_fields_hold_ci' and (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))) then raise exception 'DISPOSABLE_V9_SESSION_TARGET_REQUIRED';end if;end$$;
create function pg_temp.must_fail(q text,code text) returns void language plpgsql as $$begin execute q;raise exception 'TEST_EXPECTED_FAILURE';exception when others then if sqlstate<>code then raise exception 'Expected %, got %: %',code,sqlstate,sqlerrm;end if;end$$;
insert into auth.users(id,email) values('85500000-0000-4000-8000-000000000001','session-owner@example.test'),('85500000-0000-4000-8000-000000000009','session-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('85500000-0000-4000-8000-000000000002','Fields','session-draft-test','UTC','USD'),('85500000-0000-4000-8000-000000000008','Foreign','session-draft-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('85500000-0000-4000-8000-000000000002','85500000-0000-4000-8000-000000000001','BUSINESS_OWNER'),('85500000-0000-4000-8000-000000000008','85500000-0000-4000-8000-000000000009','BUSINESS_OWNER');
select public.initialize_staging_business_profile('85500000-0000-4000-8000-000000000001','85500000-0000-4000-8000-000000000002','HOUSEKEEPING','field_sql_owner_fixture');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('85500000-0000-4000-8000-000000000003','85500000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
create temp table fixture(form jsonb);
insert into fixture values('{
"name":"Cleaning","presentation":{"accentColor":"#0e7490","layout":"compact"},"journey":{"schemaVersion":1,"stages":[{"id":"service","kind":"service","label":"Service","enabled":true},{"id":"options","kind":"options","label":"Options","enabled":false},{"id":"schedule","kind":"schedule","label":"Schedule","enabled":true},{"id":"information","kind":"information","label":"Information","enabled":true},{"id":"informational_access","kind":"informational","label":"Access","enabled":true},{"id":"review_payment","kind":"review_payment","label":"Review","enabled":true},{"id":"confirmation","kind":"confirmation","label":"Confirmation","enabled":true}]},"customerFields":[{"id":"custom_gate","kind":"text","label":"Gate","required":false,"maxLength":100},{"id":"custom_code","kind":"text","label":"Code","required":false,"maxLength":100,"when":{"fieldId":"custom_gate","equals":"yes"}}],"fieldBindings":[{"fieldId":"custom_gate","stageId":"information"},{"fieldId":"custom_code","stageId":"informational_access"}]}');
do $$declare form jsonb;r jsonb;begin
 select f.form into form from fixture f;
 perform public.save_paid_journey_customer_field_draft('85500000-0000-4000-8000-000000000001','85500000-0000-4000-8000-000000000002','85500000-0000-4000-8000-000000000004','85500000-0000-4000-8000-000000000003',0,form);
 perform public.publish_paid_journey_customer_field_draft('85500000-0000-4000-8000-000000000001','85500000-0000-4000-8000-000000000002','85500000-0000-4000-8000-000000000004',1,'85500000-0000-4000-8000-000000000005','85500000-0000-4000-8000-000000000006','["https://checkout.example.test"]','["https://checkout.example.test"]');
 perform public.issue_paid_journey_customer_field_session('85500000-0000-4000-8000-000000000006',repeat('3',64),'https://checkout.example.test');
 r:=public.resolve_paid_journey_customer_field_session(repeat('3',64),'https://checkout.example.test');
 assert r->'schemaVersion'='2' and r->>'tenantId'='85500000-0000-4000-8000-000000000002' and r->'publicationGeneration'='2' and r#>'{render,renderSchemaVersion}'='9';
 assert not(r ?| array['token','tokenHash','token_hash','customerAnswers','origin']);
 assert public.resolve_paid_journey_customer_field_session(repeat('3',64),'https://checkout.example.test')=r;
end$$;
create temp table submitted as select public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"exact"}','2030-01-01T09:00:00.000Z') result;
do $$declare r jsonb;again jsonb;begin
 select result into r from submitted;assert r->'replayed'='false' and r->>'serviceId'='85500000-0000-4000-8000-000000000003' and r->'publicationGeneration'='2' and r#>'{render,renderSchemaVersion}'='9';
 again:=public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"exact"}','2030-01-01T09:00:00.000Z');
 assert again->'replayed'='true' and (again-'replayed')=(r-'replayed');assert (select count(*) from public.paid_journey_customer_field_requests)=1;
 assert exists(select 1 from public.bookings where id=(r->>'bookingId')::uuid and state='draft' and payment_id is null and pricing='{}' and selection=jsonb_build_object('serviceId','85500000-0000-4000-8000-000000000003'::uuid) and idempotency_key='paid-journey:fields:'||repeat('3',64));
 perform pg_temp.must_fail(format('select public.assert_legacy_mock_payment_booking(%L,%L)',r->>'tenantId',r->>'bookingId'),'0A000');
 assert not exists(select 1 from public.payments) and not exists(select 1 from public.durable_outbox) and not exists(select 1 from public.capacity_holds);
end$$;
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://checkout.example.test','changed-key-0000001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"exact"}','2030-01-01T09:00:00Z')$q$,'40001');
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"changed"}','2030-01-01T09:00:00Z')$q$,'40001');
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://other.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"exact"}','2030-01-01T09:00:00Z')$q$,'42501');
select public.issue_paid_journey_customer_field_session('85500000-0000-4000-8000-000000000006',repeat('4',64),'https://checkout.example.test');
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('4',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"no","custom_code":"hidden"}','2030-01-01T09:00:00Z')$q$,'22023');
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('4',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_amount":"0"}','2030-01-01T09:00:00Z')$q$,'22023');
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('4',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":" Customer","email":"customer@example.test"}','{}','2030-01-01T09:00:00Z')$q$,'22023');
select pg_temp.must_fail($q$update public.paid_journey_customer_field_requests set idempotency_key='forged-key-0000001'$q$,'55000');
do $$declare role text;fn text;begin
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_journey_customer_field_requests'::regclass);
 foreach role in array array['anon','authenticated','service_role'] loop
  assert not has_table_privilege(role,'public.paid_journey_customer_field_requests','SELECT,INSERT,UPDATE,DELETE');
  foreach fn in array array['public.paid_journey_customer_field_hold_target(text,text)','public.submit_paid_journey_customer_field_hold_request(text,text,text,jsonb,jsonb,timestamptz)'] loop assert has_function_privilege(role,fn,'EXECUTE')=(role='service_role');end loop;
  assert not has_function_privilege(role,'lumin.paid_journey_customer_field_hold_context(text,text)','EXECUTE');
  assert not has_function_privilege(role,'lumin.paid_journey_customer_field_request_payload(jsonb,jsonb,jsonb,timestamptz)','EXECUTE');
 end loop;
end$$;
set local role anon;
select pg_temp.must_fail($q$select public.paid_journey_customer_field_hold_target(repeat('3',64),'https://checkout.example.test')$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.must_fail($q$select public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"exact"}','2030-01-01T09:00:00Z')$q$,'42501');
reset role;
set local role service_role;
select public.paid_journey_customer_field_hold_target(repeat('3',64),'https://checkout.example.test')->>'bookingId';
select pg_temp.must_fail($q$select * from public.paid_journey_customer_field_requests$q$,'42501');
reset role;
update public.services set base_price=13000 where id='85500000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.paid_journey_customer_field_hold_target(repeat('3',64),'https://checkout.example.test')$q$,'40001');
update public.services set base_price=12500 where id='85500000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.submit_paid_journey_hold_request(repeat('3',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{}','2030-01-01T09:00:00Z')$q$,'42501');
insert into public.paid_journey_customer_field_sessions select repeat('5',64),tenant_id,flow_id,version_id,installation_id,service_id,publication_generation,origin,issued_at-interval '16 minutes',expires_at-interval '16 minutes' from public.paid_journey_customer_field_sessions where token_hash=repeat('3',64);
select pg_temp.must_fail($q$select public.paid_journey_customer_field_hold_target(repeat('5',64),'https://checkout.example.test')$q$,'42501');
update public.paid_journey_publication_generations set generation=generation+1 where flow_id='85500000-0000-4000-8000-000000000004';
select pg_temp.must_fail($q$select public.paid_journey_customer_field_hold_target(repeat('3',64),'https://checkout.example.test')$q$,'42501');
rollback;