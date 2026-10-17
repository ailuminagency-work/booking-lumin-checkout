\set ON_ERROR_STOP on
begin;
do $$begin
 if current_user<>'postgres' or not(
  (host(inet_server_addr())='127.0.0.1' and inet_server_port()=59075 and current_database() ~ '^lumin_phase_a_journey_hold_[a-z0-9_]+$')
  or (inet_server_port()=5432 and current_database()='lumin_phase_a_journey_hold_ci' and
   (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))
 ) then raise exception 'DISPOSABLE_JOURNEY_HOLD_TARGET_REQUIRED';end if;
end$$;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('70000000-0000-4000-8000-000000000001','journey-publish-owner@example.test'),('70000000-0000-4000-8000-000000000099','journey-publish-other@example.test');
select public.create_staging_business('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','Journey','journey-publication','UTC','USD','HOUSEKEEPING','journey_publication_owner');
select public.create_staging_business('70000000-0000-4000-8000-000000000099','70000000-0000-4000-8000-000000000098','Foreign','journey-publication-other','UTC','USD','HOUSEKEEPING','journey_publication_other');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
create function pg_temp.journey(reordered boolean default false) returns jsonb language sql as $$select jsonb_build_object('schemaVersion',1,'stages',jsonb_agg(jsonb_build_object('id',kind,'kind',kind,'label',kind,'enabled',kind<>'options') order by n)) from unnest(case when reordered then array['service','options','information','schedule','review_payment','confirmation'] else array['service','options','schedule','information','review_payment','confirmation'] end) with ordinality s(kind,n)$$;
create function pg_temp.save(r bigint default 0,reordered boolean default false,f uuid default '70000000-0000-4000-8000-000000000004') returns jsonb language sql as $$select public.save_paid_journey_draft('70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002',f,'70000000-0000-4000-8000-000000000003',r,'Journey','{"accentColor":"#4f46e5","layout":"stacked"}',pg_temp.journey(reordered))$$;
create function pg_temp.publish(r bigint default 1,v uuid default '70000000-0000-4000-8000-000000000005',i uuid default '70000000-0000-4000-8000-000000000006',o jsonb default '["https://checkout.example.test"]',approved jsonb default '["https://checkout.example.test"]',a uuid default '70000000-0000-4000-8000-000000000001',t uuid default '70000000-0000-4000-8000-000000000002',f uuid default '70000000-0000-4000-8000-000000000004') returns jsonb language sql as $$select public.publish_paid_journey_draft(a,t,f,r,v,i,o,approved)$$;
select pg_temp.save();
select pg_temp.publish();
create function pg_temp.issue(h text default repeat('a',64),i uuid default '70000000-0000-4000-8000-000000000006',o text default 'https://checkout.example.test') returns jsonb language sql as $$select public.issue_paid_journey_session(i,h,o)$$;
select pg_temp.issue();
create function pg_temp.submit(h text default repeat('a',64),o text default 'https://checkout.example.test',k text default 'journey-request-test-0001',c jsonb default '{"name":"Staging customer","email":"customer@example.test"}',a jsonb default '{}',start_at timestamptz default date_trunc('day',clock_timestamp())+interval '1 day 9 hours') returns jsonb language sql as $$select public.submit_paid_journey_hold_request(h,o,k,c,a,start_at)$$;
create temp table accepted as select pg_temp.submit() receipt;
select pg_temp.assert((select (receipt->>'replayed')::boolean=false from accepted),'new dedicated request');
select pg_temp.assert((pg_temp.submit()->>'replayed')::boolean,'same session payload replay');
select pg_temp.assert((select count(*)=1 from public.paid_journey_requests) and (select count(*)=1 from public.bookings) and (select count(*)=0 from public.flow_sessions) and (select count(*)=0 from public.flow_requests) and (select count(*)=0 from public.payments),'dedicated provenance without legacy alias or payment');
select pg_temp.assert((select state='draft' and selection='{"serviceId":"70000000-0000-4000-8000-000000000003"}' and pricing='{}' from public.bookings),'no client pricing or confirmation');
select pg_temp.reject($q$select public.assert_legacy_mock_payment_booking('70000000-0000-4000-8000-000000000002',(select booking_id from public.paid_journey_requests))$q$,'0A000');
select pg_temp.assert(has_function_privilege('service_role','public.assert_legacy_mock_payment_booking(uuid,uuid)','execute') and not has_function_privilege('anon','public.assert_legacy_mock_payment_booking(uuid,uuid)','execute') and not has_function_privilege('authenticated','public.assert_legacy_mock_payment_booking(uuid,uuid)','execute'),'service-only payment provenance exclusion without raw table grants');
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_journey_requests'::regclass),'forced request RLS');
select pg_temp.assert(not has_table_privilege('service_role','public.paid_journey_requests','select,insert,update,delete') and not has_function_privilege('anon','public.submit_paid_journey_hold_request(text,text,text,jsonb,jsonb,timestamptz)','execute') and not has_function_privilege('authenticated','public.paid_journey_hold_target(text,text)','execute'),'no client/direct-table grants');
set local role anon;select pg_temp.reject($q$select public.paid_journey_hold_target(repeat('a',64),'https://checkout.example.test')$q$,'42501');reset role;
select pg_temp.reject($q$select pg_temp.submit(k=>'changed-key-00001')$q$,'40001');
select pg_temp.reject($q$select pg_temp.submit(c=>'{"name":"Other customer","email":"other@example.test"}')$q$,'40001');
select pg_temp.reject($q$select pg_temp.submit(a=>'{"price":1}')$q$,'22023');
select pg_temp.reject($q$select pg_temp.submit(c=>'{"name":"Staging customer","email":"customer@example.test","tenantId":"70000000-0000-4000-8000-000000000098"}')$q$,'22023');
select pg_temp.reject($q$select pg_temp.submit(c=>'{"name":" invalid ","email":"customer@example.test"}')$q$,'22023');
select pg_temp.reject($q$select pg_temp.submit(h=>repeat('b',64))$q$,'42501');
select pg_temp.reject($q$select pg_temp.submit(o=>'https://portal.example.test')$q$,'42501');
select pg_temp.reject($q$update public.paid_journey_requests set canonical_payload='{}'$q$,'55000');
update public.bookings set selection='{"serviceId":"70000000-0000-4000-8000-000000000099"}';
select pg_temp.reject($q$select public.paid_journey_hold_target(repeat('a',64),'https://checkout.example.test')$q$,'40001');
update public.bookings set selection='{"serviceId":"70000000-0000-4000-8000-000000000003"}';
update public.services set base_price=12600 where id='70000000-0000-4000-8000-000000000003';
select pg_temp.reject($q$select pg_temp.submit()$q$,'40001');
update public.services set base_price=12500 where id='70000000-0000-4000-8000-000000000003';
insert into public.paid_journey_sessions select repeat('e',64),tenant_id,flow_id,version_id,installation_id,service_id,origin,stamp-interval '16 minutes',stamp-interval '1 minute' from public.paid_journey_sessions cross join (select clock_timestamp() stamp) x limit 1;
select pg_temp.reject($q$select pg_temp.submit(h=>repeat('e',64))$q$,'42501');
select pg_temp.save(1,true);select pg_temp.publish(r=>2,v=>'70000000-0000-4000-8000-000000000025',i=>'70000000-0000-4000-8000-000000000026');
select pg_temp.reject($q$select pg_temp.submit()$q$,'P0002');
rollback;
\echo PASS dedicated V8 request provenance replay RLS isolation immutability and no financial writer
