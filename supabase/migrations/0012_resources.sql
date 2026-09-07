-- ============================================================================
-- 0012_resources.sql — PROMOTE the deferred resource surface (W5).
--
-- Forward-only migration (Postgres 16 / Supabase). Does NOT edit 0001-0011.
--
-- These tables were designed in migrations/_deferred/0001_resources_..sql and
-- held out of the applied set (RC-1 finding DEF-1) because no reader/writer
-- referenced them. They now have one: the `@lumin/resources` package models
-- resource availability, `service_resources` wires services to the resources
-- they require, and `lumin.reserve_resource` (below) is a DB-authoritative
-- writer that composes with the W6 capacity holds (0010) — same advisory-lock
-- serialization, same fail-closed posture.
--
-- CHARTER (do not overbuild): a resource is either an EXCLUSIVE unit (a vehicle,
-- a trailer, a room — capacity 1) or POOLED capacity (a crew of N — capacity N).
-- `resources.capacity` carries N; exclusivity is just capacity = 1. There is no
-- ERP/inventory here — only "how many of THIS resource can a slot consume".
--
-- Additive schema:
--   resources             — capacity carriers (crew, bays, rooms, vehicles)
--   locations             — business locations (future bookings.location_id)
--   service_areas         — geographic coverage (postal/radius/polygon)
--   service_resources     — link: a service requires N of a resource (NEW)
--   resource_reservations — per-(booking,resource) holds, server-internal (NEW)
--
-- RLS: enable + FORCE on ALL five. resources/locations/service_areas/
-- service_resources mirror 0007 §4 (member SELECT/INSERT/UPDATE, owner DELETE,
-- platform-admin SELECT); service_areas ALSO gets the anon public-catalog
-- SELECT (area-gated availability is a public-checkout input, mirroring
-- availability_rules). resource_reservations is server-internal like
-- capacity_holds: enable+force, NO client policies, NO client grants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables — resources / locations / service_areas keep the exact columns
--    from _deferred/0001; service_resources + resource_reservations are new.
-- ----------------------------------------------------------------------------
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

-- service_resources — a service REQUIRES `quantity_required` units of a
-- resource. (service_id, resource_id) is unique so a requirement is stated once.
-- tenant_id is denormalized onto the link (as everywhere else) so RLS never has
-- to join to prove ownership; both FKs must belong to the same tenant, which the
-- member policies below enforce via the FK targets' own tenant scoping.
create table public.service_resources (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  service_id        uuid not null references public.services (id) on delete cascade,
  resource_id       uuid not null references public.resources (id) on delete cascade,
  quantity_required integer not null default 1 check (quantity_required >= 1),
  created_at        timestamptz not null default now(),
  unique (service_id, resource_id)
);

create index service_resources_tenant_id_idx   on public.service_resources (tenant_id);
create index service_resources_service_id_idx  on public.service_resources (service_id);
create index service_resources_resource_id_idx on public.service_resources (resource_id);

-- resource_reservations — one hold per (booking, resource). The DB-authoritative
-- analogue of capacity_holds (0010) for exclusive/pooled RESOURCES. status:
--   held     → reserved, counts against the resource's capacity until expiry
--   consumed → booking confirmed; the unit is locked in for it
--   released → checkout failed/cancelled; the unit returns to the pool
--   expired  → TTL elapsed without confirm; treated as non-consuming
-- A booking may hold several DISTINCT resources, so the anchor is
-- (booking_id, resource_id) — NOT booking_id alone (that is capacity_holds).
create table public.resource_reservations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  resource_id uuid not null references public.resources (id) on delete cascade,
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  slot_start  timestamptz not null,
  slot_end    timestamptz not null,
  -- Opaque server-minted token (audit / correlation); never a secret.
  hold_key    text not null,
  status      text not null default 'held'
              check (status in ('held', 'consumed', 'released', 'expired')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (booking_id, resource_id),
  check (slot_end > slot_start)
);

-- Reservation lookup path: (tenant, resource, slot_start) — the tuple the
-- advisory lock serializes on. Plus tenant_id + FK indexes per convention.
create index resource_reservations_lookup_idx
  on public.resource_reservations (tenant_id, resource_id, slot_start);
create index resource_reservations_resource_id_idx
  on public.resource_reservations (resource_id);
create index resource_reservations_booking_id_idx
  on public.resource_reservations (booking_id);

-- ----------------------------------------------------------------------------
-- 2. Enable + FORCE RLS on every new table (deny-by-default, SI-4).
-- ----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array[
    'resources', 'locations', 'service_areas',
    'service_resources', 'resource_reservations'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$do$;

-- ----------------------------------------------------------------------------
-- 3. Table privileges. Start from zero for the API roles (undo Supabase's
--    permissive defaults on these freshly-created tables), then grant the
--    minimum — mirroring 0007 §2. RLS decides WHICH rows; grants decide WHICH
--    verbs are reachable at all.
-- ----------------------------------------------------------------------------
revoke all on
  public.resources, public.locations, public.service_areas,
  public.service_resources, public.resource_reservations
from anon, authenticated;

grant all on
  public.resources, public.locations, public.service_areas,
  public.service_resources, public.resource_reservations
to service_role;

-- Member-managed catalog tables: members read/write (policies scope the rows).
grant select, insert, update, delete on
  public.resources, public.locations, public.service_areas,
  public.service_resources
to authenticated;

-- Public checkout (anon): service_areas ONLY — area-gated availability is a
-- public-checkout input. NO anon access to resources/locations/
-- service_resources (internal ops config) or resource_reservations (holds).
grant select on public.service_areas to anon;

-- resource_reservations: NO anon/authenticated grants — server-internal holds,
-- exactly like capacity_holds. Only service_role (BYPASSRLS) and the definer
-- RPC below touch it. Combined with the zero policies in §4, unreachable from
-- any client role twice over.

-- ----------------------------------------------------------------------------
-- 4. Standard tenant-owned tables: member SELECT/INSERT/UPDATE, owner DELETE,
--    platform-admin SELECT — identical shape to 0007 §4.
-- ----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array[
    'resources', 'locations', 'service_areas', 'service_resources'
  ]
  loop
    execute format($pol$
      create policy "member_or_admin_select" on public.%I
        for select to authenticated
        using (lumin.is_tenant_member(tenant_id) or lumin.is_platform_admin())
    $pol$, t);

    execute format($pol$
      create policy "member_insert" on public.%I
        for insert to authenticated
        with check (lumin.is_tenant_member(tenant_id))
    $pol$, t);

    execute format($pol$
      create policy "member_update" on public.%I
        for update to authenticated
        using (lumin.is_tenant_member(tenant_id))
        with check (lumin.is_tenant_member(tenant_id))
    $pol$, t);

    execute format($pol$
      create policy "owner_delete" on public.%I
        for delete to authenticated
        using (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
    $pol$, t);
  end loop;
end;
$do$;

-- resource_reservations: NO POLICIES AT ALL. RLS is forced, so even if a grant
-- ever leaked, anon/authenticated would still see zero rows and write nothing.
-- Only service_role (BYPASSRLS) and the definer RPCs reach it (SI-5-style).

-- ----------------------------------------------------------------------------
-- 5. PUBLIC CHECKOUT (anon) — service_areas only. Area-gated availability of
--    ACTIVE tenants/services, mirroring the availability_rules anon policy in
--    0007 §7. resources/locations/service_resources get NO anon policy (and no
--    anon grant): the public checkout never needs the operator's resource roster
--    or internal service→resource wiring, only whether it serves an address.
-- ----------------------------------------------------------------------------
create policy "public_catalog_select" on public.service_areas
  for select to anon, authenticated
  using (
    lumin.tenant_is_active(tenant_id)
    and (service_id is null or exists (
      select 1 from public.services s where s.id = service_id and s.active
    ))
  );

-- ============================================================================
-- 6. lumin.reserve_resource — ATOMIC, DB-authoritative RESOURCE reservation.
--
-- The resource analogue of lumin.reserve_capacity (0010), and additive to it —
-- reserve_capacity is NOT modified. Serializes concurrent reservations for THIS
-- (tenant, resource, slot) with a TRANSACTION-SCOPED advisory lock, counts the
-- resource's current consumers under the lock, and inserts (or reactivates) a
-- 'held' reservation ONLY when consumers < the resource's capacity. Returns
-- 'GRANTED' with the reservation, or 'NO_CAPACITY' with nulls.
--
-- Capacity is READ FROM the resources row (single source of truth): an exclusive
-- unit is simply capacity = 1, a pooled crew is capacity = N — one code path.
--
-- CONSUMER COUNT (excludes THIS booking's own row for the resource) — a resource
-- consumer is a reservation for the SAME resource that OVERLAPS the slot and is:
--   * status 'held'     AND not yet expired (an in-flight hold), OR
--   * status 'consumed' (a confirmed booking's locked-in unit).
-- 'released' and 'expired' reservations never count (a unit returns to the pool
-- on release, and an expired hold is non-consuming) — the SAME active/non-expired
-- semantics W6 uses for capacity_holds, so the two engines compose cleanly.
--
-- IDEMPOTENT on (p_booking_id, p_resource_id): re-reserving returns the existing
-- live/consumed reservation; an expired/released row is re-evaluated against
-- capacity and reactivated in place (the (booking,resource) key is UNIQUE).
--
-- SECURITY DEFINER (owner postgres, BYPASSRLS), search_path pinned to ''.
-- ============================================================================
create or replace function lumin.reserve_resource(
  p_tenant_id   uuid,
  p_resource_id uuid,
  p_slot_start  timestamptz,
  p_slot_end    timestamptz,
  p_booking_id  uuid,
  p_ttl         interval
)
returns table (result text, reservation_id uuid, reservation_status text, reservation_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_capacity    integer;
  v_active      boolean;
  v_res_id      uuid;
  v_res_status  text;
  v_expires     timestamptz;
  v_consumers   integer;
begin
  if p_slot_start is null or p_slot_end is null or p_slot_end <= p_slot_start then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001',
      detail = 'slot_end must be after slot_start';
  end if;

  -- Resource must exist, belong to the tenant, and be active. Capacity is the
  -- authority (exclusive = 1, pooled = N). Fail closed on a missing/foreign/
  -- inactive resource (SI-7).
  select r.capacity, r.active
    into v_capacity, v_active
  from public.resources r
  where r.id = p_resource_id and r.tenant_id = p_tenant_id;

  if not found or v_active is not true then
    result := 'NO_CAPACITY'; reservation_id := null; reservation_status := null; reservation_expires_at := null;
    return next; return;
  end if;

  -- Serialize every concurrent reservation for THIS (tenant, resource, slot).
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id::text || ':' || p_resource_id::text || ':' || p_slot_start::text,
      0
    )
  );

  -- Idempotency: does this booking already hold a row for this resource?
  select rr.id, rr.status, rr.expires_at
    into v_res_id, v_res_status, v_expires
  from public.resource_reservations rr
  where rr.booking_id = p_booking_id and rr.resource_id = p_resource_id;

  if found then
    if v_res_status = 'held' and v_expires > now() then
      result := 'GRANTED'; reservation_id := v_res_id; reservation_status := 'held'; reservation_expires_at := v_expires;
      return next; return;
    elsif v_res_status = 'consumed' then
      result := 'GRANTED'; reservation_id := v_res_id; reservation_status := 'consumed'; reservation_expires_at := v_expires;
      return next; return;
    end if;
    -- else 'released' / 'expired' (or a held row past its TTL): fall through,
    -- re-evaluate capacity, and reactivate the row in place.
  end if;

  -- Count consumers OTHER than this booking for this resource + slot.
  select count(*)
    into v_consumers
  from public.resource_reservations rr
  where rr.tenant_id  = p_tenant_id
    and rr.resource_id = p_resource_id
    and rr.booking_id <> p_booking_id
    and (
      (rr.status = 'held' and rr.expires_at > now())
      or rr.status = 'consumed'
    )
    and rr.slot_start < p_slot_end
    and rr.slot_end   > p_slot_start;

  if v_consumers >= v_capacity then
    result := 'NO_CAPACITY'; reservation_id := null; reservation_status := null; reservation_expires_at := null;
    return next; return;
  end if;

  if v_res_id is not null then
    -- Reactivate the booking's existing (expired/released) row in place.
    update public.resource_reservations
      set status     = 'held',
          slot_start = p_slot_start,
          slot_end   = p_slot_end,
          hold_key   = encode(public.gen_random_bytes(16), 'hex'),
          expires_at = now() + p_ttl
      where id = v_res_id
      returning id, status, expires_at into v_res_id, v_res_status, v_expires;
  else
    insert into public.resource_reservations
      (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
    values
      (p_tenant_id, p_resource_id, p_booking_id, p_slot_start, p_slot_end,
       encode(public.gen_random_bytes(16), 'hex'), 'held', now() + p_ttl)
    returning id, status, expires_at into v_res_id, v_res_status, v_expires;
  end if;

  result := 'GRANTED'; reservation_id := v_res_id; reservation_status := v_res_status; reservation_expires_at := v_expires;
  return next; return;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.consume_resource_holds — held → consumed for ALL of a booking's live
-- resource reservations (called on confirm). Returns the number consumed.
-- ----------------------------------------------------------------------------
create or replace function lumin.consume_resource_holds(p_booking_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.resource_reservations
    set status = 'consumed'
    where booking_id = p_booking_id
      and status = 'held'
      and expires_at > now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.release_resource_holds — held → released for ALL of a booking's holds
-- (called on payment failure/cancel; units return to the pool immediately).
-- Returns the number released.
-- ----------------------------------------------------------------------------
create or replace function lumin.release_resource_holds(p_booking_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.resource_reservations
    set status = 'released'
    where booking_id = p_booking_id
      and status = 'held';
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- Function privileges: definer-only. anon/authenticated get NO execute
-- (reservations are server-internal); the trusted runtime calls these as
-- service_role via the public wrappers below.
-- ----------------------------------------------------------------------------
revoke all on function lumin.reserve_resource(uuid, uuid, timestamptz, timestamptz, uuid, interval)
  from public, anon, authenticated;
revoke all on function lumin.consume_resource_holds(uuid) from public, anon, authenticated;
revoke all on function lumin.release_resource_holds(uuid) from public, anon, authenticated;

grant execute on function lumin.reserve_resource(uuid, uuid, timestamptz, timestamptz, uuid, interval)
  to service_role;
grant execute on function lumin.consume_resource_holds(uuid) to service_role;
grant execute on function lumin.release_resource_holds(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Thin public wrappers so PostgREST exposes the RPCs to the edge functions
-- (supabase-js .rpc() targets `public`). SECURITY INVOKER: the caller
-- (service_role) still needs — and has — EXECUTE on the lumin function. No
-- anon/authenticated grants: unreachable from any client role.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_resource(
  p_tenant_id   uuid,
  p_resource_id uuid,
  p_slot_start  timestamptz,
  p_slot_end    timestamptz,
  p_booking_id  uuid,
  p_ttl         interval
)
returns table (result text, reservation_id uuid, reservation_status text, expires_at timestamptz)
language sql
volatile
as $fn$
  select * from lumin.reserve_resource(
    p_tenant_id, p_resource_id, p_slot_start, p_slot_end, p_booking_id, p_ttl
  );
$fn$;

create or replace function public.consume_resource_holds(p_booking_id uuid)
returns integer language sql volatile as $fn$
  select lumin.consume_resource_holds(p_booking_id);
$fn$;

create or replace function public.release_resource_holds(p_booking_id uuid)
returns integer language sql volatile as $fn$
  select lumin.release_resource_holds(p_booking_id);
$fn$;

revoke all on function public.reserve_resource(uuid, uuid, timestamptz, timestamptz, uuid, interval)
  from public, anon, authenticated;
revoke all on function public.consume_resource_holds(uuid) from public, anon, authenticated;
revoke all on function public.release_resource_holds(uuid) from public, anon, authenticated;

grant execute on function public.reserve_resource(uuid, uuid, timestamptz, timestamptz, uuid, interval)
  to service_role;
grant execute on function public.consume_resource_holds(uuid) to service_role;
grant execute on function public.release_resource_holds(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Comments.
-- ----------------------------------------------------------------------------
comment on table public.resources is
  'Capacity carriers (crew, bays, rooms, vehicles, trailers). EXCLUSIVE unit = capacity 1; POOLED = capacity N. Promoted from _deferred in 0012 (W5).';
comment on table public.service_resources is
  'Link: a service REQUIRES quantity_required units of a resource. (service_id, resource_id) unique.';
comment on table public.resource_reservations is
  'DB-authoritative resource holds (W5). One per (booking, resource); reserved atomically under a (tenant,resource,slot) advisory lock by lumin.reserve_resource. Composes with capacity_holds (W6). Server-internal: RLS forced, no client policies/grants.';
