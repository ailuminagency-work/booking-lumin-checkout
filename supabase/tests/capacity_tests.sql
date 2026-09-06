-- ============================================================================
-- capacity_tests.sql — DB-authoritative capacity holds (RC-3 F1).
--
-- Proves lumin.reserve_capacity / consume_hold / release_hold uphold the
-- final-slot invariant: for a capacity-1 slot, exactly ONE reservation wins;
-- concurrent losers get NO_CAPACITY; re-reserve is idempotent; expired holds do
-- not block; consume/release move capacity correctly.
--
-- Run against a FRESH project (or plain PG after local_harness.sql) with all
-- migrations 0001-0010 applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/capacity_tests.sql
--
-- The single-session tests run in ONE transaction rolled back at the end. The
-- true two-transaction concurrency proof (ATTACK C4) is driven by an EXTERNAL
-- harness (see capacity_concurrency_harness.sh) because a real second backend /
-- overlapping transaction cannot be simulated inside one psql session — an
-- advisory xact lock taken twice in the same session is re-entrant. C4 here
-- asserts the SEQUENTIAL guarantee (winner then loser); the harness asserts the
-- CONCURRENT one (two live overlapping transactions).
--
-- Last line on success: "ALL CAPACITY TESTS PASSED".
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ----------------------------------------------------------------------------
-- Fixtures: one active tenant, one service with a capacity-1 weekly rule, and
-- three DRAFT bookings on the SAME last slot (created via the privileged
-- fixture role; the INSERT guard bypasses for non-authenticated).
-- ----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1111111-1111-1111-1111-111111111111', 'cap-owner@example.test');

insert into public.tenants (id, name, slug, timezone, currency, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Cap Tenant', 'cap-tenant', 'America/Chicago', 'USD', 'active');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1111111-1111-1111-1111-111111111111', 'BUSINESS_OWNER');

insert into public.services (id, tenant_id, archetype, name, currency, base_price, duration_minutes) values
  ('c0000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'simple', 'Single Bay Detail', 'USD', 12000, 120);

-- capacity 1 window covering the slot's weekday.
insert into public.availability_rules (tenant_id, service_id, weekday, start_minute, end_minute, capacity) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001', 1, 540, 1020, 1);

insert into public.customers (id, tenant_id, name, email) values
  ('c0000000-0000-0000-0000-0000000000c1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Cap Cust', 'cap@example.test');

-- Three draft bookings on the identical slot (the contested last slot).
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end, customer_id, idempotency_key)
values
  ('c0000000-0000-0000-0000-0000000000b1', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'LMN-CAP001', 'draft', '{"serviceId":"c0000000-0000-0000-0000-000000000001"}', '{}',
   timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
   'c0000000-0000-0000-0000-0000000000c1', 'idem-cap-booking-0001'),
  ('c0000000-0000-0000-0000-0000000000b2', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'LMN-CAP002', 'draft', '{"serviceId":"c0000000-0000-0000-0000-000000000001"}', '{}',
   timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
   'c0000000-0000-0000-0000-0000000000c1', 'idem-cap-booking-0002'),
  ('c0000000-0000-0000-0000-0000000000b3', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'LMN-CAP003', 'draft', '{"serviceId":"c0000000-0000-0000-0000-000000000001"}', '{}',
   timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
   'c0000000-0000-0000-0000-0000000000c1', 'idem-cap-booking-0003');

-- ============================================================================
-- ATTACK C1 — first reservation on a capacity-1 slot GRANTS; a second booking
-- on the same slot is refused NO_CAPACITY.
-- ============================================================================
do $t$
declare
  r1 record;
  r2 record;
begin
  select * into r1 from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b1', 1, interval '15 minutes');
  if r1.result <> 'GRANTED' then raise exception 'FAIL C1a: first reserve got %', r1.result; end if;
  if r1.hold_id is null then raise exception 'FAIL C1a: granted hold has null id'; end if;

  select * into r2 from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b2', 1, interval '15 minutes');
  if r2.result <> 'NO_CAPACITY' then raise exception 'FAIL C1b: second reserve got % (expected NO_CAPACITY)', r2.result; end if;
  if r2.hold_id is not null then raise exception 'FAIL C1b: NO_CAPACITY returned a hold id'; end if;

  raise notice 'PASS C1: capacity-1 slot grants exactly one hold; the next is NO_CAPACITY';
end;
$t$;

-- ============================================================================
-- ATTACK C2 — idempotent re-reserve: re-reserving the SAME booking returns its
-- EXISTING active hold, never a second row.
-- ============================================================================
do $t$
declare
  r_first  record;
  r_again  record;
  n        bigint;
begin
  select * into r_first from public.capacity_holds
    where booking_id = 'c0000000-0000-0000-0000-0000000000b1';

  select * into r_again from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b1', 1, interval '15 minutes');
  if r_again.result <> 'GRANTED' then raise exception 'FAIL C2a: re-reserve got %', r_again.result; end if;
  if r_again.hold_id <> r_first.id then
    raise exception 'FAIL C2b: re-reserve returned a DIFFERENT hold (% vs %)', r_again.hold_id, r_first.id;
  end if;

  select count(*) into n from public.capacity_holds
    where booking_id = 'c0000000-0000-0000-0000-0000000000b1';
  if n <> 1 then raise exception 'FAIL C2c: booking has % hold rows (expected 1)', n; end if;

  raise notice 'PASS C2: re-reserve is idempotent (same hold, one row)';
end;
$t$;

-- ============================================================================
-- ATTACK C3 — expired holds do NOT block a new reservation. Force booking b1's
-- hold to have already expired, then a fresh booking (b2) on the same slot must
-- now be GRANTED (the expired hold is not a consumer).
-- ============================================================================
do $t$
declare
  r record;
  n bigint;
begin
  update public.capacity_holds
    set expires_at = now() - interval '1 minute'
    where booking_id = 'c0000000-0000-0000-0000-0000000000b1';

  select * into r from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b2', 1, interval '15 minutes');
  if r.result <> 'GRANTED' then
    raise exception 'FAIL C3a: reserve over an EXPIRED hold got % (expected GRANTED)', r.result;
  end if;

  -- Now b2 holds the slot; b3 must be refused.
  select count(*) into n from public.capacity_holds
    where booking_id = 'c0000000-0000-0000-0000-0000000000b2' and status = 'active' and expires_at > now();
  if n <> 1 then raise exception 'FAIL C3b: b2 does not have exactly one live active hold (%)', n; end if;

  raise notice 'PASS C3: an expired hold does not block; the slot is re-grantable';
end;
$t$;

-- ============================================================================
-- ATTACK C4 — SEQUENTIAL final-slot guarantee mirroring the real lifecycle.
-- b2 holds the slot (active, booking still draft). b3 must be NO_CAPACITY. We
-- then CONFIRM b2 the way the webhook does — booking draft→pending_payment→
-- confirmed AND consume_hold(b2) — and b3 is STILL NO_CAPACITY (the confirmed
-- booking now carries the capacity, its hold consumed). Finally we CANCEL b2
-- (confirmed→cancelled), which frees the slot so b3 can reserve. (The concurrent
-- two-transaction proof is the external harness; see the header.)
-- ============================================================================
do $t$
declare
  r record;
begin
  -- b3 blocked by b2's active hold.
  select * into r from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b3', 1, interval '15 minutes');
  if r.result <> 'NO_CAPACITY' then raise exception 'FAIL C4a: b3 got % while b2 active', r.result; end if;

  -- Confirm b2 exactly as the runtime does: advance the booking state machine
  -- to confirmed AND consume the hold. Capacity is now carried by the confirmed
  -- booking (its hold consumed, no longer active).
  update public.bookings set state = 'pending_payment' where id = 'c0000000-0000-0000-0000-0000000000b2';
  update public.bookings set state = 'confirmed'       where id = 'c0000000-0000-0000-0000-0000000000b2';
  if not lumin.consume_hold('c0000000-0000-0000-0000-0000000000b2') then
    raise exception 'FAIL C4b: consume_hold(b2) did not consume an active hold';
  end if;
  select * into r from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b3', 1, interval '15 minutes');
  if r.result <> 'NO_CAPACITY' then raise exception 'FAIL C4c: b3 got % while b2 confirmed', r.result; end if;

  -- Cancel b2 (confirmed → cancelled): the slot is freed for b3.
  update public.bookings set state = 'cancelled' where id = 'c0000000-0000-0000-0000-0000000000b2';
  select * into r from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b3', 1, interval '15 minutes');
  if r.result <> 'GRANTED' then raise exception 'FAIL C4d: b3 got % after b2 cancelled', r.result; end if;

  raise notice 'PASS C4: a confirmed booking keeps the slot locked; cancelling it frees the slot';
end;
$t$;

-- ============================================================================
-- ATTACK C5 — release_hold returns capacity: a fresh reserve, then release,
-- then a different booking may take the slot. Also proves release only acts on
-- active holds.
-- ============================================================================
do $t$
declare
  r record;
begin
  -- b3 currently holds (from C4d). Release it.
  if not lumin.release_hold('c0000000-0000-0000-0000-0000000000b3') then
    raise exception 'FAIL C5a: release_hold(b3) did not release an active hold';
  end if;
  -- A second release is a no-op (already released).
  if lumin.release_hold('c0000000-0000-0000-0000-0000000000b3') then
    raise exception 'FAIL C5b: release_hold(b3) released twice';
  end if;
  -- b1 (whose hold was expired in C3, then never reactivated) can now reserve.
  select * into r from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000b1', 1, interval '15 minutes');
  if r.result <> 'GRANTED' then raise exception 'FAIL C5c: b1 got % after b3 released', r.result; end if;
  raise notice 'PASS C5: release_hold frees the slot and is idempotent';
end;
$t$;

-- ============================================================================
-- ATTACK C6 — a confirmed booking with NO hold row still consumes capacity
-- (defense against an expired/lost hold silently opening an oversell). Insert a
-- confirmed booking on a fresh slot with no hold; a reservation on that slot is
-- refused.
-- ============================================================================
do $t$
declare
  r record;
begin
  insert into public.bookings
    (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end, customer_id, idempotency_key)
  values
    ('c0000000-0000-0000-0000-0000000000b9', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
     'LMN-CAP009', 'draft', '{"serviceId":"c0000000-0000-0000-0000-000000000001"}', '{}',
     timestamptz '2026-01-06 16:00:00+00', timestamptz '2026-01-06 18:00:00+00',
     'c0000000-0000-0000-0000-0000000000c1', 'idem-cap-booking-0009');
  update public.bookings set state = 'pending_payment' where id = 'c0000000-0000-0000-0000-0000000000b9';
  update public.bookings set state = 'confirmed'       where id = 'c0000000-0000-0000-0000-0000000000b9';

  -- New draft booking on the SAME fresh slot, no hold exists for b9.
  insert into public.bookings
    (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end, customer_id, idempotency_key)
  values
    ('c0000000-0000-0000-0000-0000000000ba', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
     'LMN-CAP010', 'draft', '{"serviceId":"c0000000-0000-0000-0000-000000000001"}', '{}',
     timestamptz '2026-01-06 16:00:00+00', timestamptz '2026-01-06 18:00:00+00',
     'c0000000-0000-0000-0000-0000000000c1', 'idem-cap-booking-0010');
  select * into r from lumin.reserve_capacity(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
    timestamptz '2026-01-06 16:00:00+00', timestamptz '2026-01-06 18:00:00+00',
    'c0000000-0000-0000-0000-0000000000ba', 1, interval '15 minutes');
  if r.result <> 'NO_CAPACITY' then
    raise exception 'FAIL C6: reserve over a hold-less CONFIRMED booking got % (expected NO_CAPACITY)', r.result;
  end if;
  raise notice 'PASS C6: a confirmed booking with no active hold still consumes capacity';
end;
$t$;

-- ============================================================================
-- ATTACK C7 — capacity_holds is server-internal: anon/authenticated get zero
-- access (no grant + forced RLS + no policy), and cannot EXECUTE the RPCs.
-- ============================================================================
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $t$
declare n bigint;
begin
  begin
    select count(*) into n from public.capacity_holds;
    raise exception 'FAIL C7a: anon could query capacity_holds (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS C7a: anon denied on capacity_holds';
  end;
  begin
    perform public.reserve_capacity(
      'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c0000000-0000-0000-0000-000000000001',
      timestamptz '2026-01-05 16:00:00+00', timestamptz '2026-01-05 18:00:00+00',
      'c0000000-0000-0000-0000-0000000000b1', 1, interval '15 minutes');
    raise exception 'FAIL C7b: anon could EXECUTE reserve_capacity';
  exception when insufficient_privilege then
    raise notice 'PASS C7b: anon denied EXECUTE on reserve_capacity';
  end;
end;
$t$;
reset role;

select set_config('request.jwt.claims',
  '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
do $t$
declare n bigint;
begin
  begin
    select count(*) into n from public.capacity_holds;
    raise exception 'FAIL C7c: authenticated member could query capacity_holds (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS C7c: authenticated member denied on capacity_holds';
  end;
  begin
    perform public.consume_hold('c0000000-0000-0000-0000-0000000000b1');
    raise exception 'FAIL C7d: authenticated could EXECUTE consume_hold';
  exception when insufficient_privilege then
    raise notice 'PASS C7d: authenticated denied EXECUTE on consume_hold';
  end;
end;
$t$;
reset role;

do $t$
begin
  raise notice '';
  raise notice '=== ALL CAPACITY TESTS PASSED ===';
end;
$t$;

rollback;
