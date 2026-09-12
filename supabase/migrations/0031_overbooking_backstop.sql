-- ============================================================================
-- 0031_overbooking_backstop.sql — P0 OB-STRUCT structural overbooking backstop.
--
-- Forward-only migration (Postgres 16 / Supabase). Does NOT edit 0001-0030.
--
-- THE AUDIT FINDING (P0 OB-STRUCT — overbooking not structurally prevented):
-- the reserve RPC path serializes correctly under concurrency, BUT there was no
-- DB-level exclusion constraint behind it. Two overlapping ACTIVE
-- resource_reservations on ONE exclusive (capacity-1) resource were NOT
-- structurally prevented — a direct SQL insert (or any writer that bypasses
-- lumin.reserve_resource / reserve_resource_quantity) could double-book an
-- exclusive unit. The existing `unique (booking_id, resource_id)` only stops a
-- booking from holding the SAME resource twice; it says nothing about TWO
-- bookings holding the same exclusive unit over the same time.
--
-- THE FIX (defense-in-depth, caller-independent): a btree_gist EXCLUDE
-- constraint that makes two overlapping ACTIVE reservations on one EXCLUSIVE
-- resource structurally impossible, evaluated by the storage engine on every
-- write regardless of role or code path. Additive only — the reserve_resource /
-- reserve_resource_quantity / consume/release RPCs (0010/0012/0020) are NOT
-- modified, and the legitimate hold -> consume -> confirm path still succeeds.
--
-- EXCLUSIVITY MODEL (0012 charter): a resource is EXCLUSIVE when capacity = 1
-- (a vehicle, a trailer, a room) and POOLED when capacity = N > 1 (a crew of N).
-- `resources.kind` is a descriptive label ('generic'/'vehicle'/'crew'/...), NOT
-- the exclusivity authority — capacity is. So the EXCLUDE must fire ONLY for
-- capacity-1 resources; a pooled resource must still allow N concurrent
-- overlapping reservations (reserve_resource_quantity enforces the N ceiling).
--
-- WHY A DENORMALIZED FLAG + FORCING TRIGGER (not a subquery in the predicate):
-- an EXCLUDE constraint predicate must be IMMUTABLE and self-contained — it
-- cannot join to public.resources to learn capacity. So we denormalize an
-- `is_exclusive boolean` onto resource_reservations and FORCE it from the
-- resource's capacity in a BEFORE INSERT/UPDATE trigger that OVERWRITES any
-- client-supplied value. A direct insert cannot lie about exclusivity: whatever
-- is_exclusive it supplies is discarded and recomputed from the resource.
--
-- RLS: unchanged. resource_reservations stays enable+FORCE with NO client
-- policies and NO client grants (server-internal, exactly as 0012 left it).
-- The new column, trigger and constraint add no grant and loosen none.
--
-- SECONDARY (capacity-slot bookings backstop) — DEFERRED as R1b, see the NOTE
-- at the foot of this file.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. btree_gist — gist support for the '=' operator on scalar types (uuid), so
--    a single gist EXCLUDE index can mix `resource_id WITH =` and
--    `tstzrange(...) WITH &&`. Placed in the SAME extension schema the repo
--    already uses: 0001 creates pgcrypto with a bare `create extension` (it
--    lands in `public`, and is referenced as public.gen_random_bytes); 0026
--    asserts pgcrypto's namespace is in ('public','extensions'). We match that
--    layout with the identical bare form — no new schema is introduced.
-- ----------------------------------------------------------------------------
create extension if not exists btree_gist;

-- ----------------------------------------------------------------------------
-- 2. Denormalized exclusivity flag. NOT NULL DEFAULT false; the trigger below
--    overwrites it on every write, so the default only ever applies for the
--    instant before the BEFORE trigger runs. Backfilled from the resource's
--    capacity for any rows that already exist.
-- ----------------------------------------------------------------------------
alter table public.resource_reservations
  add column is_exclusive boolean not null default false;

update public.resource_reservations rr
   set is_exclusive = (r.capacity = 1)
  from public.resources r
 where r.id = rr.resource_id;

comment on column public.resource_reservations.is_exclusive is
  'Denormalized: true iff the resource is EXCLUSIVE (resources.capacity = 1). '
  'FORCED from the resource by lumin.enforce_reservation_exclusivity on every '
  'INSERT/UPDATE — a client-supplied value is always overwritten. Drives the '
  'resource_reservations_no_exclusive_overlap EXCLUDE constraint.';

-- ----------------------------------------------------------------------------
-- 3. Forcing trigger. BEFORE INSERT OR UPDATE, it (a) recomputes is_exclusive
--    from the resource's capacity, discarding whatever the writer supplied, and
--    (b) reaps TTL-elapsed exclusive holds so they cannot false-trip the EXCLUDE
--    against a new legitimate reservation.
--
--    Why the reap: reserve_resource_quantity (0020) counts a `status='held'`
--    row as consuming ONLY while expires_at > now(); once its TTL elapses it is
--    non-consuming and the RPC will happily grant a competing reservation for
--    the same exclusive slot. But an EXCLUDE predicate must be IMMUTABLE, so it
--    cannot itself test expires_at > now() — a still-'held' but expired row
--    would otherwise match the predicate and block the RPC's legitimate insert.
--    We resolve the mismatch by transitioning such stale holds to 'expired'
--    (their eventual state anyway) at the moment a new exclusive reservation is
--    written, so the predicate and the RPC agree on what "active" means.
--
--    pg_trigger_depth() = 1 gates the reap to the outer write only: the reap's
--    own UPDATEs re-fire this trigger at depth 2 (where they still get their
--    flag forced, correctly) but do not recurse into reaping.
--
--    SECURITY DEFINER (owner = migration role, e.g. postgres) with search_path
--    pinned to '' so it can always read public.resources and write the reap
--    regardless of RLS, and resolves only schema-qualified objects.
-- ----------------------------------------------------------------------------
create or replace function lumin.enforce_reservation_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_excl boolean;
begin
  -- (a) FORCE the flag from the resource's capacity. Exclusive := capacity = 1.
  --     coalesce → false for a (transiently) unknown resource; the row's own FK
  --     to public.resources then rejects a genuinely missing resource_id.
  select (r.capacity = 1) into v_excl
    from public.resources r
   where r.id = new.resource_id;
  new.is_exclusive := coalesce(v_excl, false);

  -- (b) Reap stale exclusive holds overlapping this new active reservation.
  if new.is_exclusive
     and new.status in ('held', 'consumed')
     and pg_trigger_depth() = 1 then
    update public.resource_reservations rr
       set status = 'expired'
     where rr.resource_id = new.resource_id
       and rr.id is distinct from new.id
       and rr.status = 'held'
       and rr.expires_at <= now()
       and rr.slot_start < new.slot_end
       and rr.slot_end   > new.slot_start;
  end if;

  return new;
end;
$fn$;

revoke all on function lumin.enforce_reservation_exclusivity()
  from public, anon, authenticated;

create trigger resource_reservations_enforce_exclusivity
  before insert or update on public.resource_reservations
  for each row execute function lumin.enforce_reservation_exclusivity();

-- ----------------------------------------------------------------------------
-- 4. THE STRUCTURAL BACKSTOP — no two ACTIVE reservations may overlap in time
--    on the same EXCLUSIVE resource. Half-open [slot_start, slot_end) intervals
--    (tstzrange default '[)'), matching the RPCs' overlap test
--    (slot_start < other.slot_end AND slot_end > other.slot_start): adjacent
--    slots (end == next start) do NOT overlap and are allowed.
--
--    The partial WHERE keeps the constraint off pooled resources entirely
--    (is_exclusive = false ⇒ never indexed) and off non-consuming rows
--    ('released'/'expired' ⇒ never indexed), so pooled N-concurrency and the
--    release/expire lifecycle are untouched.
--
--    DEFERRABLE INITIALLY IMMEDIATE: enforcement is IMMEDIATE by default (an
--    overlapping write fails at that statement, and no overlapping exclusive
--    pair can ever commit), but the check is queued as an end-of-statement
--    constraint event rather than mid-INSERT. This preserves the error ORDER
--    the existing suites rely on: the pre-existing composite tenant FKs on
--    resource_reservations (0012/0014) fire FIRST for a cross-tenant row, so a
--    row that is BOTH cross-tenant AND an exclusive overlap still surfaces as
--    foreign_key_violation (what resource_tenant_integrity_tests asserts), not
--    exclusion_violation. A genuine same-tenant overlap still raises 23P01 at
--    its statement. The mode does not weaken the guard — overbooking remains
--    structurally impossible to commit.
-- ----------------------------------------------------------------------------
alter table public.resource_reservations
  add constraint resource_reservations_no_exclusive_overlap
  exclude using gist (
    resource_id                        with =,
    tstzrange(slot_start, slot_end)    with &&
  )
  where (is_exclusive and status in ('held', 'consumed'))
  deferrable initially immediate;

comment on constraint resource_reservations_no_exclusive_overlap
  on public.resource_reservations is
  'P0 OB-STRUCT backstop: structurally forbids two overlapping ACTIVE '
  '(held/consumed) reservations on the same EXCLUSIVE (capacity-1) resource, '
  'independent of any RPC caller. Pooled resources (capacity>1) are excluded by '
  'the is_exclusive predicate and keep N-concurrency (reserve_resource_quantity '
  'enforces their N ceiling).';

-- ============================================================================
-- NOTE — SECONDARY capacity-slot backstop DEFERRED (R1b).
--
-- The audit also showed two state='confirmed' bookings inserted on one
-- capacity-1 SERVICE slot with no reserve_capacity call. Enforcing "a confirmed
-- booking for a capacity-limited service must reference a valid CONSUMED
-- capacity_hold" via trigger CANNOT be made backward-compatible cleanly here:
--
--   * Multiple existing SQL suites (and legitimate admin/manual confirmations)
--     create state='confirmed' bookings by DIRECT insert/update with NO
--     capacity_hold — e.g. rls_attack_tests.sql and
--     platform_financial_minimization_tests.sql insert confirmed bookings
--     directly; a hold-requiring trigger would fail those on apply.
--   * "capacity-limited" is a property of a service's availability, not a flag
--     on the row, so a confirm-time trigger cannot cheaply decide which
--     bookings the rule applies to without changing accepted seed/test behavior.
--
-- Forcing it would regress the existing corpus, so per the recovery brief it is
-- DEFERRED as follow-up R1b (a forward migration that either adds a
-- service-level "capacity_limited" flag + a CONSUMED-hold requirement gated on
-- it, or a partial EXCLUDE on bookings keyed to a trusted service-capacity
-- marker, plus a fixture migration for existing confirmed rows). The PRIMARY
-- exclusive-resource EXCLUDE above lands unconditionally and closes the
-- resource half of OB-STRUCT structurally.
-- ============================================================================

commit;
