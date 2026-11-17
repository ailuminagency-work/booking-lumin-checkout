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
rollback;
