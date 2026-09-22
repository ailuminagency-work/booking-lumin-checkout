-- ============================================================================
-- 0032_business_profile.sql
-- One tenant → one activated business profile (P1 PROFILE-MISSING, Lane D).
--
-- ADDITIVE ONLY. Adds tenants.profile_key (NULL until activated) plus a
-- SECURITY DEFINER activation RPC that is:
--   (a) owner-gated  — only that tenant's BUSINESS_OWNER may activate;
--   (b) validated    — the profile value must be one of the six;
--   (c) SET-ONCE     — succeeds only while profile_key IS NULL. Once set it
--                      cannot be silently switched (raises).
--
-- RLS stays FORCED (0007 already force-enabled it on public.tenants) and no
-- policy is widened here. The RPC is the only authorized writer of profile_key
-- for a tenant member; it runs security definer and enforces ownership itself.
-- Mirrors the BusinessProfile contract in contracts/src/profile.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tenants.profile_key — the tenant's activated vertical, or NULL. The CHECK
-- keeps the column honest even against the definer path; the six values are
-- the BusinessProfile enum.
-- ----------------------------------------------------------------------------
alter table public.tenants
  add column profile_key text
    check (
      profile_key is null
      or profile_key in (
        'CLEANING', 'DETAILING', 'VEHICLE_RENTAL',
        'EQUIPMENT_RENTAL', 'JUNK_REMOVAL', 'EVENT_RENTAL'
      )
    );

comment on column public.tenants.profile_key is
  'Activated business profile (P1). NULL until lumin.activate_business_profile sets it; SET-ONCE thereafter. One tenant → one vertical lens.';

-- ----------------------------------------------------------------------------
-- lumin.activate_business_profile(p_tenant, p_profile)
-- Owner-gated, validated, SET-ONCE activation. Returns the activated key.
-- ----------------------------------------------------------------------------
create or replace function lumin.activate_business_profile(
  p_tenant  uuid,
  p_profile text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_updated integer;
begin
  -- (a) Only the tenant's BUSINESS_OWNER may activate. tenant_role() returns
  -- NULL for non-members and for a non-existent tenant, so this one gate also
  -- rejects staff, other tenants' members, and unknown tenant ids.
  if lumin.tenant_role(p_tenant) is distinct from 'BUSINESS_OWNER' then
    raise exception 'NOT_TENANT_OWNER' using errcode = '42501',
      detail = 'only the tenant BUSINESS_OWNER may activate a business profile';
  end if;

  -- (b) The profile value must be one of the six (defence in depth with the
  -- column CHECK; gives a clean contract error before the write).
  if p_profile is null or p_profile not in (
    'CLEANING', 'DETAILING', 'VEHICLE_RENTAL',
    'EQUIPMENT_RENTAL', 'JUNK_REMOVAL', 'EVENT_RENTAL'
  ) then
    raise exception 'INVALID_PROFILE' using errcode = '22023',
      detail = 'p_profile must be one of the six BusinessProfile keys';
  end if;

  -- (c) SET-ONCE: the UPDATE only matches while profile_key IS NULL. A tenant
  -- already carrying a profile matches zero rows → raise (no silent switch).
  update public.tenants
    set profile_key = p_profile
  where id = p_tenant
    and profile_key is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'PROFILE_ALREADY_ACTIVE' using errcode = '55000',
      detail = 'this tenant already has an activated business profile';
  end if;

  return p_profile;
end;
$fn$;

revoke all on function lumin.activate_business_profile(uuid, text) from public, anon;
grant execute on function lumin.activate_business_profile(uuid, text) to authenticated, service_role;

-- Thin wrapper in `public` so PostgREST exposes the RPC without adding the
-- whole `lumin` schema to the API (SECURITY INVOKER: the caller still needs —
-- and only `authenticated`/`service_role` have — EXECUTE on the lumin function).
create or replace function public.activate_business_profile(
  p_tenant  uuid,
  p_profile text
)
returns text
language sql
volatile
as $fn$
  select lumin.activate_business_profile(p_tenant, p_profile);
$fn$;

revoke all on function public.activate_business_profile(uuid, text) from public, anon;
grant execute on function public.activate_business_profile(uuid, text) to authenticated, service_role;
