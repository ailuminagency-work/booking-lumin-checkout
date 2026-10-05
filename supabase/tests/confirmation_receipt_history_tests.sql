-- Disposable local/CI PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- Caller must verify the actual disposable target and set lumin.disposable_test explicitly.
-- All synthetic data and state changes below roll back. No global cleanup.
\set ON_ERROR_STOP on
begin;
do $$
declare stamp_host text:=host(inet_server_addr()); stamp_port integer:=inet_server_port();
begin
 if current_setting('lumin.disposable_test',true) is distinct from 'confirmation_receipt_history' then
  raise exception 'DISPOSABLE_RECEIPT_HISTORY_TEST_REQUIRED';
 end if;
 if current_setting('lumin.disposable_host',true) is distinct from stamp_host
 or current_setting('lumin.disposable_port',true) is distinct from stamp_port::text
 or current_setting('lumin.disposable_database',true) is distinct from current_database()
 or current_user<>'postgres'
 or not (
  (stamp_host='127.0.0.1' and stamp_port=55463 and current_database() ~ '^lumin_confirmation_outbox_receipt_history_[a-z0-9_]+$')
  or (stamp_port=5432 and current_database()='lumin_confirmation_receipt_history_ci' and
   (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))
 ) then
  raise exception 'DISPOSABLE_RECEIPT_HISTORY_TARGET_REQUIRED';
 end if;
end$$;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'FAIL accepted forbidden operation';
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('66000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values(pg_temp.id(1),'receipt-owner@example.test'),(pg_temp.id(2),'receipt-platform@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(3),'Receipt history','receipt-history-test','UTC','USD'),
 (pg_temp.id(4),'Foreign history','receipt-history-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER');
insert into public.platform_admins(user_id) values(pg_temp.id(2));
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values
 (pg_temp.id(10),pg_temp.id(3),'HISTORY-EMAIL',pg_temp.id(10)::text,'{}','{}','2035-01-01T10:00Z','2035-01-01T11:00Z'),
 (pg_temp.id(11),pg_temp.id(3),'HISTORY-EMPTY',pg_temp.id(11)::text,'{}','{}','2035-01-02T10:00Z','2035-01-02T11:00Z'),
 (pg_temp.id(12),pg_temp.id(4),'HISTORY-FOREIGN',pg_temp.id(12)::text,'{}','{}','2035-01-03T10:00Z','2035-01-03T11:00Z');
-- Synthetic administrative fixtures model persisted first-recorded timestamps.
insert into public.confirmation_delivery_receipts(tenant_id,booking_id,channel,delivered_at) values
 (pg_temp.id(3),pg_temp.id(10),'email','2026-10-01T12:34:56.123456Z'),
 (pg_temp.id(4),pg_temp.id(12),'email','2026-10-02T01:02:03Z'),
 (pg_temp.id(4),pg_temp.id(12),'sms','2026-10-02T01:02:04Z');
create temp table receipts_before as select * from public.confirmation_delivery_receipts where tenant_id in(pg_temp.id(3),pg_temp.id(4));
create temp table bookings_before as select * from public.bookings where tenant_id in(pg_temp.id(3),pg_temp.id(4));
create temp table queue_before as select * from public.durable_outbox where tenant_id in(pg_temp.id(3),pg_temp.id(4));

select pg_temp.assert(prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog'],'stable definer with fixed search path')
 from pg_proc where oid='public.outbox_confirmation_receipt_history(uuid,uuid)'::regprocedure;
select pg_temp.assert(not has_function_privilege('anon','public.outbox_confirmation_receipt_history(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.outbox_confirmation_receipt_history(uuid,uuid)','execute')
 and has_function_privilege('service_role','public.outbox_confirmation_receipt_history(uuid,uuid)','execute'),'service-only function grant');
select pg_temp.assert(not exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a
 where p.oid='public.outbox_confirmation_receipt_history(uuid,uuid)'::regprocedure and a.grantee=0),'no PUBLIC grant');
create function pg_temp.browser_denials() returns void language plpgsql as $$begin
 perform pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10))','42501');
 perform pg_temp.reject('select * from public.confirmation_delivery_receipts','42501');
end$$;
set local role anon;select pg_temp.browser_denials();reset role;
select set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000001","role":"service_role"}',true);
set local role authenticated;select pg_temp.browser_denials();reset role;
select set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;select pg_temp.browser_denials();reset role;

set local role service_role;
select pg_temp.reject('select * from public.confirmation_delivery_receipts','42501');
select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(null,pg_temp.id(10))','22023');
select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(3),null)','22023');
select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(12))','P0002');
select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(4),pg_temp.id(10))','P0002');
select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(999),pg_temp.id(10))','P0002');
select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(999))','P0002');
select pg_temp.reject($q$select * from public.outbox_confirmation_receipt_history('forged-uuid',pg_temp.id(10))$q$,'22P02');
select pg_temp.reject($q$select * from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10),'push')$q$,'42883');
select pg_temp.assert(count(*)=0,'no receipt remains empty, not a generated timestamp') from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(11));
select pg_temp.assert(count(*)=1 and bool_and(channel='email' and recorded_at='2026-10-01T12:34:56.123456Z'),'one exact historical email timestamp') from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10));
select pg_temp.assert(array_agg(channel)=array['email','sms'] and count(*)=2,'bounded fixed channel order for exact other tenant') from public.outbox_confirmation_receipt_history(pg_temp.id(4),pg_temp.id(12));
select pg_temp.assert(bool_and((channel='email' and recorded_at='2026-10-02T01:02:03Z') or (channel='sms' and recorded_at='2026-10-02T01:02:04Z')),'both timestamps exact') from public.outbox_confirmation_receipt_history(pg_temp.id(4),pg_temp.id(12));
select pg_temp.assert((select count(*) from jsonb_object_keys(to_jsonb(h)))=2 and to_jsonb(h)?'channel' and to_jsonb(h)?'recorded_at','only channel and timestamp output') from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10)) h;
select pg_temp.assert(public.outbox_confirmation_delivered(pg_temp.id(3),pg_temp.id(10),'email') and not public.outbox_confirmation_delivered(pg_temp.id(3),pg_temp.id(10),'sms'),'existing boolean read unchanged');
reset role;
update public.tenants set status='suspended' where id=pg_temp.id(3);
set local role service_role;select pg_temp.reject('select * from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10))','P0002');reset role;
update public.tenants set status='active' where id=pg_temp.id(3);
-- A historical receipt remains readable even if the booking is no longer confirmed.
-- Current fixture is draft; no current-state inference is part of this history RPC.
select pg_temp.assert(count(*)=1,'history independent of current booking state') from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10));
select pg_temp.assert(not exists((select * from public.confirmation_delivery_receipts where tenant_id in(pg_temp.id(3),pg_temp.id(4)) except select * from receipts_before) union all (select * from receipts_before except select * from public.confirmation_delivery_receipts where tenant_id in(pg_temp.id(3),pg_temp.id(4)))),'receipt data unchanged');
select pg_temp.assert(not exists((select * from public.bookings where tenant_id in(pg_temp.id(3),pg_temp.id(4)) except select * from bookings_before) union all (select * from bookings_before except select * from public.bookings where tenant_id in(pg_temp.id(3),pg_temp.id(4)))),'booking data unchanged');
select pg_temp.assert(not exists((select * from public.durable_outbox where tenant_id in(pg_temp.id(3),pg_temp.id(4)) except select * from queue_before) union all (select * from queue_before except select * from public.durable_outbox where tenant_id in(pg_temp.id(3),pg_temp.id(4)))),'queue data unchanged');
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'receipt forced RLS retained') from pg_class where oid='public.confirmation_delivery_receipts'::regclass;
select pg_temp.assert(not has_table_privilege('service_role','public.confirmation_delivery_receipts','select,insert,update,delete') and not has_table_privilege('authenticated','public.confirmation_delivery_receipts','select,insert,update,delete') and not has_table_privilege('anon','public.confirmation_delivery_receipts','select,insert,update,delete'),'no raw ledger grant');
-- Read-only mode must permit the RPC. Leave it on until rollback: PostgreSQL
-- correctly refuses a transition back to read-write after a snapshot query.
set local transaction_read_only=on;
set local role service_role;
select pg_temp.assert(count(*)=1,'read-only snapshot compatible') from public.outbox_confirmation_receipt_history(pg_temp.id(3),pg_temp.id(10));
reset role;
rollback;
\echo 'confirmation receipt history tests PASS (fixtures rolled back)'
