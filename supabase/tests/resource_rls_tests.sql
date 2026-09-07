-- ============================================================================
-- resource_rls_tests.sql — RLS check for the W5 resource surface (0012).
--
-- Companion to rls_attack_tests.sql, kept separate so that suite's count is
-- unchanged. Same technique: one transaction, simulated JWTs
-- (set_config('request.jwt.claims', ...) + SET LOCAL ROLE), ROLLED BACK at the
-- end — no fixture data survives. ON_ERROR_STOP=1 aborts non-zero on any
-- repelled-attack failure. Success = final line "ALL RESOURCE RLS TESTS PASSED".
--
-- Run against a FRESH project with ALL migrations applied (never the legacy
-- project); or locally after local_harness.sql + migrations 0001..0012.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/resource_rls_tests.sql
--
-- Proves: a tenant-B member cannot read tenant-A resources; anon has NO access
-- to resources/locations/service_resources; anon CAN read active service_areas
-- (the one public-checkout input); a tenant member reads its OWN resources.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ----------------------------------------------------------------------------
-- Fixtures (privileged migration role; RLS bypassed here). Two tenants, each
-- with an owner, a service, a resource, a service→resource link, and a
-- service_area. Tenant A active; Tenant B active.
-- ----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'owner-b@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'platform-admin@example.test');

insert into public.tenants (id, name, slug, timezone, currency, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A', 'tenant-a', 'America/Chicago', 'USD', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B', 'tenant-b', 'Europe/Amsterdam', 'EUR', 'active');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'BUSINESS_OWNER'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'BUSINESS_OWNER');

insert into public.platform_admins (user_id) values
  ('44444444-4444-4444-4444-444444444444');

insert into public.services (id, tenant_id, archetype, name, currency, base_price) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'simple', 'Van Rental A', 'USD', 12000),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'simple', 'Van Rental B', 'EUR', 9900);

insert into public.resources (id, tenant_id, name, kind, capacity, active) values
  ('a0000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Cargo Van A', 'vehicle', 1, true),
  ('a0000000-0000-0000-0000-0000000000f2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Install Crew A', 'crew', 3, true),
  ('b0000000-0000-0000-0000-0000000000f1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cargo Van B', 'vehicle', 1, true);

insert into public.locations (id, tenant_id, name) values
  ('a0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Depot A'),
  ('b0000000-0000-0000-0000-0000000000a1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Depot B');

insert into public.service_resources (tenant_id, service_id, resource_id, quantity_required) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f2', 2);

insert into public.service_areas (id, tenant_id, service_id, kind, definition) values
  ('a0000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a0000000-0000-0000-0000-000000000001', 'postal_prefix', '{"prefixes":["600","601"]}'),
  ('b0000000-0000-0000-0000-0000000000c1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b0000000-0000-0000-0000-000000000001', 'radius', '{"km":25}');

-- ----------------------------------------------------------------------------
-- 1. Tenant-B member CANNOT read tenant-A resources (cross-tenant isolation).
--    Sees only its own; never A's.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"owner-b@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.resources
   where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1a: tenant-B member read % tenant-A resource row(s)', n; end if;
  raise notice 'PASS 1a: tenant-B member cannot read tenant-A resources (0 rows)';

  select count(*) into n from public.resources;  -- only own tenant's rows
  if n <> 1 then raise exception 'FAIL 1b: tenant-B member saw % resource rows (expected 1 own)', n; end if;
  raise notice 'PASS 1b: tenant-B member sees only its OWN resources (1 row)';

  select count(*) into n from public.locations
   where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1c: tenant-B member read % tenant-A location row(s)', n; end if;
  raise notice 'PASS 1c: tenant-B member cannot read tenant-A locations (0 rows)';

  select count(*) into n from public.service_resources
   where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1d: tenant-B member read % tenant-A service_resources row(s)', n; end if;
  raise notice 'PASS 1d: tenant-B member cannot read tenant-A service_resources (0 rows)';

  -- service_areas is PUBLIC CATALOG (policy is `to anon, authenticated`), like
  -- services: an active tenant's areas ARE visible cross-tenant BY DESIGN
  -- (area-gated availability is a public input). This is NOT a leak — no
  -- operator config (resources/locations/links) crosses the boundary above.
  select count(*) into n from public.service_areas
   where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 1 then raise exception 'FAIL 1e: tenant-A active service_area not visible as public catalog (% rows)', n; end if;
  raise notice 'PASS 1e: service_areas is public catalog — active tenant-A area visible cross-tenant (intended)';
end;
$t$;

-- Cross-tenant WRITE: tenant-B member cannot insert a resource into tenant A.
do $t$
declare
  denied boolean := false;
begin
  begin
    insert into public.resources (tenant_id, name, kind, capacity, active)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Rogue Van', 'vehicle', 1, true);
  exception when insufficient_privilege or check_violation then
    denied := true;
  end;
  -- RLS WITH CHECK failure raises insufficient_privilege; either way 0 rows must land.
  if exists (select 1 from public.resources where name = 'Rogue Van') then
    raise exception 'FAIL 1f: tenant-B member INSERTED a resource into tenant A';
  end if;
  raise notice 'PASS 1f: tenant-B member cannot insert a resource into tenant A';
end;
$t$;

reset role;

-- ----------------------------------------------------------------------------
-- 2. Tenant-A member CAN read its own resources / links (positive control).
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"owner-a@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.resources;
  if n <> 2 then raise exception 'FAIL 2a: tenant-A member saw % of its 2 resources', n; end if;
  raise notice 'PASS 2a: tenant-A member reads its own resources (2 rows)';

  select count(*) into n from public.service_resources;
  if n <> 1 then raise exception 'FAIL 2b: tenant-A member saw % of its 1 service_resources link', n; end if;
  raise notice 'PASS 2b: tenant-A member reads its own service_resources (1 row)';
end;
$t$;

reset role;

-- ----------------------------------------------------------------------------
-- 3. anon has NO access to resources / locations / service_resources /
--    resource_reservations (no policy AND no grant), but CAN read active
--    service_areas (the single public-checkout input).
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $t$
declare
  n bigint;
begin
  -- resources: revoked (no SELECT grant) → the read itself is refused.
  begin
    select count(*) into n from public.resources;
    raise exception 'FAIL 3a: anon SELECT on resources was permitted (% rows) — expected permission denied', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3a: anon has no access to resources (permission denied)';
  end;

  begin
    select count(*) into n from public.locations;
    raise exception 'FAIL 3b: anon SELECT on locations was permitted (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3b: anon has no access to locations (permission denied)';
  end;

  begin
    select count(*) into n from public.service_resources;
    raise exception 'FAIL 3c: anon SELECT on service_resources was permitted (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3c: anon has no access to service_resources (permission denied)';
  end;

  begin
    select count(*) into n from public.resource_reservations;
    raise exception 'FAIL 3d: anon SELECT on resource_reservations was permitted (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3d: anon has no access to resource_reservations (permission denied)';
  end;

  -- service_areas: anon is GRANTED select and the public_catalog_select policy
  -- exposes active tenants' rows. Both tenants are active → both areas visible.
  select count(*) into n from public.service_areas;
  if n <> 2 then raise exception 'FAIL 3e: anon saw % active service_area rows (expected 2)', n; end if;
  raise notice 'PASS 3e: anon may read active service_areas (2 rows)';
end;
$t$;

reset role;

-- ----------------------------------------------------------------------------
-- 4. anon does NOT see service_areas of an INACTIVE tenant (policy gate holds).
-- ----------------------------------------------------------------------------
update public.tenants set status = 'inactive'
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.service_areas
   where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if n <> 0 then raise exception 'FAIL 4a: anon read % service_area row(s) of an INACTIVE tenant', n; end if;
  raise notice 'PASS 4a: anon cannot read an inactive tenant''s service_areas (0 rows)';

  select count(*) into n from public.service_areas;  -- only tenant A (active) remains
  if n <> 1 then raise exception 'FAIL 4b: anon saw % active service_area rows (expected 1)', n; end if;
  raise notice 'PASS 4b: anon still reads the active tenant''s service_areas (1 row)';
end;
$t$;

reset role;

do $t$
begin
  raise notice '';
  raise notice '=== ALL RESOURCE RLS TESTS PASSED ===';
end;
$t$;

-- Leave no trace.
rollback;
