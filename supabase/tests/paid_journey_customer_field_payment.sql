\set ON_ERROR_STOP on
begin;
do $$begin if current_user<>'postgres' or not((host(inet_server_addr())='127.0.0.1' and inet_server_port()=59069 and current_database() ~ '^lumin_journey_fields_payment_local_[a-z0-9_]+$') or (inet_server_port()=5432 and current_database()='lumin_journey_fields_payment_ci' and (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))) then raise exception 'DISPOSABLE_V9_SESSION_TARGET_REQUIRED';end if;end$$;
create function pg_temp.must_fail(q text,code text) returns void language plpgsql as $$begin execute q;raise exception 'TEST_EXPECTED_FAILURE';exception when others then if sqlstate<>code then raise exception 'Expected %, got %: %',code,sqlstate,sqlerrm;end if;end$$;
insert into auth.users(id,email) values('86500000-0000-4000-8000-000000000001','session-owner@example.test'),('86500000-0000-4000-8000-000000000009','session-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('86500000-0000-4000-8000-000000000002','Fields','session-draft-test','UTC','USD'),('86500000-0000-4000-8000-000000000008','Foreign','session-draft-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('86500000-0000-4000-8000-000000000002','86500000-0000-4000-8000-000000000001','BUSINESS_OWNER'),('86500000-0000-4000-8000-000000000008','86500000-0000-4000-8000-000000000009','BUSINESS_OWNER');
select public.initialize_staging_business_profile('86500000-0000-4000-8000-000000000001','86500000-0000-4000-8000-000000000002','HOUSEKEEPING','field_sql_owner_fixture');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('86500000-0000-4000-8000-000000000003','86500000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
create temp table fixture(form jsonb);
insert into fixture values('{
"name":"Cleaning","presentation":{"accentColor":"#0e7490","layout":"compact"},"journey":{"schemaVersion":1,"stages":[{"id":"service","kind":"service","label":"Service","enabled":true},{"id":"options","kind":"options","label":"Options","enabled":false},{"id":"schedule","kind":"schedule","label":"Schedule","enabled":true},{"id":"information","kind":"information","label":"Information","enabled":true},{"id":"informational_access","kind":"informational","label":"Access","enabled":true},{"id":"review_payment","kind":"review_payment","label":"Review","enabled":true},{"id":"confirmation","kind":"confirmation","label":"Confirmation","enabled":true}]},"customerFields":[{"id":"custom_gate","kind":"text","label":"Gate","required":false,"maxLength":100},{"id":"custom_code","kind":"text","label":"Code","required":false,"maxLength":100,"when":{"fieldId":"custom_gate","equals":"yes"}}],"fieldBindings":[{"fieldId":"custom_gate","stageId":"information"},{"fieldId":"custom_code","stageId":"informational_access"}]}');
do $$declare form jsonb;r jsonb;begin
 select f.form into form from fixture f;
 perform public.save_paid_journey_customer_field_draft('86500000-0000-4000-8000-000000000001','86500000-0000-4000-8000-000000000002','86500000-0000-4000-8000-000000000004','86500000-0000-4000-8000-000000000003',0,form);
 perform public.publish_paid_journey_customer_field_draft('86500000-0000-4000-8000-000000000001','86500000-0000-4000-8000-000000000002','86500000-0000-4000-8000-000000000004',1,'86500000-0000-4000-8000-000000000005','86500000-0000-4000-8000-000000000006','["https://checkout.example.test"]','["https://checkout.example.test"]');
 perform public.issue_paid_journey_customer_field_session('86500000-0000-4000-8000-000000000006',repeat('3',64),'https://checkout.example.test');
 r:=public.resolve_paid_journey_customer_field_session(repeat('3',64),'https://checkout.example.test');
 assert r->'schemaVersion'='2' and r->>'tenantId'='86500000-0000-4000-8000-000000000002' and r->'publicationGeneration'='2' and r#>'{render,renderSchemaVersion}'='9';
 assert not(r ?| array['token','tokenHash','token_hash','customerAnswers','origin']);
 assert public.resolve_paid_journey_customer_field_session(repeat('3',64),'https://checkout.example.test')=r;
end$$;
create temp table submitted as select public.submit_paid_journey_customer_field_hold_request(repeat('3',64),'https://checkout.example.test','fields-sql-hold-0001','{"name":"Customer","email":"customer@example.test"}','{"custom_gate":"yes","custom_code":"exact"}','2030-01-01T09:00:00.000Z') result;

select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test')$q$,'40001');
select public.reserve_capacity('86500000-0000-4000-8000-000000000002','86500000-0000-4000-8000-000000000003','2030-01-01T09:00:00Z','2030-01-01T10:00:00Z',(select(result->>'bookingId')::uuid from submitted),1,interval '5 minutes');
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://foreign.example.test')$q$,'42501');
create temp table paid as select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test') result;
do $$declare r jsonb;replay jsonb;begin select result into r from paid;assert r->'schemaVersion'='2' and r->'replayed'='false' and r->'realPayment'='false' and r->'productionMoney'='false' and r->'simulated'='true' and r->>'provider'='staging_mock' and r->>'state'='confirmed' and r->'amount'='12500' and r->>'currency'='USD';assert not(r ?| array['tenantId','sessionToken','answers','customer','render']);replay:=public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test');assert replay->'replayed'='true' and (replay-'replayed')=(r-'replayed');assert(select count(*)from public.payments)=1;assert(select count(*)from public.durable_outbox)=1;assert(select count(*)from public.bookings where state='confirmed')=1;assert(select count(*)from public.capacity_holds where status='consumed')=1;perform pg_temp.must_fail(format('select public.assert_legacy_mock_payment_booking(%L,%L)','86500000-0000-4000-8000-000000000002',r->>'bookingId'),'0A000');end$$;
do $$declare role text;begin foreach role in array array['anon','authenticated']loop assert not has_function_privilege(role,'public.pay_paid_journey_customer_field_mock(text,text)','EXECUTE');end loop;assert has_function_privilege('service_role','public.pay_paid_journey_customer_field_mock(text,text)','EXECUTE');end$$;
set local role anon;
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test')$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test')$q$,'42501');
reset role;
select pg_temp.must_fail($q$select public.pay_paid_journey_mock(repeat('3',64),'https://checkout.example.test')$q$,'42501');
update public.payments set amount=1 where id=(select(result->>'paymentId')::uuid from paid);
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test')$q$,'40001');
update public.payments set amount=12500 where id=(select(result->>'paymentId')::uuid from paid);
update public.services set base_price=13000 where id='86500000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test')$q$,'40001');
update public.services set base_price=12500 where id='86500000-0000-4000-8000-000000000003';
insert into public.paid_journey_customer_field_sessions select repeat('5',64),tenant_id,flow_id,version_id,installation_id,service_id,publication_generation,origin,issued_at-interval '16 minutes',expires_at-interval '16 minutes' from public.paid_journey_customer_field_sessions where token_hash=repeat('3',64);
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('5',64),'https://checkout.example.test')$q$,'42501');
select pg_temp.must_fail($q$update public.business_profiles set business_type='AUTO_DETAILING' where tenant_id='86500000-0000-4000-8000-000000000002'$q$,'55000');
update public.paid_journey_publication_generations set generation=generation+1 where flow_id='86500000-0000-4000-8000-000000000004';
select pg_temp.must_fail($q$select public.pay_paid_journey_customer_field_mock(repeat('3',64),'https://checkout.example.test')$q$,'42501');
rollback;
