\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('34000000-0000-4000-8000-000000000001','customer-scope-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('34000000-0000-4000-8000-000000000002','Scope test','customer-scope-test','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values('34000000-0000-4000-8000-000000000003','34000000-0000-4000-8000-000000000002','simple','Service','USD',0,60);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values('34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000003','count','Count','quantity',0,1,5,'[]');
select public.save_bound_flow_draft('34000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000004','34000000-0000-4000-8000-000000000003',0,'Flow','{"key":"request","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]}');
select public.publish_bound_flow('34000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000004',1,'34000000-0000-4000-8000-000000000005','34000000-0000-4000-8000-000000000006','["https://checkout.example.test"]');
select public.issue_flow_session('34000000-0000-4000-8000-000000000006',repeat('a',64),'https://checkout.example.test');
select pg_temp.reject($q$select public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test')$q$,'P0002');
select public.submit_flow_request(repeat('a',64),'https://checkout.example.test','hold-request-00001','{"count":{"quantity":1}}','{"name":"Customer","email":"customer@example.test"}',date_trunc('day',clock_timestamp())+interval '1 day 10 hours');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
select tenant_id,(selection->>'serviceId')::uuid,id,slot_start,slot_end,'customer-payment-fixture','active',clock_timestamp()+interval '5 minutes' from public.bookings where tenant_id='34000000-0000-4000-8000-000000000002';
select pg_temp.assert(not has_function_privilege('anon','public.customer_flow_payment_target(text,text)','EXECUTE'),'anon cannot resolve capability');
select pg_temp.assert(not has_function_privilege('authenticated','public.customer_flow_payment_target(text,text)','EXECUTE'),'authenticated cannot resolve capability');
set local role service_role;
select pg_temp.assert(public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test')->>'tenantId'='34000000-0000-4000-8000-000000000002','scope derives correct tenant');
select pg_temp.assert(public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test')->>'serviceId'='34000000-0000-4000-8000-000000000003','scope derives correct service');
select pg_temp.reject($q$select public.customer_flow_payment_target(repeat('b',64),'https://checkout.example.test')$q$,'42501');
select pg_temp.reject($q$select public.customer_flow_payment_target(repeat('a',64),'https://foreign.example.test')$q$,'42501');
reset role;
select pg_temp.assert((select public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test')->>'bookingId'=booking_id::text from public.flow_requests where session_id=(select id from public.flow_sessions where token_hash=repeat('a',64))),'target derives exact request booking');
do $$declare mutation text; rejected boolean; begin
 foreach mutation in array array[
  'update public.capacity_holds set expires_at=clock_timestamp()-interval ''1 second''',
  'update public.bookings set selection=''{}'' where tenant_id=''34000000-0000-4000-8000-000000000002''',
  'update public.flow_sessions set revoked=true',
  'update public.flow_sessions set expires_at=clock_timestamp()-interval ''1 second''',
  'update public.tenants set status=''suspended'' where id=''34000000-0000-4000-8000-000000000002''',
  'update public.flows set status=''archived'' where id=''34000000-0000-4000-8000-000000000004''',
  'update public.services set active=false where id=''34000000-0000-4000-8000-000000000003''',
  'update public.flow_installations set allowed_origins=''["https://foreign.example.test"]'' where id=''34000000-0000-4000-8000-000000000006'''
 ] loop
  begin
   execute mutation; rejected:=false;
   begin perform public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test'); exception when insufficient_privilege then rejected:=true; when serialization_failure then if mutation like 'update public.capacity_holds%' then rejected:=true;else raise;end if; end;
   if not rejected then raise exception 'FAIL: accepted invalid authority %',mutation; end if;
   -- Roll back this mutation only, keeping the fixture for the next attack.
   raise exception using errcode='ZX001';
  exception when sqlstate 'ZX001' then null; end;
 end loop;
end $$;
insert into public.resources(id,tenant_id,name) values('34000000-0000-4000-8000-000000000007','34000000-0000-4000-8000-000000000002','Resource');
insert into public.service_resources(tenant_id,service_id,resource_id) values('34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000003','34000000-0000-4000-8000-000000000007');
select pg_temp.reject($q$select public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test')$q$,'0A000');
delete from public.service_resources where tenant_id='34000000-0000-4000-8000-000000000002';
-- Policy opt-in correctly refuses an active obligation; expire this disposable fixture before the planning attack.
update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where tenant_id='34000000-0000-4000-8000-000000000002';
select public.save_allocation_policy('34000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000003',0,0,0,300,'none');
select pg_temp.reject($q$select public.customer_flow_payment_target(repeat('a',64),'https://checkout.example.test')$q$,'0A000');
select pg_temp.assert((select count(*)=1 from public.capacity_holds where tenant_id='34000000-0000-4000-8000-000000000002'),'target resolution preserves its existing hold');
rollback;
\echo PASS customer session payment target attacks
