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
do $$declare f jsonb;receipt jsonb;bad jsonb;role text;begin
 select form into f from fixture;
 assert lumin.paid_journey_customer_field_form_valid(f);
 assert lumin.paid_journey_customer_field_json_bytes('{"a": [1, true, "hello world"]}')=28;
 for bad in select value from jsonb_array_elements(jsonb_build_array(f||'{"price":1}',jsonb_set(f,'{fieldBindings}','[]'),jsonb_set(f,'{fieldBindings,0,stageId}','"schedule"'),jsonb_set(f,'{fieldBindings,1,fieldId}','"custom_gate"'),jsonb_set(f,'{customerFields,1,when,fieldId}','"custom_missing"'),jsonb_set(f,'{name}',to_jsonb(' bad '::text)),jsonb_set(f,'{name}',to_jsonb(repeat(U&'\+01f600',101))),jsonb_set(f,'{fieldBindings,0,stageId}','"informational_access"')||jsonb_build_object('fieldBindings',jsonb_build_array(jsonb_build_object('fieldId','custom_gate','stageId','informational_access'),jsonb_build_object('fieldId','custom_code','stageId','information'))))) loop
  assert not lumin.paid_journey_customer_field_form_valid(bad);
 end loop;
 receipt:=public.save_paid_journey_customer_field_draft('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000003',0,f);
 assert receipt->>'revision'='1' and receipt->>'schemaVersion'='2';
 assert public.get_paid_journey_customer_field_draft('79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004')->'form'=f;
 perform pg_temp.must_fail(format('select public.save_paid_journey_customer_field_draft(%L,%L,%L,%L,0,%L::jsonb)','79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000003',f),'23505');
 perform pg_temp.must_fail(format('select public.save_paid_journey_customer_field_draft(%L,%L,%L,%L,9,%L::jsonb)','79000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000004','79000000-0000-4000-8000-000000000003',f),'40001');
 perform pg_temp.must_fail('select public.get_paid_journey_customer_field_draft(''79000000-0000-4000-8000-000000000009'',''79000000-0000-4000-8000-000000000002'',''79000000-0000-4000-8000-000000000004'')','42501');
 for role in select unnest(array['anon','authenticated','service_role']) loop
  assert not has_table_privilege(role,'public.paid_journey_customer_field_drafts','SELECT,INSERT,UPDATE,DELETE');
  assert not has_function_privilege(role,'lumin.paid_journey_customer_field_form_valid(jsonb)','EXECUTE');
  assert has_function_privilege(role,'public.get_paid_journey_customer_field_draft(uuid,uuid,uuid)','EXECUTE')=(role='service_role');
 end loop;
 assert (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_journey_customer_field_drafts'::regclass);
 perform pg_temp.must_fail('insert into public.flows(id,tenant_id,name,status) values(''79000000-0000-4000-8000-000000000004'',''79000000-0000-4000-8000-000000000002'',''Collision'',''active'')','0A000');
 perform pg_temp.must_fail('select public.save_paid_journey_draft(''79000000-0000-4000-8000-000000000001'',''79000000-0000-4000-8000-000000000002'',''79000000-0000-4000-8000-000000000004'',''79000000-0000-4000-8000-000000000003'',0,''Legacy'',''{"accentColor":"#0e7490","layout":"compact"}'',''{"schemaVersion":1,"stages":[{"id":"service","kind":"service","label":"Service","enabled":true},{"id":"options","kind":"options","label":"Options","enabled":false},{"id":"schedule","kind":"schedule","label":"Schedule","enabled":true},{"id":"information","kind":"information","label":"Information","enabled":true},{"id":"review_payment","kind":"review_payment","label":"Review","enabled":true},{"id":"confirmation","kind":"confirmation","label":"Confirmation","enabled":true}]}'')','0A000');
end$$;
update public.tenant_members set role='BUSINESS_STAFF' where user_id='79000000-0000-4000-8000-000000000001';
select pg_temp.must_fail('select public.get_paid_journey_customer_field_draft(''79000000-0000-4000-8000-000000000001'',''79000000-0000-4000-8000-000000000002'',''79000000-0000-4000-8000-000000000004'')','42501');
update public.tenant_members set role='BUSINESS_OWNER' where user_id='79000000-0000-4000-8000-000000000001';
update public.tenants set status='suspended' where id='79000000-0000-4000-8000-000000000002';
select pg_temp.must_fail('select public.get_paid_journey_customer_field_draft(''79000000-0000-4000-8000-000000000001'',''79000000-0000-4000-8000-000000000002'',''79000000-0000-4000-8000-000000000004'')','42501');
update public.tenants set status='active' where id='79000000-0000-4000-8000-000000000002';
update public.services set tax_rate_bp=100 where id='79000000-0000-4000-8000-000000000003';
select pg_temp.must_fail('select public.get_paid_journey_customer_field_draft(''79000000-0000-4000-8000-000000000001'',''79000000-0000-4000-8000-000000000002'',''79000000-0000-4000-8000-000000000004'')','0A000');
rollback;
