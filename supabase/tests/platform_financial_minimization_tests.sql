-- After0001..0018 in a disposable DB. Synthetic fixtures roll back completely.
\set ON_ERROR_STOP on
begin;
set local time zone 'UTC';
insert into public.tenants(id,name,slug,timezone,currency) values
 ('a1800000-0000-4000-8000-000000000001','A','platform-min-a','UTC','USD'),
 ('b1800000-0000-4000-8000-000000000001','B','platform-min-b','UTC','EUR');
insert into auth.users(id,email) values
 ('a1800000-0000-4000-8000-000000000002','owner-a@example.test'),
 ('a1800000-0000-4000-8000-000000000003','staff-a@example.test'),
 ('b1800000-0000-4000-8000-000000000002','owner-b@example.test'),
 ('c1800000-0000-4000-8000-000000000002','platform-only@example.test'),
 ('d1800000-0000-4000-8000-000000000002','platform-owner-a@example.test');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('a1800000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000002','BUSINESS_OWNER'),
 ('a1800000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000003','BUSINESS_STAFF'),
 ('b1800000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000002','BUSINESS_OWNER'),
 ('a1800000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000002','BUSINESS_OWNER');
insert into public.platform_admins(user_id) values
 ('c1800000-0000-4000-8000-000000000002'),('d1800000-0000-4000-8000-000000000002');
insert into public.bookings(id,tenant_id,reference,state,pricing,slot_start,slot_end,idempotency_key,created_at) values
 ('a1800000-0000-4000-8000-000000000004','a1800000-0000-4000-8000-000000000001','PRIVATE-A-REFERENCE','confirmed','{"total":{"currency":"USD","amount":1000}}','2032-01-01T10:00Z','2032-01-01T11:00Z','platform-min-booking-a','2032-01-01T00:00Z'),
 ('b1800000-0000-4000-8000-000000000004','b1800000-0000-4000-8000-000000000001','PRIVATE-B-REFERENCE','confirmed','{"total":{"currency":"EUR","amount":2000}}','2032-01-01T10:00Z','2032-01-01T11:00Z','platform-min-booking-b','2032-01-01T00:00Z');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency,created_at) values
 ('a1800000-0000-4000-8000-000000000005','a1800000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000004','mock','PRIVATE-A-INTENT','succeeded',1000,'USD','2032-01-01T00:00Z'),
 ('b1800000-0000-4000-8000-000000000005','b1800000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000004','mock','PRIVATE-B-INTENT','succeeded',2000,'EUR','2032-01-01T00:00Z');
insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency,reason,created_at) values
 ('a1800000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000004','a1800000-0000-4000-8000-000000000005',200,'USD','PRIVATE-A-REASON','2032-01-01T00:00Z'),
 ('b1800000-0000-4000-8000-000000000001','b1800000-0000-4000-8000-000000000004','b1800000-0000-4000-8000-000000000005',300,'EUR','PRIVATE-B-REASON','2032-01-01T00:00Z');
insert into public.audit_events(tenant_id,name,data) values
 ('a1800000-0000-4000-8000-000000000001','payment.succeeded','{"marker":"PRIVATE-A-AUDIT"}'),
 ('b1800000-0000-4000-8000-000000000001','payment.succeeded','{"marker":"PRIVATE-B-AUDIT"}'),
 (null,'tenant.created','{"marker":"PRIVATE-PLATFORM-AUDIT"}');
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$
begin begin execute statement; exception when insufficient_privilege then return; end;raise exception 'FAIL: forbidden operation accepted';end $$;
create function pg_temp.reads(expected_tenant uuid,audit_count integer) returns void language plpgsql as $$
begin
 perform pg_temp.assert((select count(*) from public.payments)=case when expected_tenant is null then 0 else 1 end,'payment count');
 perform pg_temp.assert(not exists(select 1 from public.payments where tenant_id is distinct from expected_tenant),'foreign payments');
 perform pg_temp.assert((select count(*) from public.refunds)=case when expected_tenant is null then 0 else 1 end,'refund count');
 perform pg_temp.assert(not exists(select 1 from public.refunds where tenant_id is distinct from expected_tenant),'foreign refunds');
 perform pg_temp.assert((select count(*) from public.audit_events)=audit_count,'audit count');
 perform pg_temp.assert(not exists(select 1 from public.audit_events where tenant_id is null or tenant_id is distinct from expected_tenant),'foreign/platform audit');
end $$;
create function pg_temp.no_writes() returns void language plpgsql as $$
begin
 perform pg_temp.denied('insert into public.payments default values');
 perform pg_temp.denied('update public.payments set amount=0');
 perform pg_temp.denied('delete from public.payments');
 perform pg_temp.denied('insert into public.refunds default values');
 perform pg_temp.denied('update public.refunds set amount=1');
 perform pg_temp.denied('delete from public.refunds');
 perform pg_temp.denied('insert into public.audit_events(name) values(''tenant.created'')');
 perform pg_temp.denied('update public.audit_events set data=''{}''');
 perform pg_temp.denied('delete from public.audit_events');
end $$;
create function pg_temp.aggregates(expected_admin boolean) returns void language plpgsql as $$
declare rows_json text;
begin
 if not expected_admin then
  perform pg_temp.assert((select count(*) from public.platform_business_stats)=0,'nonadmin businesses');
  perform pg_temp.assert((select count(*) from public.platform_booking_stats)=0,'nonadmin bookings');
  perform pg_temp.assert((select count(*) from public.platform_economics)=0,'nonadmin economics');
  perform pg_temp.assert((select count(*) from public.platform_integration_health)=0,'nonadmin connections');return;
 end if;
 perform pg_temp.assert((select count(*) from public.platform_business_stats)>0,'admin businesses');
 perform pg_temp.assert((select sum(booking_count) from public.platform_booking_stats where month='2032-01-01')=2,'admin booking totals');
 perform pg_temp.assert((select merchant_gmv=1000 and refunded_amount=200 and subscription_revenue=0 and transaction_revenue=0 from public.platform_economics where month='2032-01-01' and currency='USD'),'USD separate economics');
 perform pg_temp.assert((select merchant_gmv=2000 and refunded_amount=300 and subscription_revenue=0 and transaction_revenue=0 from public.platform_economics where month='2032-01-01' and currency='EUR'),'EUR separate economics');
 select jsonb_agg(to_jsonb(e))::text into rows_json from public.platform_economics e;
 perform pg_temp.assert(position('PRIVATE-' in rows_json)=0,'no financial marker in aggregate');
 perform pg_temp.assert(not exists(select 1 from public.platform_economics e cross join lateral jsonb_object_keys(to_jsonb(e)) as k(value) where k.value not in ('month','currency','merchant_gmv','refunded_amount','subscription_revenue','transaction_revenue')),'aggregate column allowlist');
end $$;


set local role anon;
select pg_temp.denied('select * from public.payments');
select pg_temp.denied('select * from public.refunds');
select pg_temp.denied('select * from public.audit_events');
select pg_temp.no_writes();
reset role;
select set_config('request.jwt.claims','{"sub":"c1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads(null,0);
select pg_temp.no_writes();
select pg_temp.aggregates(true);
reset role;
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads('a1800000-0000-4000-8000-000000000001',1);
select pg_temp.no_writes();
select pg_temp.aggregates(false);
reset role;
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads('a1800000-0000-4000-8000-000000000001',0);
select pg_temp.no_writes();
select pg_temp.aggregates(false);
reset role;
select set_config('request.jwt.claims','{"sub":"b1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads('b1800000-0000-4000-8000-000000000001',1);
select pg_temp.aggregates(false);
reset role;
-- Platform+owner membership grants only A raw rows; analytics still span tenants.
select set_config('request.jwt.claims','{"sub":"d1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads('a1800000-0000-4000-8000-000000000001',1);
select pg_temp.no_writes();
select pg_temp.aggregates(true);
reset role;
-- Active predicate is deliberately scoped to the three new policies, not helpers.
update public.tenants set status='suspended' where id='a1800000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reads(null,0);
select pg_temp.aggregates(true);
reset role;
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads(null,0);
reset role;
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads(null,0);
reset role;
update public.tenants set status='inactive' where id='a1800000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reads(null,0);
reset role;
update public.tenants set status='active' where id='a1800000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.reads('a1800000-0000-4000-8000-000000000001',1);
reset role;
delete from public.tenant_members where user_id='a1800000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.reads(null,0);
select pg_temp.aggregates(false);
reset role;
-- Removing admin status must revoke aggregate scope even on an existing JWT.
delete from public.platform_admins where user_id='c1800000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"c1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads(null,0);
select pg_temp.aggregates(false);
reset role;
delete from public.platform_admins where user_id='d1800000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"d1800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reads('a1800000-0000-4000-8000-000000000001',1);
select pg_temp.aggregates(false);
reset role;
select pg_temp.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.payments'::regclass,'public.refunds'::regclass,'public.audit_events'::regclass)),'forced RLS preserved');
select pg_temp.assert((select reloptions @> array['security_invoker=false'] from pg_class where oid='public.platform_economics'::regclass),'definer aggregate preserved');
-- Service role still has intended ledger writes; audit remains append-only.
set local role service_role;
select pg_temp.assert((select count(*) from public.payments)=2,'service raw payments retained');
update public.payments set amount=amount where id='a1800000-0000-4000-8000-000000000005';
update public.refunds set amount=amount where tenant_id='a1800000-0000-4000-8000-000000000001';
insert into public.audit_events(tenant_id,name,data) values('a1800000-0000-4000-8000-000000000001','payment.succeeded','{"marker":"PRIVATE-SERVICE-AUDIT"}');
select pg_temp.denied('update public.audit_events set data=''{}''');
select pg_temp.denied('delete from public.audit_events');
reset role;
rollback;
\echo 'platform financial minimization tests PASS (fixtures rolled back)'
