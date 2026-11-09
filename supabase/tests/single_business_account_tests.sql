-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- All synthetic records roll back.
--
-- The charter's section 22 gate: prove the SINGLE-BUSINESS ACCOUNT INVARIANT before
-- production. One Booking Lumin account belongs to exactly ONE business; there is no
-- business switcher and no cross-business workspace. Someone who owns two businesses
-- holds two accounts.
--
-- 0092 enforces this with a BEFORE trigger on public.tenant_members, because a unique
-- index cannot be applied while historical violating rows exist. This suite is what
-- keeps the rule honest: it proves the refusal fires on EVERY write path, that it is a
-- refusal and not a silent drop, and that platform-admin isolation is not the mechanism.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'FAIL accepted forbidden operation: %',statement;
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('93000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values
 (pg_temp.id(1),'one-business@example.test'),
 (pg_temp.id(2),'other-account@example.test'),
 (pg_temp.id(3),'admin@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(10),'Business A','single-business-a','UTC','USD'),
 (pg_temp.id(20),'Business B','single-business-b','UTC','USD'),
 (pg_temp.id(30),'Business C','single-business-c','UTC','USD');

-- ---- The enforcement exists and is a BEFORE trigger on the membership table -----
select pg_temp.assert(count(*)=1,'single-business trigger is installed')
 from pg_trigger where tgrelid='public.tenant_members'::regclass
   and tgname='tenant_members_single_business' and not tgisinternal;
select pg_temp.assert(p.prosecdef and p.proconfig=array['search_path=pg_catalog'],'enforcement is definer with a pinned search_path')
 from pg_proc p where p.oid='lumin.enforce_single_business_membership()'::regprocedure;

-- ---- An account resolves to exactly one business --------------------------------
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(10),pg_temp.id(1),'BUSINESS_OWNER');
select pg_temp.assert((select count(*)=1 from public.tenant_members where user_id=pg_temp.id(1)),'the account has exactly one business');

-- ---- A SECOND business is refused, on every path -------------------------------
-- Direct insert, the path a compromised or careless server write would take.
select pg_temp.reject($q$insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(20),pg_temp.id(1),'BUSINESS_OWNER')$q$,'42501');
-- As BUSINESS_STAFF too: the invariant is about the ACCOUNT, not the role. Someone
-- cleaning for two companies needs two accounts.
select pg_temp.reject($q$insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(20),pg_temp.id(1),'BUSINESS_STAFF')$q$,'42501');
-- Moving an existing membership to another business is the same breach by UPDATE.
select pg_temp.reject($q$insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(20),pg_temp.id(2),'BUSINESS_OWNER');update public.tenant_members set user_id=pg_temp.id(1) where tenant_id=pg_temp.id(20)$q$,'42501');
-- The business-creation RPC inherits the refusal without needing its own guard.
set local role service_role;
-- A FRESH tenant id, so the refusal can only be the invariant: reusing an existing
-- id would fail on tenants_pkey first and this would assert nothing.
select pg_temp.reject($q$select public.create_staging_business(pg_temp.id(1),pg_temp.id(40),'Second','single-business-second','UTC','USD','HOUSEKEEPING','single-business-key-0001')$q$,'42501');
reset role;
-- ...and the refused create left nothing behind: the tenant insert rolled back with it.
select pg_temp.assert(not exists(select 1 from public.tenants where id=pg_temp.id(40)),'a refused second business creates no tenant row');
select pg_temp.assert((select count(*)=1 from public.tenant_members where user_id=pg_temp.id(1)),'the account still has exactly one business');

-- ---- What must still work ------------------------------------------------------
-- A different account may own a different business: isolation, not scarcity.
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(20),pg_temp.id(2),'BUSINESS_OWNER');
select pg_temp.assert((select count(*)=2 from public.tenant_members),'two accounts, two businesses');
-- A role change inside the SAME business is untouched: the trigger fires only on the
-- columns that can move an account between businesses.
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=pg_temp.id(10) and user_id=pg_temp.id(1);
select pg_temp.assert((select role='BUSINESS_STAFF' from public.tenant_members where user_id=pg_temp.id(1)),'a role change within one business still works');
update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=pg_temp.id(10) and user_id=pg_temp.id(1);

-- ---- Platform-admin isolation is NOT the mechanism and is not weakened ---------
-- An admin's reach comes from lumin.is_platform_admin(), never from membership, so
-- being an admin neither grants nor requires a membership -- and never exempts an
-- account from the invariant.
insert into public.platform_admins(user_id) values(pg_temp.id(3));
select pg_temp.assert((select count(*)=0 from public.tenant_members where user_id=pg_temp.id(3)),'an admin needs no business membership');
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(30),pg_temp.id(3),'BUSINESS_OWNER');
select pg_temp.reject($q$insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(10),pg_temp.id(3),'BUSINESS_OWNER')$q$,'42501');
select pg_temp.assert((select count(*)=1 from public.tenant_members where user_id=pg_temp.id(3)),'an admin account is bound by the invariant too');

-- ---- The remaining-violations view, used to decide when the index can land -----
select pg_temp.assert((select count(*)=0 from public.accounts_in_multiple_businesses),'no violations among rows written under the trigger');
select pg_temp.assert(not bool_or(has_table_privilege(r,'public.accounts_in_multiple_businesses',v)),
  'no client role may read which accounts span businesses')
 from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) v;
select pg_temp.assert(has_table_privilege('service_role','public.accounts_in_multiple_businesses','select'),'service_role may read the remediation view');

rollback;
\echo 'single-business account invariant PASS (fixtures rolled back)'
