\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('37000000-0000-4000-8000-000000000001','paid-sql-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('37000000-0000-4000-8000-000000000002','Paid SQL','paid-sql-test','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('37000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('37000000-0000-4000-8000-000000000003','37000000-0000-4000-8000-000000000002','Housekeeping','simple','USD',12500,60);
select pg_temp.assert(not has_function_privilege('anon','public.publish_paid_simple_flow(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE'),'anon cannot publish');
select pg_temp.assert(not has_function_privilege('authenticated','public.publish_paid_simple_flow(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE'),'browser JWT cannot directly publish');
select pg_temp.assert(not has_function_privilege('service_role','public.issue_flow_session_v12(uuid,text,text)','EXECUTE'),'legacy delegate is private');
select pg_temp.reject($q$select public.publish_paid_simple_flow('37000000-0000-4000-8000-000000000099','37000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000004','37000000-0000-4000-8000-000000000003','Paid','37000000-0000-4000-8000-000000000005','37000000-0000-4000-8000-000000000006','["https://checkout.example.test"]')$q$,'42501');
do $$declare mutation text;begin
 foreach mutation in array array[
  'update public.services set base_price=0 where id=''37000000-0000-4000-8000-000000000003''',
  'update public.services set tax_rate_bp=100 where id=''37000000-0000-4000-8000-000000000003''',
  'insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values(''37000000-0000-4000-8000-000000000002'',''37000000-0000-4000-8000-000000000003'',''qty'',''Quantity'',''quantity'',0,1,5,''[]'')'
 ] loop
  begin execute mutation;perform pg_temp.reject($q$select public.publish_paid_simple_flow('37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000004','37000000-0000-4000-8000-000000000003','Paid','37000000-0000-4000-8000-000000000005','37000000-0000-4000-8000-000000000006','["https://checkout.example.test"]')$q$,'0A000');raise exception using errcode='ZX001';exception when sqlstate 'ZX001' then null;end;
 end loop;
end$$;
select public.publish_paid_simple_flow('37000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000004','37000000-0000-4000-8000-000000000003','Paid','37000000-0000-4000-8000-000000000005','37000000-0000-4000-8000-000000000006','["https://checkout.example.test"]');
select pg_temp.assert((select render_schema_version=3 and paid_snapshot#>>'{service,price,amount}'='12500' and paid_snapshot->>'paymentMode'='staging_mock' from public.flow_versions where id='37000000-0000-4000-8000-000000000005'),'immutable V3 pins real catalog price and test mode');
select pg_temp.reject($q$update public.flow_versions set paid_snapshot='{}' where id='37000000-0000-4000-8000-000000000005'$q$,'55000');
select public.issue_flow_session('37000000-0000-4000-8000-000000000006',repeat('d',64),'https://checkout.example.test');
select pg_temp.reject($q$select public.submit_flow_request(repeat('d',64),'https://checkout.example.test','paid-sql-key-00001','{"amount":1}','{"name":"Customer","email":"paid-sql@example.test"}',clock_timestamp()+interval '1 day')$q$,'22023');
select public.submit_flow_request(repeat('d',64),'https://checkout.example.test','paid-sql-key-00001','{}','{"name":"Customer","email":"paid-sql@example.test"}',date_trunc('day',clock_timestamp())+interval '1 day 10 hours');
select pg_temp.assert((select selection=jsonb_build_object('serviceId','37000000-0000-4000-8000-000000000003') and pricing='{}' and state='draft' from public.bookings where tenant_id='37000000-0000-4000-8000-000000000002'),'request derives exact simple selection and no payment/price');
update public.services set base_price=13000 where id='37000000-0000-4000-8000-000000000003';
select pg_temp.reject($q$select public.customer_flow_availability_scope(repeat('d',64),'https://checkout.example.test')$q$,'0A000');
select pg_temp.assert((select count(*)=0 from public.payments where tenant_id='37000000-0000-4000-8000-000000000002'),'publication/request creates no payment');
rollback;
\echo PASS explicit paid V3 publication attacks
