-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- All synthetic records roll back.
--
-- Pins migration 0091 and the class of defect it fixed: the owner booking readers
-- authorize by calling lumin.flow_actor DIRECTLY in a service_role transaction, so
-- service_role must hold EXECUTE on it. It did not, and /api/bookings,
-- /api/bookings/detail and /api/bookings/cancel returned 403 from the day they
-- shipped. The unit tests could not catch that: they inject a fake pool that
-- answers any SQL containing 'flow_actor' with a row. This suite makes the real
-- grant and the real predicate a CI gate.
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
 select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
-- Calls the predicate exactly as the readers do and reports the SQLSTATE: '' when
-- it returned quietly, otherwise the code. Deliberately reports rather than
-- swallows, so a missing grant cannot be mistaken for a legitimate denial.
create function pg_temp.outcome(a uuid,t uuid,owner_only boolean) returns text language plpgsql as $$
begin
 perform lumin.flow_actor(a,t,owner_only);
 return '';
exception when others then
 return sqlstate;
end$$;
insert into auth.users(id,email) values
 (pg_temp.id(1),'owner@example.test'),
 (pg_temp.id(2),'staff@example.test'),
 (pg_temp.id(4),'stranger@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(3),'Owner auth','owner-booking-auth-test','UTC','USD'),
 (pg_temp.id(9),'Foreign','owner-booking-auth-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 (pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER'),
 (pg_temp.id(3),pg_temp.id(2),'BUSINESS_STAFF');

-- ---- The grant the readers depend on ----------------------------------------
select pg_temp.assert(has_function_privilege('service_role','lumin.flow_actor(uuid,uuid,boolean)','execute'),
 'service_role can EXECUTE lumin.flow_actor -- without this every owner booking route is 403');
select pg_temp.assert(not has_function_privilege('anon','lumin.flow_actor(uuid,uuid,boolean)','execute')
  and not has_function_privilege('authenticated','lumin.flow_actor(uuid,uuid,boolean)','execute'),
 'no client role can execute the authorization predicate');

-- ---- The predicate, exercised exactly as the readers call it ----------------
-- owner-bookings.ts list/detail pass p_owner_only=false (owner OR staff);
-- owner-booking-cancel.ts passes true (owner only). Both run as service_role.
set local role service_role;
-- flow_actor returns void: it either returns quietly or raises, so the outcome is
-- the SQLSTATE, not a value. '' means the authorization passed.
select pg_temp.assert(pg_temp.outcome(pg_temp.id(1),pg_temp.id(3),false)='','owner may list/detail');
select pg_temp.assert(pg_temp.outcome(pg_temp.id(2),pg_temp.id(3),false)='','staff may list/detail');
select pg_temp.assert(pg_temp.outcome(pg_temp.id(1),pg_temp.id(3),true)='','owner may cancel');
-- Denials must be 42501 specifically -- the code the readers map to FORBIDDEN.
-- Asserting the exact sqlstate is what distinguishes a real denial from the
-- 'permission denied for function' (also 42501 but a missing grant) and from the
-- 25006 read-only failure below; those are covered separately and explicitly.
select pg_temp.assert(pg_temp.outcome(pg_temp.id(2),pg_temp.id(3),true)='42501','staff may NOT cancel');
select pg_temp.assert(pg_temp.outcome(pg_temp.id(4),pg_temp.id(3),false)='42501','a stranger is refused');
select pg_temp.assert(pg_temp.outcome(pg_temp.id(1),pg_temp.id(9),false)='42501','a foreign tenant is refused');
reset role;

-- ---- The predicate needs a WRITE-CAPABLE transaction -----------------------
-- flow_actor takes FOR SHARE locks, so it CANNOT run in a read-only transaction.
-- owner-bookings.ts opened `repeatable read read only` and therefore failed with
-- 25006 even once the grant existed. Pin the incompatibility so the reader's
-- transaction mode can never quietly go back.
set local role service_role;
savepoint before_read_only;
set transaction read only;
select pg_temp.reject('select lumin.flow_actor(pg_temp.id(1),pg_temp.id(3),false)','25006');
rollback to savepoint before_read_only;
reset role;

-- ---- No client role may reach it, whatever its JWT claims ------------------
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.reject('select lumin.flow_actor(pg_temp.id(1),pg_temp.id(3),false)','42501');
reset role;
set local role anon;
select pg_temp.reject('select lumin.flow_actor(pg_temp.id(1),pg_temp.id(3),false)','42501');
reset role;

-- ---- Every lumin.* function the app calls DIRECTLY must be executable ------
-- The defect was a direct app -> lumin.* call with no grant. The repo convention is
-- that apps/api reaches internal helpers through public SECURITY DEFINER RPCs; the
-- owner booking readers are the exception, so the exception is pinned here. A NEW
-- direct call added to apps/api must be added to this list with its grant, or the
-- route it serves will 403 exactly as these did.
create temp table app_direct_lumin_calls(signature text primary key);
insert into app_direct_lumin_calls values ('lumin.flow_actor(uuid,uuid,boolean)');
select pg_temp.assert(bool_and(has_function_privilege('service_role',signature,'execute')),
  'service_role can execute every lumin.* function apps/api calls directly')
 from app_direct_lumin_calls;

rollback;
\echo 'owner booking authorization PASS (fixtures rolled back)'
