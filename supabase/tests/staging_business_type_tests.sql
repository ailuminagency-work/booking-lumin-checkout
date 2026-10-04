\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('45000000-0000-4000-8000-000000000001','business-owner@example.test'),('45000000-0000-4000-8000-000000000009','business-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('45000000-0000-4000-8000-000000000010','Uninitialized','business-uninitialized','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('45000000-0000-4000-8000-000000000010','45000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
create function pg_temp.create_business(t uuid default '45000000-0000-4000-8000-000000000002',a uuid default '45000000-0000-4000-8000-000000000001',n text default 'Housekeeping',s text default 'business-sql',z text default 'America/Los_Angeles',c text default 'USD',b text default 'HOUSEKEEPING',k text default 'business-attempt-0001') returns jsonb language sql as $$select public.create_staging_business(a,t,n,s,z,c,b,k)$$;
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.business_profiles'::regclass),'forced RLS');
select pg_temp.assert(not has_table_privilege('service_role','public.business_profiles','SELECT') and not has_table_privilege('service_role','public.business_profiles','INSERT') and not has_table_privilege('authenticated','public.business_profiles','UPDATE'),'direct grants closed');
select pg_temp.assert((select count(*)=2 from pg_proc where oid in('public.owner_business_profile(uuid,uuid)'::regprocedure,'public.create_staging_business(uuid,uuid,text,text,text,text,text,text)'::regprocedure) and prosecdef and proconfig=array['search_path=pg_catalog']),'fixed definer search paths');
select pg_temp.assert(not has_function_privilege('anon','public.create_staging_business(uuid,uuid,text,text,text,text,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.owner_business_profile(uuid,uuid)','EXECUTE'),'browser RPC denied');
set local role anon;select pg_temp.reject($q$select pg_temp.create_business()$q$,'42501');reset role;
set local role authenticated;select pg_temp.reject($q$select pg_temp.create_business()$q$,'42501');reset role;
select pg_temp.reject($q$select pg_temp.create_business(a=>'45000000-0000-4000-8000-000000000099')$q$,'42501');
select pg_temp.reject($q$select pg_temp.create_business(b=>'simple')$q$,'22023');select pg_temp.reject($q$select pg_temp.create_business(z=>'PST')$q$,'22023');select pg_temp.reject($q$select pg_temp.create_business(z=>'America/Fake')$q$,'22023');select pg_temp.reject($q$select pg_temp.create_business(c=>'usd')$q$,'22023');
select pg_temp.reject($q$select public.owner_business_profile('45000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000010')$q$,'P0002');
set local role service_role;
select pg_temp.assert(pg_temp.create_business()->>'tenantId'='45000000-0000-4000-8000-000000000002','atomic server business');
select pg_temp.assert(pg_temp.create_business(t=>'45000000-0000-4000-8000-000000000003')->>'tenantId'='45000000-0000-4000-8000-000000000002','same key exact replay ignores new server candidate');
select pg_temp.reject($q$select pg_temp.create_business(b=>'AUTO_DETAILING')$q$,'40001');
select pg_temp.reject($q$select pg_temp.create_business(t=>'45000000-0000-4000-8000-000000000003',k=>'business-attempt-0002')$q$,'23505');
select pg_temp.reject($q$select public.owner_business_profile('45000000-0000-4000-8000-000000000009','45000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.reject($q$select * from public.business_profiles$q$,'42501');
reset role;
select pg_temp.assert(not exists(select 1 from public.tenants where id='45000000-0000-4000-8000-000000000003') and (select count(*)=1 from public.business_profiles where creator_id='45000000-0000-4000-8000-000000000001'),'no duplicate/orphan on conflict');
select pg_temp.reject($q$update public.business_profiles set business_type='AUTO_DETAILING' where tenant_id='45000000-0000-4000-8000-000000000002'$q$,'55000');select pg_temp.reject($q$delete from public.business_profiles where tenant_id='45000000-0000-4000-8000-000000000002'$q$,'55000');
-- Force a mid-transaction membership failure; tenant insertion must roll back too.
create function pg_temp.fail_business_member() returns trigger language plpgsql as $$begin if new.tenant_id='45000000-0000-4000-8000-000000000004' then raise exception 'fixture member failure';end if;return new;end$$;
create trigger fixture_business_member before insert on public.tenant_members for each row execute function pg_temp.fail_business_member();
select pg_temp.reject($q$select pg_temp.create_business(t=>'45000000-0000-4000-8000-000000000004',s=>'business-sql-failed',k=>'business-attempt-0004')$q$,'P0001');
select pg_temp.assert(not exists(select 1 from public.tenants where id='45000000-0000-4000-8000-000000000004') and not exists(select 1 from public.tenant_members where tenant_id='45000000-0000-4000-8000-000000000004') and not exists(select 1 from public.business_profiles where tenant_id='45000000-0000-4000-8000-000000000004'),'atomic failure leaves no orphan');
drop trigger fixture_business_member on public.tenant_members;
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='45000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.create_business()$q$,'42501');select pg_temp.reject($q$select public.owner_business_profile('45000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000002')$q$,'42501');
update public.tenant_members set role='BUSINESS_OWNER' where tenant_id='45000000-0000-4000-8000-000000000002';update public.tenants set status='inactive' where id='45000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.create_business()$q$,'42501');
update public.tenants set status='active' where id='45000000-0000-4000-8000-000000000002';delete from public.tenant_members where tenant_id='45000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.create_business()$q$,'42501');
select pg_temp.assert((select count(*)=0 from public.services where tenant_id='45000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.bookings where tenant_id='45000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.payments where tenant_id='45000000-0000-4000-8000-000000000002'),'no catalog or financial writes');
rollback;
\echo PASS staging business type ACL/RLS/immutable/identity/replay/conflict/owner/atomic rollback/no financial attacks
