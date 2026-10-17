-- Disposable local/staging attack suite. Transaction rolls all fixtures back.
begin;
create function pg_temp.must_fail(q text,code text) returns void language plpgsql as $$begin execute q;raise exception 'TEST_EXPECTED_FAILURE';exception when others then if sqlstate<>code then raise exception 'Expected %, got %: %',code,sqlstate,sqlerrm;end if;end$$;
insert into auth.users(id,email) values('79000000-0000-4000-8000-000000000001','field-owner@example.test'),('79000000-0000-4000-8000-000000000009','field-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('79000000-0000-4000-8000-000000000002','Fields','field-draft-test','UTC','USD'),('79000000-0000-4000-8000-000000000008','Foreign','field-draft-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000001','BUSINESS_OWNER'),('79000000-0000-4000-8000-000000000008','79000000-0000-4000-8000-000000000009','BUSINESS_OWNER');
select public.initialize_staging_business_profile('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','HOUSEKEEPING','field_sql_owner_fixture');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('79000000-0000-4000-8000-000000000003','79000000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
create temp table fixture(form jsonb);
insert into fixture values('{
"name":"Cleaning","presentation":{"accentColor":"#0e7490","layout":"compact"},"journey":{"schemaVersion":1,"stages":[{"id":"service","kind":"service","label":"Service","enabled":true},{"id":"options","kind":"options","label":"Options","enabled":false},{"id":"schedule","kind":"schedule","label":"Schedule","enabled":true},{"id":"information","kind":"information","label":"Information","enabled":true},{"id":"informational_access","kind":"informational","label":"Access","enabled":true},{"id":"review_payment","kind":"review_payment","label":"Review","enabled":true},{"id":"confirmation","kind":"confirmation","label":"Confirmation","enabled":true}]},"customerFields":[{"id":"custom_gate","kind":"text","label":"Gate","required":false,"maxLength":100},{"id":"custom_code","kind":"text","label":"Code","required":false,"maxLength":100,"when":{"fieldId":"custom_gate","equals":"yes"}}],"fieldBindings":[{"fieldId":"custom_gate","stageId":"information"},{"fieldId":"custom_code","stageId":"informational_access"}]}');
do $$declare f jsonb;r jsonb;role text;begin
 select form into f from fixture;
 perform public.save_paid_journey_customer_field_draft('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000003',0,f);
 r:=public.publish_paid_journey_customer_field_draft('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004',1,'79000000-0000-4000-8000-000000000005','79000000-0000-4000-8000-000000000006','["https://checkout.example.test"]','["https://checkout.example.test"]');
 assert r->'renderSchemaVersion'='9';assert r->'replayed'='false';
 assert (select count(*)=0 from lumin.paid_journey_customer_field_publication_proofs);
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_journey_customer_field_publications'::regclass);
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='lumin.paid_journey_customer_field_publication_proofs'::regclass);
 foreach role in array array['anon','authenticated','service_role'] loop
 assert not has_table_privilege(role,'lumin.paid_journey_customer_field_publication_proofs','INSERT');assert not has_table_privilege(role,'lumin.paid_journey_customer_field_publication_proofs','SELECT');
 assert not has_table_privilege(role,'public.paid_journey_customer_field_publications','INSERT');assert not has_table_privilege(role,'public.paid_journey_customer_field_publications','SELECT');
 assert not has_function_privilege(role,'lumin.guard_paid_journey_customer_field_flow_mutation()','EXECUTE');
 if role<>'service_role' then assert not has_function_privilege(role,'public.publish_paid_journey_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb,jsonb)','EXECUTE');end if;
 end loop;
end$$;
select pg_temp.must_fail($q$update public.flows set name='stolen' where id='79000000-0000-4000-8000-000000000004'$q$,'55000');
select pg_temp.must_fail($q$update public.flows set status='inactive' where id='79000000-0000-4000-8000-000000000004'$q$,'55000');
select pg_temp.must_fail($q$update public.flows set published_version_id=null where id='79000000-0000-4000-8000-000000000004'$q$,'55000');
select pg_temp.must_fail($q$delete from public.flows where id='79000000-0000-4000-8000-000000000004'$q$,'55000');

-- Mutation guards independently reject forged immutable render and installation aliases.
select pg_temp.must_fail($q$update public.flow_versions set journey_snapshot=jsonb_set(journey_snapshot,'{service,price,amount}','1') where id='79000000-0000-4000-8000-000000000005'$q$,'55000');
select pg_temp.must_fail($q$insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values('79000000-0000-4000-8000-000000000019','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000005','["https://checkout.example.test"]')$q$,'55000');
-- Controlled corrupt-profile fixture exists only inside this rolled-back suite.
alter table public.business_profiles disable trigger business_profiles_immutable;
update public.business_profiles set business_type='AUTO_DETAILING' where tenant_id='79000000-0000-4000-8000-000000000002';
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')$q$,'P0002');
update public.business_profiles set business_type='HOUSEKEEPING' where tenant_id='79000000-0000-4000-8000-000000000002';
alter table public.business_profiles enable trigger business_profiles_immutable;
create temp table public_reader_before as select
 (select count(*) from public.bookings) bookings,(select count(*) from public.payments) payments,
 (select count(*) from public.capacity_holds) holds,(select count(*) from public.flow_sessions) sessions,
 (select count(*) from public.paid_journey_sessions) journey_sessions,(select count(*) from public.durable_outbox) outbox;
do $$declare r jsonb;role text;begin
 r:=public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test');
 assert r->>'versionId'='79000000-0000-4000-8000-000000000005';assert r->'renderSchemaVersion'='9';assert r#>>'{service,price,amount}'='12500';
 foreach role in array array['anon','authenticated'] loop assert not has_function_privilege(role,'public.get_paid_journey_customer_field_render(uuid,text)','EXECUTE');end loop;
 assert has_function_privilege('service_role','public.get_paid_journey_customer_field_render(uuid,text)','EXECUTE');
end$$;
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test.evil.test')$q$,'P0002');
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://foreign.example.test')$q$,'P0002');
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','*')$q$,'22023');
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000008','https://checkout.example.test')$q$,'P0002');
update public.services set base_price=19000,duration_minutes=90,name='Current changed catalog' where id='79000000-0000-4000-8000-000000000003';
do $$declare r jsonb;begin r:=public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test');assert r#>>'{service,price,amount}'='12500';assert r#>>'{service,durationMinutes}'='60';assert r#>>'{service,name}'='Cleaning';end$$;
update public.services set active=false where id='79000000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')$q$,'P0002');
update public.services set active=true,base_price=12500,duration_minutes=60,name='Cleaning' where id='79000000-0000-4000-8000-000000000003';
update public.tenants set status='suspended' where id='79000000-0000-4000-8000-000000000002';
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')$q$,'P0002');
update public.tenants set status='active' where id='79000000-0000-4000-8000-000000000002';
set local role anon;
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')$q$,'42501');
select pg_temp.must_fail($q$select * from public.paid_journey_customer_field_publications$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')$q$,'42501');
reset role;
set local role service_role;
select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')->>'renderSchemaVersion';
select pg_temp.must_fail($q$select * from public.paid_journey_customer_field_publications$q$,'42501');
reset role;
do $$declare f jsonb;begin
 select form into f from fixture;
 perform public.save_paid_journey_customer_field_draft('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000003',1,f||jsonb_build_object('name','Updated'));
 perform public.publish_paid_journey_customer_field_draft('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004',2,'79000000-0000-4000-8000-000000000015','79000000-0000-4000-8000-000000000016','["https://checkout.example.test"]','["https://checkout.example.test"]');
end$$;
select pg_temp.must_fail($q$select public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000006','https://checkout.example.test')$q$,'P0002');
do $$begin
 assert public.get_paid_journey_customer_field_render('79000000-0000-4000-8000-000000000016','https://checkout.example.test')#>>'{form,name}'='Updated';
 assert (select bookings=(select count(*) from public.bookings) and payments=(select count(*) from public.payments) and holds=(select count(*) from public.capacity_holds) and sessions=(select count(*) from public.flow_sessions) and journey_sessions=(select count(*) from public.paid_journey_sessions) and outbox=(select count(*) from public.durable_outbox) from public_reader_before);
end$$;
rollback;