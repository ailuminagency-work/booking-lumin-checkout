-- 0091 owner booking authorization grant.
--
-- FIXES A SHIPPED DEFECT. apps/api/src/owner-bookings.ts (list, detail) and
-- owner-booking-cancel.ts authorize by opening a service_role transaction and
-- calling lumin.flow_actor(actor, tenant, owner_only) directly. service_role had
-- no EXECUTE on that function -- its ACL was postgres=X/postgres -- so every
-- request to /api/bookings, /api/bookings/detail and /api/bookings/cancel failed
-- with 42501 'permission denied for function flow_actor', which the readers map to
-- FORBIDDEN and the BFF returns as 403. The routes were unreachable from the day
-- they shipped, on staging as well as in production.
--
-- Why this was not caught: the unit tests inject a fake pool that answers any SQL
-- containing 'flow_actor' with a row, so they never exercise the grant; and no
-- integration harness covers these three readers against a real database.
-- supabase/tests/owner_booking_authorization_tests.sql now does, in CI.
--
-- Why granting direct EXECUTE is the right fix and not a widening of authority:
-- lumin.flow_actor is an authorization PREDICATE. It is SECURITY DEFINER, owned by
-- postgres, and it either returns the actor or raises FORBIDDEN when the actor is
-- not an active member of the active tenant (owner-only when asked). It mutates
-- nothing. service_role can already reach its exact effect through 54 public
-- SECURITY DEFINER RPCs that call it internally, and can already answer the same
-- question directly by selecting public.tenant_members, over which it holds full
-- grants. So this grant adds no capability service_role does not already have; it
-- only lets the trusted server runtime ask the question in one statement.
--
-- The actor id it is handed is never client-supplied: apps/api/src/main.ts derives
-- it from a verified Supabase JWT (createSupabaseIdentityVerifier) before any
-- reader runs, and the flow server re-validates its shape.
--
-- STRICTLY NARROW. One grant, on one predicate, to the trusted runtime role. anon
-- and authenticated are left with no execute, so no client can call it.
begin;

grant execute on function lumin.flow_actor(uuid, uuid, boolean) to service_role;

-- Fail closed if this ever regresses, or if a client role is granted it by mistake.
do $guard$
begin
  if not has_function_privilege('service_role', 'lumin.flow_actor(uuid,uuid,boolean)', 'execute') then
    raise exception 'OWNER_BOOKING_AUTHORIZATION_UNREACHABLE';
  end if;
  if has_function_privilege('anon', 'lumin.flow_actor(uuid,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'lumin.flow_actor(uuid,uuid,boolean)', 'execute') then
    raise exception 'OWNER_BOOKING_AUTHORIZATION_CLIENT_REACHABLE';
  end if;
end
$guard$;

comment on function lumin.flow_actor(uuid, uuid, boolean) is
 'Authorization predicate: returns the actor, or raises FORBIDDEN (42501) unless the actor is an active member of the active tenant -- owner-only when p_owner_only. Mutates nothing. EXECUTE is granted to service_role because apps/api owner readers call it directly to authorize before a tenant-scoped SELECT (see migration 0091); anon and authenticated must never hold EXECUTE.';

commit;
