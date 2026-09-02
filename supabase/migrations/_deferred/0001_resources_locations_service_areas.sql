-- ============================================================================
-- DEFERRED — NOT part of the RC-1 applied migration set.
--
-- Files under supabase/migrations/_deferred/ are NOT applied by the runbook in
-- supabase/README.md. They hold domain surface that is designed but not yet
-- wired to any reader/writer in the product (no contract type, engine, view,
-- app screen, or RPC references these tables in RC-1). Keeping them out of the
-- applied set means a fresh project's schema contains only tables the product
-- actually uses (RC-1 acceptance finding DEF-1).
--
-- To promote one of these tables: move its DDL into the next numbered
-- migration, add tenant-scoped RLS (enable + FORCE + member policies) mirroring
-- the pattern in 0007_rls.sql, add a grant, wire a contract type + reader, and
-- extend supabase/tests/rls_attack_tests.sql to cover it.
--
--   resources     — capacity carriers (crew, bays, rooms, vehicles) for the
--                   rental archetype / resource-scheduled availability.
--   locations     — business locations; a future bookings.location_id FK.
--   service_areas — geographic service coverage (postal/radius/polygon) for
--                   mobile services and area-gated availability.
-- ============================================================================

create table public.resources (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (length(name) >= 1),
  kind       text not null default 'generic',
  capacity   integer not null default 1 check (capacity >= 1),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index resources_tenant_id_idx on public.resources (tenant_id);

create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (length(name) >= 1),
  address    jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  created_at timestamptz not null default now()
);

create index locations_tenant_id_idx on public.locations (tenant_id);

create table public.service_areas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  service_id uuid references public.services (id) on delete cascade,
  kind       text not null check (kind in ('postal_prefix', 'radius', 'polygon')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now()
);

create index service_areas_tenant_id_idx  on public.service_areas (tenant_id);
create index service_areas_service_id_idx on public.service_areas (service_id);
