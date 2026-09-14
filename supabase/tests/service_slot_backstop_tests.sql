-- ============================================================================
-- service_slot_backstop_tests.sql — P0 OB-STRUCT service-slot backstop proof.
--
-- Proves migration 0033: a booking for a capacity_limited service may transition
-- INTO state=confirmed only when a CONSUMED capacity_hold exists for it, so every
-- confirm is forced through lumin.reserve_capacity -> consume_hold and the
-- advisory-lock capacity count caps confirmed bookings per slot — for ANY writer.
-- One transaction, disposable synthetic fixtures, ROLLED BACK at the end;
-- ON_ERROR_STOP aborts non-zero on any FAIL.
--
-- Run against a FRESH database with 0001..0033 applied (never a live project):
--   psql -v ON_ERROR_STOP=1 -d lumin_test -f supabase/tests/service_slot_backstop_tests.sql
--
-- Like overbooking_backstop_tests, the DIRECT-write attacks are modelled with
-- the privileged migration role (the most-privileged writer). The trigger fires
-- for every role — service_role/BYPASSRLS and the migration superuser included —
-- so catching the privileged direct write proves it catches all.
--
-- Coverage:
--   T1  direct INSERT of a confirmed booking (no hold) on a capacity_limited
--       service is REJECTED (P0001 CONFIRMED_WITHOUT_CAPACITY_HOLD).
--   T2  the legal UPDATE draft->pending_payment->confirmed with NO consumed hold
--       is REJECTED at the into-confirmed step (front door open, back door shut).
--   T3  the legitimate reserve_capacity -> consume_hold -> confirm path SUCCEEDS.
--   T4  a capacity_limited=false service is EXEMPT: a direct confirmed insert with
--       no hold is accepted (backward-compatible; existing suites unaffected).
--   T5  structural cap: with A legitimately confirmed on a capacity-1 slot, the
--       RPC refuses B (NO_CAPACITY) AND a rogue direct-confirmed B is rejected —
--       exactly one confirmed booking survives on the slot.
--   T6  grandfathering: an already-confirmed booking with no hold (service later
--       marked capacity_limited) still transitions confirmed->completed — the
--       trigger fires only on the transition INTO confirmed.
--   T7  an active-but-not-consumed hold does NOT satisfy the requirement (only a
--       CONSUMED hold does), so a confirm before consume is rejected.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

create function pg_temp.assert(ok boolean, label text) returns void
  language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- Execute q; PASS iff it raises SQLSTATE `code`, FAIL if it succeeds or raises a
-- different error.
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
-- Fixtures: one tenant; a capacity_limited service (SVC_LIM) and an unmarked
-- service (SVC_OPEN); disposable draft bookings. reserve_capacity is
-- availability-agnostic (it only counts consumers under the advisory lock), so
-- no availability_rules are needed here.
-- ----------------------------------------------------------------------------
insert into public.tenants (id, name, slug, timezone, currency, status) values
  ('d1000000-0000-4000-8000-000000000001', 'SSB', 'service-slot-backstop', 'UTC', 'USD', 'active');

insert into public.services
  (id, tenant_id, archetype, name, currency, base_price, duration_minutes, tax_rate_bp, capacity_limited)
values
  ('d1000000-0000-4000-8000-0000000000a1', 'd1000000-0000-4000-8000-000000000001',
   'simple', 'Single-bay detail', 'USD', 5000, 60, 0, true),
  ('d1000000-0000-4000-8000-0000000000a2', 'd1000000-0000-4000-8000-000000000001',
   'simple', 'Unlimited advice call', 'USD', 5000, 60, 0, false);

-- Each fixture booking gets its OWN distinct day-slot (n-10 days after Feb 1,
-- 10:00-11:00Z) so scenarios never contend for the same capacity-1 slot; the T5
-- structural-cap scenario reassigns its two bookings onto ONE shared slot
-- explicitly. selection carries the service id (bookings have no service column).
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end, idempotency_key)
select ('d1000000-0000-4000-8000-'||lpad(n::text, 12, '0'))::uuid,
       'd1000000-0000-4000-8000-000000000001',
       'SSB-'||lpad(n::text, 4, '0'), 'draft',
       jsonb_build_object('serviceId', 'd1000000-0000-4000-8000-0000000000a1'),
       '{}'::jsonb,
       '2040-02-01T10:00Z'::timestamptz + (n - 10) * interval '1 day',
       '2040-02-01T11:00Z'::timestamptz + (n - 10) * interval '1 day',
       'ssb-fixture-'||lpad(n::text,4,'0')
from generate_series(10, 25) n;

-- ----------------------------------------------------------------------------
-- T1 — DIRECT INSERT of a confirmed booking (no hold) on a capacity_limited
-- service is structurally REJECTED. The audit scenario: no reserve_capacity
-- call at all, a confirmed booking written straight into the table.
-- ----------------------------------------------------------------------------
select pg_temp.reject($q$
  insert into public.bookings
    (tenant_id, reference, state, selection, pricing, slot_start, slot_end, idempotency_key)
  values
    ('d1000000-0000-4000-8000-000000000001', 'SSB-DIRECT1', 'confirmed',
     jsonb_build_object('serviceId', 'd1000000-0000-4000-8000-0000000000a1'),
     '{}'::jsonb, '2040-02-01T10:00Z', '2040-02-01T11:00Z', 'ssb-direct-confirm-1')
$q$, 'P0001', 'T1 direct confirmed insert on capacity_limited service (no hold) rejected');

-- ----------------------------------------------------------------------------
-- T2 — the LEGAL state walk draft->pending_payment->confirmed with NO consumed
-- hold is rejected at the into-confirmed step. draft->pending_payment succeeds
-- (legal transition, no hold requirement); the pending_payment->confirmed step
-- is where the backstop fires.
-- ----------------------------------------------------------------------------
update public.bookings set state = 'pending_payment'
  where id = 'd1000000-0000-4000-8000-000000000010';
select pg_temp.reject($q$
  update public.bookings set state = 'confirmed'
    where id = 'd1000000-0000-4000-8000-000000000010'
$q$, 'P0001', 'T2 pending_payment->confirmed without a consumed hold rejected');
select pg_temp.assert(
  (select state = 'pending_payment' from public.bookings
     where id = 'd1000000-0000-4000-8000-000000000010'),
  'T2b the rejected confirm left the booking in pending_payment');

-- ----------------------------------------------------------------------------
-- T3 — the LEGITIMATE path succeeds: reserve_capacity (GRANTED) -> consume_hold
-- -> confirm. This is exactly what the R2b confirm route does.
-- ----------------------------------------------------------------------------
update public.bookings set state = 'pending_payment'
  where id = 'd1000000-0000-4000-8000-000000000011';
select pg_temp.assert(
  (select result = 'GRANTED' from public.reserve_capacity(
     'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000a1',
     '2040-02-02T10:00Z', '2040-02-02T11:00Z',  -- booking 11's own distinct slot
     'd1000000-0000-4000-8000-000000000011', 1, interval '15 minutes')),
  'T3a reserve_capacity GRANTED for the first booking on the capacity-1 slot');
select pg_temp.assert(
  public.consume_hold('d1000000-0000-4000-8000-000000000011'),
  'T3b consume_hold marked the hold consumed');
update public.bookings set state = 'confirmed'
  where id = 'd1000000-0000-4000-8000-000000000011';
select pg_temp.assert(
  (select state = 'confirmed' from public.bookings
     where id = 'd1000000-0000-4000-8000-000000000011'),
  'T3c confirm through the reserve->consume path succeeds with the backstop present');

-- ----------------------------------------------------------------------------
-- T4 — a capacity_limited=false service is EXEMPT: a direct confirmed insert
-- with no hold is accepted (backward-compatible; the existing corpus of suites
-- that insert confirmed bookings directly against unmarked services is untouched).
-- ----------------------------------------------------------------------------
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end, idempotency_key)
values
  ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000001',
   'SSB-OPEN1', 'confirmed',
   jsonb_build_object('serviceId', 'd1000000-0000-4000-8000-0000000000a2'),
   '{}'::jsonb, '2040-02-01T10:00Z', '2040-02-01T11:00Z', 'ssb-open-confirm-1');
select pg_temp.assert(
  (select state = 'confirmed' from public.bookings
     where id = 'd1000000-0000-4000-8000-000000000031'),
  'T4 unmarked (capacity_limited=false) service accepts a direct confirmed insert (exempt)');

-- ----------------------------------------------------------------------------
-- T5 — STRUCTURAL CAP. Put bookings 20 (A) and 21 (B) on ONE shared capacity-1
-- slot. Confirm A legitimately (reserve->consume->confirm), then:
--  (a) reserve_capacity refuses B up front (NO_CAPACITY) — the RPC counts the
--      hold-less confirmed booking A as the single consumer.
--  (b) a rogue DIRECT-confirmed B (no hold) is rejected by the trigger.
--  ⟹ exactly one confirmed booking on the (service, slot).
-- ----------------------------------------------------------------------------
update public.bookings
   set slot_start = '2040-03-01T10:00Z', slot_end = '2040-03-01T11:00Z'
 where id in ('d1000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000021');
-- A: legitimate confirm.
update public.bookings set state = 'pending_payment'
  where id = 'd1000000-0000-4000-8000-000000000020';
select pg_temp.assert(
  (select result = 'GRANTED' from public.reserve_capacity(
     'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000a1',
     '2040-03-01T10:00Z', '2040-03-01T11:00Z',
     'd1000000-0000-4000-8000-000000000020', 1, interval '15 minutes')),
  'T5a booking A GRANTED on the shared capacity-1 slot');
select pg_temp.assert(public.consume_hold('d1000000-0000-4000-8000-000000000020'), 'T5b A hold consumed');
update public.bookings set state = 'confirmed'
  where id = 'd1000000-0000-4000-8000-000000000020';
-- B: front door refused.
update public.bookings set state = 'pending_payment'
  where id = 'd1000000-0000-4000-8000-000000000021';
select pg_temp.assert(
  (select result = 'NO_CAPACITY' from public.reserve_capacity(
     'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000a1',
     '2040-03-01T10:00Z', '2040-03-01T11:00Z',
     'd1000000-0000-4000-8000-000000000021', 1, interval '15 minutes')),
  'T5c reserve_capacity refuses booking B on the occupied capacity-1 slot (NO_CAPACITY)');
-- B: back door refused.
select pg_temp.reject($q$
  update public.bookings set state = 'confirmed'
    where id = 'd1000000-0000-4000-8000-000000000021'
$q$, 'P0001', 'T5d rogue direct-confirm of booking B (no hold) rejected');
select pg_temp.assert(
  (select count(*) = 1 from public.bookings
     where (selection ->> 'serviceId') = 'd1000000-0000-4000-8000-0000000000a1'
       and slot_start = '2040-03-01T10:00Z' and state = 'confirmed'),
  'T5e exactly one confirmed booking survived on the shared capacity-1 slot');

-- ----------------------------------------------------------------------------
-- T6 — GRANDFATHERING. Booking 31 is already confirmed (T4, no hold) against a
-- service now flipped to capacity_limited=true. The legal transition OUT of
-- confirmed (confirmed->completed) still succeeds — the trigger fires only on
-- the transition INTO confirmed, so pre-existing confirmed rows are never
-- retro-checked and need no synthetic hold.
-- ----------------------------------------------------------------------------
update public.services set capacity_limited = true
  where id = 'd1000000-0000-4000-8000-0000000000a2';
update public.bookings set state = 'completed'
  where id = 'd1000000-0000-4000-8000-000000000031';
select pg_temp.assert(
  (select state = 'completed' from public.bookings
     where id = 'd1000000-0000-4000-8000-000000000031'),
  'T6 an existing confirmed booking transitions out of confirmed without a hold (grandfathered)');

-- ----------------------------------------------------------------------------
-- T7 — an ACTIVE (not consumed) hold does NOT satisfy the requirement: a confirm
-- before consume_hold is rejected. Only a CONSUMED hold counts, matching the
-- reserve->consume->confirm ordering the runtime uses.
-- ----------------------------------------------------------------------------
update public.bookings set state = 'pending_payment'
  where id = 'd1000000-0000-4000-8000-000000000013';
select pg_temp.assert(
  (select result = 'GRANTED' from public.reserve_capacity(
     'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-0000000000a1',
     '2040-02-04T10:00Z', '2040-02-04T11:00Z',  -- booking 13's own distinct slot
     'd1000000-0000-4000-8000-000000000013', 1, interval '15 minutes')),
  'T7a reserve_capacity GRANTED an ACTIVE hold (not yet consumed)');
select pg_temp.reject($q$
  update public.bookings set state = 'confirmed'
    where id = 'd1000000-0000-4000-8000-000000000013'
$q$, 'P0001', 'T7b confirm with only an ACTIVE (unconsumed) hold rejected');
select pg_temp.assert(public.consume_hold('d1000000-0000-4000-8000-000000000013'),
  'T7c consume_hold marks it consumed');
update public.bookings set state = 'confirmed'
  where id = 'd1000000-0000-4000-8000-000000000013';
select pg_temp.assert(
  (select state = 'confirmed' from public.bookings
     where id = 'd1000000-0000-4000-8000-000000000013'),
  'T7d after consume, the same confirm succeeds');

rollback;

\echo 'ALL SERVICE-SLOT BACKSTOP TESTS PASSED'
