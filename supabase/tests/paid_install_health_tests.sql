\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
select pg_temp.assert(not has_function_privilege('anon','public.owner_paid_install_health(uuid,uuid,uuid)','EXECUTE'),'anon RPC denied');
select pg_temp.assert(not has_function_privilege('authenticated','public.owner_paid_install_health(uuid,uuid,uuid)','EXECUTE'),'authenticated RPC denied');
select pg_temp.assert(has_function_privilege('service_role','public.owner_paid_install_health(uuid,uuid,uuid)','EXECUTE'),'server RPC only');
select pg_temp.assert((select prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid='public.owner_paid_install_health(uuid,uuid,uuid)'::regprocedure),'fixed definer path');
select pg_temp.assert(not has_table_privilege('service_role','public.flow_sessions','SELECT') and not has_table_privilege('service_role','public.flow_requests','SELECT') and not has_table_privilege('service_role','public.bound_flow_versions','SELECT'),'private grants closed');
select pg_temp.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('public.flow_sessions'::regclass,'public.flow_requests'::regclass,'public.bound_flow_versions'::regclass)),'forced RLS preserved');
insert into auth.users(id,email) values('48000000-0000-4000-8000-000000000001','health-sql-owner@example.test'),('48000000-0000-4000-8000-000000000009','health-sql-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('48000000-0000-4000-8000-000000000002','Health','health-sql','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('48000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
select pg_temp.reject($q$select public.owner_paid_install_health('48000000-0000-4000-8000-000000000009','48000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000003')$q$,'42501');
select pg_temp.reject($q$select public.owner_paid_install_health('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000003')$q$,'P0002');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('48000000-0000-4000-8000-000000000005','48000000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
select public.publish_paid_simple_flow('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000003','48000000-0000-4000-8000-000000000005','Health','48000000-0000-4000-8000-000000000004','48000000-0000-4000-8000-000000000006','["https://checkout.example.test"]');
create temp table evidence as select public.owner_paid_install_health('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000003') value;
select pg_temp.assert((select value->>'catalogStatus'='available' and value->'issuedSessionCount'='0' and value->'confirmedStagingBookingCount'='0' and value->'lastConfirmedStagingBookingAt'='null' from evidence),'no fabricated customer evidence');
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='48000000-0000-4000-8000-000000000002';
select pg_temp.reject($q$select public.owner_paid_install_health('48000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000003')$q$,'42501');
select pg_temp.assert(not exists(select 1 from public.bookings) and not exists(select 1 from public.payments) and not exists(select 1 from public.capacity_holds) and not exists(select 1 from public.flow_sessions),'no customer financial writes');
rollback;
\echo PASS paid install health fixed ACL/owner/private RLS/missing evidence/no customer writes
