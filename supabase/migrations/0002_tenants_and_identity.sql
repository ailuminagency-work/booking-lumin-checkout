-- ============================================================================
-- 0002_tenants_and_identity.sql
-- Tenants, tenant membership, platform admins (separate trust level, SI-9),
-- and tenant invitations. Every domain row in later migrations carries
-- tenant_id → tenants(id) ON DELETE CASCADE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tenants — one row per business. Mirrors Tenant in contracts/src/tenant.ts.
-- ----------------------------------------------------------------------------
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) >= 1),
  slug       text not null unique
             check (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and length(slug) >= 2),
  -- IANA timezone, e.g. 'America/Chicago'. Always explicit (contract).
  timezone   text not null check (length(timezone) >= 1),
  -- Default currency for new services; each service stores its own (contract).
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status     text not null default 'active'
             check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenants_status_idx on public.tenants (status);

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function lumin.touch_updated_at();

comment on table public.tenants is
  'One row per business. All domain tables FK here with ON DELETE CASCADE; RLS in 0007 makes this the isolation boundary (SI-4).';

-- ----------------------------------------------------------------------------
-- tenant_members — TenantRole from contracts: BUSINESS_OWNER | BUSINESS_STAFF.
-- Composite PK doubles as the unique(tenant_id, user_id) requirement.
-- ----------------------------------------------------------------------------
create table public.tenant_members (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('BUSINESS_OWNER', 'BUSINESS_STAFF')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index tenant_members_user_id_idx on public.tenant_members (user_id);

comment on table public.tenant_members is
  'Tenant-level roles (BUSINESS_OWNER, BUSINESS_STAFF). Deliberately disjoint from platform_admins — no role union (SI-9).';

-- ----------------------------------------------------------------------------
-- platform_admins — PlatformRole PLATFORM_ADMIN. A SEPARATE trust level:
-- a platform admin holds no implicit tenant role and vice versa (SI-9).
-- Rows are managed exclusively by the trusted server runtime (service_role).
-- ----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'PLATFORM_ADMIN allowlist for the Lumin Command Center. Never joined/unioned with tenant_members (SI-9). Writes: service_role only (0007).';

-- ----------------------------------------------------------------------------
-- tenant_invitations — owner invites a user by email. Only a HASH of the
-- invitation token is stored; the raw token exists once, in the email.
-- Acceptance (token verification + tenant_members insert) happens in the
-- trusted server runtime.
-- ----------------------------------------------------------------------------
create table public.tenant_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  role        text not null check (role in ('BUSINESS_OWNER', 'BUSINESS_STAFF')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  check (accepted_at is null or accepted_at >= created_at)
);

create index tenant_invitations_tenant_id_idx on public.tenant_invitations (tenant_id);
create index tenant_invitations_email_idx     on public.tenant_invitations (email);

comment on column public.tenant_invitations.token_hash is
  'sha256 (or better) hash of the invitation token. The raw token is never stored (SI-11).';
