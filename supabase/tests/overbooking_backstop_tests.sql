-- ============================================================================
-- overbooking_backstop_tests.sql — P0 OB-STRUCT structural backstop proof.
--
-- Proves migration 0031's exclusive-resource EXCLUDE constraint + forcing
-- trigger. One transaction, disposable synthetic fixtures, ROLLED BACK at the
-- end; \set ON_ERROR_STOP aborts non-zero on any FAIL. Success = final echo
-- 'ALL OVERBOOKING BACKSTOP TESTS PASSED'.
--
-- Run against a FRESH database with 0001..0031 applied (never a live project):
--   psql -v ON_ERROR_STOP=1 -d lumin_test -f supabase/tests/overbooking_backstop_tests.sql
--
-- resource_reservations is server-internal: only the SECURITY DEFINER RPCs
-- (owner postgres) and the migration/superuser role write it directly; even
-- service_role holds SELECT only. So the DIRECT-insert attack — a writer that
-- bypasses reserve_resource entirely — is modelled with the privileged
-- migration role, the most-privileged writer there is. That is the point of a
-- STRUCTURAL constraint: an EXCLUDE is enforced by the storage engine for every
-- role (superuser and BYPASSRLS included — RLS bypass does not bypass
-- constraints), so catching the privileged direct insert proves it catches all.
--
-- Coverage:
--   T1  two overlapping ACTIVE reservations on one EXCLUSIVE resource, inserted
--       DIRECTLY (bypassing the RPC), second REJECTED (exclusion_violation).
--   T2  the same double-book attempted via the reserve_resource RPC is refused
--       (NO_CAPACITY, no second row) — the RPC front door and the EXCLUDE
--       back door agree.
--   T3  NON-overlapping reservations on the same exclusive resource → allowed.
--   T4  a POOLED resource still allows N concurrent OVERLAPPING reservations
--       (the EXCLUDE must not over-restrict pooled).
--   T5  the forcing trigger OVERWRITES a client-supplied is_exclusive (a direct
--       insert cannot lie about exclusivity).
--   T6  the legitimate reserve_resource -> consume_resource_holds ->
--       booking-confirm path still succeeds for an exclusive resource booked
--       once, WITH the constraint present.
--   T7  a stale (TTL-elapsed) exclusive hold is reaped, so a new legitimate
--       reservation for the freed slot is granted rather than false-blocked.
--   R1b the capacity-slot booking backstop is DEFERRED — documented, not asserted.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

create function pg_temp.assert(ok boolean, label text) returns void
  language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- Execute q; PASS iff it raises SQLSTATE `code`, FAIL if it succeeds or raises
-- a different error.
create function pg_temp.reject(q text, code text, label text) returns void
  language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = code then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: % — wrong error % (expected %)', label, sqlstate, code;
  end;
  raise exception 'FAIL: % — statement was accepted (expected % rejection)', label, code;
end $$;

-- ----------------------------------------------------------------------------
-- Fixtures: one tenant; one EXCLUSIVE resource (capacity 1) and one POOLED
-- resource (capacity 3); several draft bookings to anchor reservations.
-- ----------------------------------------------------------------------------
insert into public.tenants (id, name, slug, timezone, currency, status) values
  ('c1000000-0000-4000-8000-000000000001', 'OB', 'overbooking-backstop', 'UTC', 'USD', 'active');

insert into public.resources (id, tenant_id, name, kind, capacity, active) values
  ('c1000000-0000-4000-8000-0000000000e1', 'c1000000-0000-4000-8000-000000000001', 'Cargo Van',   'vehicle', 1, true),
  ('c1000000-0000-4000-8000-0000000000e3', 'c1000000-0000-4000-8000-000000000001', 'Install Crew', 'crew',    3, true);

insert into public.bookings (id, tenant_id, reference, slot_start, slot_end, idempotency_key)
select ('c1000000-0000-4000-8000-'||lpad(n::text, 12, '0'))::uuid,
       'c1000000-0000-4000-8000-000000000001',
       'OB-'||lpad(n::text, 4, '0'), '2040-01-01T10:00Z', '2040-01-01T11:00Z', 'ob-backstop-fixture-'||n
from generate_series(10, 25) n;

-- ----------------------------------------------------------------------------
-- T1 — DIRECT double-book of an EXCLUSIVE resource is structurally REJECTED.
-- The audit scenario: no reserve_capacity/reserve_resource call at all, just two
-- overlapping active reservations inserted straight into the table.
-- ----------------------------------------------------------------------------
insert into public.resource_reservations
  (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
   'c1000000-0000-4000-8000-000000000010', '2040-01-01T10:00Z', '2040-01-01T11:00Z',
   'k1', 'held', now() + interval '15 minutes');

-- Overlapping second reservation (different booking) on the SAME exclusive unit.
select pg_temp.reject($q$
  insert into public.resource_reservations
    (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
  values
    ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
     'c1000000-0000-4000-8000-000000000011', '2040-01-01T10:30Z', '2040-01-01T11:30Z',
     'k2', 'held', now() + interval '15 minutes')
$q$, '23P01', 'T1 direct overlapping exclusive reservation rejected (exclusion_violation)');

-- A 'consumed' second reservation is equally blocked (predicate covers both).
select pg_temp.reject($q$
  insert into public.resource_reservations
    (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
  values
    ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
     'c1000000-0000-4000-8000-000000000012', '2040-01-01T10:59Z', '2040-01-01T11:30Z',
     'k3', 'consumed', now() + interval '15 minutes')
$q$, '23P01', 'T1b direct overlapping exclusive consumed reservation rejected');

select pg_temp.assert(
  (select count(*) = 1 from public.resource_reservations
     where resource_id = 'c1000000-0000-4000-8000-0000000000e1'),
  'T1c exactly one exclusive reservation survived the double-book attempts');

-- ----------------------------------------------------------------------------
-- T2 — the same double-book via the reserve_resource RPC is refused up front
-- (NO_CAPACITY), so no second row is even attempted. Front door + back door
-- agree: exclusive capacity 1 is honoured whether or not the caller uses the RPC.
-- ----------------------------------------------------------------------------
select pg_temp.assert(
  (select result = 'NO_CAPACITY' from public.reserve_resource(
     'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
     '2040-01-01T10:30Z', '2040-01-01T11:30Z',
     'c1000000-0000-4000-8000-000000000013', interval '15 minutes')),
  'T2 reserve_resource RPC refuses the overlapping exclusive reservation (NO_CAPACITY)');

-- ----------------------------------------------------------------------------
-- T3 — NON-overlapping reservations on the same exclusive resource are allowed
-- (half-open intervals: 11:00 end is adjacent to, not overlapping, 11:00 start).
-- ----------------------------------------------------------------------------
insert into public.resource_reservations
  (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
   'c1000000-0000-4000-8000-000000000014', '2040-01-01T11:00Z', '2040-01-01T12:00Z',
   'k4', 'held', now() + interval '15 minutes');

select pg_temp.assert(
  (select count(*) = 2 from public.resource_reservations
     where resource_id = 'c1000000-0000-4000-8000-0000000000e1'),
  'T3 adjacent non-overlapping exclusive reservation accepted (2 rows)');

-- ----------------------------------------------------------------------------
-- T4 — a POOLED resource (capacity 3) still allows N concurrent OVERLAPPING
-- reservations; the EXCLUDE never applies to it (is_exclusive = false).
-- ----------------------------------------------------------------------------
insert into public.resource_reservations
  (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e3',
   'c1000000-0000-4000-8000-000000000020', '2040-01-01T10:00Z', '2040-01-01T11:00Z', 'p1', 'held',     now() + interval '15 minutes'),
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e3',
   'c1000000-0000-4000-8000-000000000021', '2040-01-01T10:00Z', '2040-01-01T11:00Z', 'p2', 'held',     now() + interval '15 minutes'),
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e3',
   'c1000000-0000-4000-8000-000000000022', '2040-01-01T10:00Z', '2040-01-01T11:00Z', 'p3', 'consumed', now() + interval '15 minutes');

select pg_temp.assert(
  (select count(*) = 3 from public.resource_reservations
     where resource_id = 'c1000000-0000-4000-8000-0000000000e3'),
  'T4 pooled resource allows 3 concurrent overlapping reservations');

select pg_temp.assert(
  (select bool_and(is_exclusive = false) from public.resource_reservations
     where resource_id = 'c1000000-0000-4000-8000-0000000000e3'),
  'T4b pooled reservations flagged is_exclusive = false by the trigger');

-- ----------------------------------------------------------------------------
-- T5 — the forcing trigger OVERWRITES a client-supplied is_exclusive. A direct
-- insert that LIES (is_exclusive = false on a capacity-1 unit) is corrected to
-- true, and a second overlapping row is then still blocked. Exclusivity cannot
-- be forged away.
-- ----------------------------------------------------------------------------
insert into public.resource_reservations
  (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at, is_exclusive)
values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
   'c1000000-0000-4000-8000-000000000015', '2040-01-01T14:00Z', '2040-01-01T15:00Z',
   'k5', 'held', now() + interval '15 minutes', false);   -- <- lie

select pg_temp.assert(
  (select is_exclusive = true from public.resource_reservations
     where booking_id = 'c1000000-0000-4000-8000-000000000015'),
  'T5 client-supplied is_exclusive=false was overwritten to true from the resource');

select pg_temp.reject($q$
  insert into public.resource_reservations
    (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at, is_exclusive)
  values
    ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
     'c1000000-0000-4000-8000-000000000016', '2040-01-01T14:30Z', '2040-01-01T15:30Z',
     'k6', 'held', now() + interval '15 minutes', false)
$q$, '23P01', 'T5b a forged-non-exclusive overlapping row is still rejected');

-- ----------------------------------------------------------------------------
-- T6 — the LEGITIMATE path for an exclusive resource booked ONCE still works
-- end to end: reserve_resource -> consume_resource_holds -> confirm the booking,
-- with the EXCLUDE constraint live.
-- ----------------------------------------------------------------------------
select pg_temp.assert(
  (select result = 'GRANTED' from public.reserve_resource(
     'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
     '2040-01-02T09:00Z', '2040-01-02T10:00Z',
     'c1000000-0000-4000-8000-000000000017', interval '15 minutes')),
  'T6 reserve_resource GRANTED for a first exclusive booking');

select pg_temp.assert(
  public.consume_resource_holds('c1000000-0000-4000-8000-000000000017') = 1,
  'T6b consume_resource_holds consumed the exclusive hold');

update public.bookings set state = 'pending_payment' where id = 'c1000000-0000-4000-8000-000000000017';
update public.bookings set state = 'confirmed'       where id = 'c1000000-0000-4000-8000-000000000017';

select pg_temp.assert(
  (select state = 'confirmed' from public.bookings where id = 'c1000000-0000-4000-8000-000000000017')
  and (select status = 'consumed' from public.resource_reservations
         where booking_id = 'c1000000-0000-4000-8000-000000000017'),
  'T6c exclusive booking confirmed with its reservation consumed (legit path intact)');

-- ----------------------------------------------------------------------------
-- T7 — a stale (TTL-elapsed) exclusive hold does NOT false-block a new
-- legitimate reservation for the freed slot. reserve_resource treats the expired
-- hold as non-consuming; the trigger reaps it so the EXCLUDE agrees.
-- ----------------------------------------------------------------------------
-- An expired held row on the exclusive unit for a fresh slot.
insert into public.resource_reservations
  (tenant_id, resource_id, booking_id, slot_start, slot_end, hold_key, status, expires_at)
values
  ('c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
   'c1000000-0000-4000-8000-000000000018', '2040-01-03T09:00Z', '2040-01-03T10:00Z',
   'k7', 'held', now() - interval '1 second');   -- already past TTL

select pg_temp.assert(
  (select result = 'GRANTED' from public.reserve_resource(
     'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000e1',
     '2040-01-03T09:00Z', '2040-01-03T10:00Z',
     'c1000000-0000-4000-8000-000000000019', interval '15 minutes')),
  'T7 new exclusive reservation GRANTED over an expired stale hold');

select pg_temp.assert(
  (select status = 'expired' from public.resource_reservations
     where booking_id = 'c1000000-0000-4000-8000-000000000018')
  and (select status = 'held' from public.resource_reservations
         where booking_id = 'c1000000-0000-4000-8000-000000000019'),
  'T7b the stale hold was reaped to expired and the new hold is live');

-- ----------------------------------------------------------------------------
-- R1b — the capacity-slot booking backstop (a confirmed booking must reference a
-- consumed capacity_hold) is DEFERRED, not enforced here (see 0031's foot NOTE):
-- existing suites and legitimate admin confirms insert confirmed bookings with
-- no hold, so it cannot be made backward-compatible cleanly. Documented only.
-- ----------------------------------------------------------------------------
do $t$
begin
  raise notice 'NOTE: capacity-slot booking backstop deferred to R1b (see 0031 NOTE).';
end $t$;

rollback;

\echo 'ALL OVERBOOKING BACKSTOP TESTS PASSED'
