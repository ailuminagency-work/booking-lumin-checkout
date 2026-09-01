-- ============================================================================
-- 0001_extensions_and_helpers.sql
-- Booking Lumin Checkout — clean-room schema, migration 1 of 8.
--
-- Target: a FRESH Supabase project (Postgres 15+). Never apply to any legacy
-- project. Provides extensions, the `lumin` helper schema, and the
-- SECURITY DEFINER helper functions used by every RLS policy.
--
-- Trust model (SI-9): platform admins and tenant members are DISTINCT trust
-- levels held in separate tables; the helpers below never union them.
-- ============================================================================

-- gen_random_uuid() is built into Postgres 13+; pgcrypto is kept for
-- gen_random_bytes()/digest() used by trusted server runtime (token hashing).
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Helper schema. Domain tables live in `public`; security helpers and RPCs
-- live in `lumin` so they are auditable in one place.
-- ----------------------------------------------------------------------------
create schema if not exists lumin;

grant usage on schema lumin to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- lumin.is_platform_admin()
-- True iff the calling JWT's user is a platform admin (Lumin Command Center).
--
-- SECURITY DEFINER + empty search_path: the body references only
-- schema-qualified objects, so a malicious search_path cannot hijack it.
-- The membership tables it reads are created in 0002; plpgsql bodies are not
-- resolved against the catalog until first execution, so ordering is safe.
--
-- Recursion safety under FORCE RLS: the RLS policies ON platform_admins and
-- tenant_members are written against auth.uid() only and never call these
-- helpers, so evaluating a policy that calls a helper terminates.
-- ----------------------------------------------------------------------------
create or replace function lumin.is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.is_tenant_member(t uuid)
-- True iff the calling JWT's user holds ANY role in tenant t.
-- ----------------------------------------------------------------------------
create or replace function lumin.is_tenant_member(t uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = t
      and tm.user_id = auth.uid()
  );
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.tenant_role(t uuid)
-- The calling user's role in tenant t ('BUSINESS_OWNER' | 'BUSINESS_STAFF'),
-- or NULL when not a member. NULL compares false everywhere it is used.
-- ----------------------------------------------------------------------------
create or replace function lumin.tenant_role(t uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_role text;
begin
  select tm.role
    into v_role
  from public.tenant_members tm
  where tm.tenant_id = t
    and tm.user_id = auth.uid();
  return v_role;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.tenant_is_active(t uuid)
-- True iff tenant t exists and is 'active'. Lets the anonymous checkout
-- catalog policies gate on tenant status WITHOUT granting anon any SELECT on
-- the tenants table itself (anon learns only an active/inactive boolean for a
-- uuid it already holds).
-- ----------------------------------------------------------------------------
create or replace function lumin.tenant_is_active(t uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return exists (
    select 1
    from public.tenants tn
    where tn.id = t
      and tn.status = 'active'
  );
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.touch_updated_at() — generic BEFORE UPDATE trigger keeping
-- updated_at current. No table access; SECURITY INVOKER is correct.
-- ----------------------------------------------------------------------------
create or replace function lumin.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- Function privileges. Postgres grants EXECUTE to PUBLIC by default —
-- explicitly revoke, then grant the minimum:
--   * membership/role helpers: authenticated + service_role only. anon has no
--     user identity, so these helpers are inappropriate for anon (they would
--     only ever return false/NULL, but least privilege says: no EXECUTE).
--   * tenant_is_active: anon needs it for the public catalog policies.
-- ----------------------------------------------------------------------------
revoke all on function lumin.is_platform_admin()      from public, anon;
revoke all on function lumin.is_tenant_member(uuid)   from public, anon;
revoke all on function lumin.tenant_role(uuid)        from public, anon;
revoke all on function lumin.tenant_is_active(uuid)   from public;
revoke all on function lumin.touch_updated_at()       from public, anon, authenticated;

grant execute on function lumin.is_platform_admin()    to authenticated, service_role;
grant execute on function lumin.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function lumin.tenant_role(uuid)      to authenticated, service_role;
grant execute on function lumin.tenant_is_active(uuid) to anon, authenticated, service_role;

comment on schema lumin is
  'Security helpers and trusted RPCs for Booking Lumin Checkout. All RLS policies route membership checks through this schema.';
