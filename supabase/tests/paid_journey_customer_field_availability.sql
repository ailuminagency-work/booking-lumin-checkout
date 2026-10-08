\set ON_ERROR_STOP on
begin;
do $$begin if current_user<>'postgres' or not((host(inet_server_addr())='127.0.0.1' and inet_server_port()=59069 and current_database() ~ '^lumin_journey_fields_availability_local_[a-z0-9_]+$') or (inet_server_port()=5432 and current_database()='lumin_journey_fields_availability_ci' and (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))) then raise exception 'DISPOSABLE_V9_SESSION_TARGET_REQUIRED';end if;end$$;
create function pg_temp.must_fail(q text,code text) returns void language plpgsql as $$begin execute q;raise exception 'TEST_EXPECTED_FAILURE';exception when others then if sqlstate<>code then raise exception 'Expected %, got %: %',code,sqlstate,sqlerrm;end if;end$$;
insert into auth.users(id,email) values('84500000-0000-4000-8000-000000000001','session-owner@example.test'),('84500000-0000-4000-8000-000000000009','session-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('84500000-0000-4000-8000-000000000002','Fields','session-draft-test','UTC','USD'),('84500000-0000-4000-8000-000000000008','Foreign','session-draft-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('84500000-0000-4000-8000-000000000002','84500000-0000-4000-8000-000000000001','BUSINESS_OWNER'),('84500000-0000-4000-8000-000000000008','84500000-0000-4000-8000-000000000009','BUSINESS_OWNER');
select public.initialize_staging_business_profile('84500000-0000-4000-8000-000000000001','84500000-0000-4000-8000-000000000002','HOUSEKEEPING','field_sql_owner_fixture');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('84500000-0000-4000-8000-000000000003','84500000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
create temp table fixture(form jsonb);
insert into fixture values('{
"name":"Cleaning","presentation":{"accentColor":"#0e7490","layout":"compact"},"journey":{"schemaVersion":1,"stages":[{"id":"service","kind":"service","label":"Service","enabled":true},{"id":"options","kind":"options","label":"Options","enabled":false},{"id":"schedule","kind":"schedule","label":"Schedule","enabled":true},{"id":"information","kind":"information","label":"Information","enabled":true},{"id":"informational_access","kind":"informational","label":"Access","enabled":true},{"id":"review_payment","kind":"review_payment","label":"Review","enabled":true},{"id":"confirmation","kind":"confirmation","label":"Confirmation","enabled":true}]},"customerFields":[{"id":"custom_gate","kind":"text","label":"Gate","required":false,"maxLength":100},{"id":"custom_code","kind":"text","label":"Code","required":false,"maxLength":100,"when":{"fieldId":"custom_gate","equals":"yes"}}],"fieldBindings":[{"fieldId":"custom_gate","stageId":"information"},{"fieldId":"custom_code","stageId":"informational_access"}]}');
do $$declare form jsonb;r jsonb;begin
 select f.form into form from fixture f;
 perform public.save_paid_journey_customer_field_draft('84500000-0000-4000-8000-000000000001','84500000-0000-4000-8000-000000000002','84500000-0000-4000-8000-000000000004','84500000-0000-4000-8000-000000000003',0,form);
 perform public.publish_paid_journey_customer_field_draft('84500000-0000-4000-8000-000000000001','84500000-0000-4000-8000-000000000002','84500000-0000-4000-8000-000000000004',1,'84500000-0000-4000-8000-000000000005','84500000-0000-4000-8000-000000000006','["https://checkout.example.test"]','["https://checkout.example.test"]');
 perform public.issue_paid_journey_customer_field_session('84500000-0000-4000-8000-000000000006',repeat('a',64),'https://checkout.example.test');
 r:=public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test');
 assert r->'schemaVersion'='2' and r->>'tenantId'='84500000-0000-4000-8000-000000000002' and r->'publicationGeneration'='2' and r->'durationMinutes'='60' and r->>'timezone'='UTC';
 assert not(r ?| array['token','tokenHash','token_hash','customerAnswers','origin','render','price','customerFields']);
 assert public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')=r;
end$$;
create temp table session_before as select * from public.paid_journey_customer_field_sessions;
create temp table financial_before as select (select count(*) from public.bookings) bookings,(select count(*) from public.payments) payments,(select count(*) from public.capacity_holds) holds,(select count(*) from public.paid_journey_sessions) legacy_sessions,(select count(*) from public.durable_outbox) outbox;
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope('plaintext','https://checkout.example.test')$q$,'22023');
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('b',64),'https://checkout.example.test')$q$,'P0002');
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://other.example.test')$q$,'42501');
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test/')$q$,'22023');
update public.services set base_price=13000 where id='84500000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')$q$,'40001');
update public.services set base_price=12500,active=false where id='84500000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')$q$,'P0002');
update public.services set active=true where id='84500000-0000-4000-8000-000000000003';
update public.tenants set status='suspended' where id='84500000-0000-4000-8000-000000000002';
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')$q$,'P0002');
update public.tenants set status='active' where id='84500000-0000-4000-8000-000000000002';
select pg_temp.must_fail($q$select public.resolve_paid_journey_session(repeat('a',64),'https://checkout.example.test')$q$,'42501');
set local role anon;
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')$q$,'42501');
reset role;
set local role service_role;
select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')->>'schemaVersion';
select pg_temp.must_fail($q$select * from public.paid_journey_customer_field_sessions$q$,'42501');
reset role;
do $$begin assert not exists((select * from public.paid_journey_customer_field_sessions except select * from session_before) union all (select * from session_before except select * from public.paid_journey_customer_field_sessions));assert (select bookings=(select count(*) from public.bookings) and payments=(select count(*) from public.payments) and holds=(select count(*) from public.capacity_holds) and legacy_sessions=(select count(*) from public.paid_journey_sessions) and outbox=(select count(*) from public.durable_outbox) from financial_before);end$$;
-- Structural profile remains immutable and a different vertical is rejected.
select public.initialize_staging_business_profile('84500000-0000-4000-8000-000000000009','84500000-0000-4000-8000-000000000008','AUTO_DETAILING','field_sql_foreign_fixture');
select pg_temp.must_fail($q$select lumin.paid_journey_customer_field_catalog('84500000-0000-4000-8000-000000000008','84500000-0000-4000-8000-000000000003')$q$,'0A000');
select pg_temp.must_fail($q$update public.business_profiles set business_type='AUTO_DETAILING' where tenant_id='84500000-0000-4000-8000-000000000002'$q$,'55000');
insert into public.paid_journey_customer_field_sessions select repeat('e',64),tenant_id,flow_id,version_id,installation_id,service_id,publication_generation,origin,issued_at-interval '16 minutes',expires_at-interval '16 minutes' from public.paid_journey_customer_field_sessions where token_hash=repeat('a',64);
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('e',64),'https://checkout.example.test')$q$,'42501');
-- Advancing the private generation models same-pointer A-B-A restoration.
update public.paid_journey_publication_generations set generation=generation+1 where flow_id='84500000-0000-4000-8000-000000000004';
select pg_temp.must_fail($q$select public.paid_journey_customer_field_availability_scope(repeat('a',64),'https://checkout.example.test')$q$,'42501');
rollback;
