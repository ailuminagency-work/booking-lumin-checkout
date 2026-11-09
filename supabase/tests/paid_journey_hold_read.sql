\set ON_ERROR_STOP on
begin;
do $$begin
 if current_user<>'postgres' or not(
  (host(inet_server_addr())='127.0.0.1' and inet_server_port()=59069 and current_database() ~ '^lumin_journey_hold_read_[a-z0-9_]+$')
  or (inet_server_port()=5432 and current_database()='lumin_journey_hold_read_ci' and
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
select * from public.reserve_capacity('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003',date_trunc('day',clock_timestamp())+interval '1 day 9 hours',date_trunc('day',clock_timestamp())+interval '1 day 10 hours',(select (receipt->>'bookingId')::uuid from accepted),1,interval '5 minutes');
create temp table before_hold as select * from public.capacity_holds;
create temp table recovered as select public.get_paid_journey_hold(repeat('a',64),'https://checkout.example.test') receipt;
select pg_temp.assert((select receipt->>'state'='draft' and receipt->>'confirmed'='false' and receipt->>'paymentMode'='unavailable' and receipt->>'replayed'='true' and receipt->>'status'='active' and not(receipt ?| array['tenantId','sessionExpiresAt','customer','token_hash','canonical_payload']) from recovered),'strict private-free existing hold receipt');
select pg_temp.assert(not exists((select * from public.capacity_holds except select * from before_hold) union all (select * from before_hold except select * from public.capacity_holds)),'read does not mutate hold');
select pg_temp.assert(has_function_privilege('service_role','public.get_paid_journey_hold(text,text)','execute') and not has_function_privilege('anon','public.get_paid_journey_hold(text,text)','execute') and not has_function_privilege('authenticated','public.get_paid_journey_hold(text,text)','execute'),'narrow service-only reader');
set local role service_role;select public.get_paid_journey_hold(repeat('a',64),'https://checkout.example.test');reset role;
set local role anon;select pg_temp.reject($q$select public.get_paid_journey_hold(repeat('a',64),'https://checkout.example.test')$q$,'42501');reset role;
select pg_temp.reject($q$select public.get_paid_journey_hold(repeat('b',64),'https://checkout.example.test')$q$,'42501');
select pg_temp.reject($q$select public.get_paid_journey_hold(repeat('a',64),'https://portal.example.test')$q$,'42501');
update public.capacity_holds set status='released';select pg_temp.reject($q$select public.get_paid_journey_hold(repeat('a',64),'https://checkout.example.test')$q$,'P0002');
update public.capacity_holds set status='active',expires_at=clock_timestamp()-interval '1 second';select pg_temp.reject($q$select public.get_paid_journey_hold(repeat('a',64),'https://checkout.example.test')$q$,'P0002');
select pg_temp.assert((select count(*)=1 from public.bookings) and (select count(*)=1 from public.paid_journey_requests) and (select count(*)=0 from public.payments),'no extra booking/payment/request');
rollback;
