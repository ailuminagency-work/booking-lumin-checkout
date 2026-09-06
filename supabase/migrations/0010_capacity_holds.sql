-- ============================================================================
-- 0010_capacity_holds.sql — RC-3 FINAL-SLOT RACE FIX (F1)
--
-- Forward-only migration (Postgres 15 / Supabase). Does NOT edit 0001-0009.
--
-- THE PROBLEM (F1): capacity was enforced only in application code. The
-- create-payment-intent edge function checked availability, then set
-- pending_payment — a TOCTOU window in which two concurrent "last slot"
-- checkouts could BOTH pass the availability read before either wrote its
-- hold, and the webhook then confirmed whatever was pending with NO oversell
-- compensation. Result: oversell of a capacity-1 slot.
--
-- THE FIX: a DB-authoritative capacity mechanism. A short-TTL `capacity_holds`
-- row is reserved ATOMICALLY (serialized by a transaction-scoped advisory lock
-- on the (tenant, service, slot) tuple) BEFORE any Stripe intent is minted. The
-- reservation counts existing consumers under the lock and only grants a hold
-- when consumers < capacity, so the last slot can be won by exactly one
-- checkout. The webhook consumes the hold on confirm and RELEASES it on
-- failure; if the hold is missing/expired at confirm time (oversold/lost) the
-- webhook REFUNDS instead of confirming (deterministic refund-on-oversell —
-- see supabase/functions/stripe-webhook).
--
-- RLS: ENABLE + FORCE, NO client policies. Holds are server-internal — only
-- service_role (BYPASSRLS) and the SECURITY DEFINER RPCs (owner: postgres,
-- BYPASSRLS) ever touch this table. anon/authenticated get no grants and no
-- policies: deny-by-default twice over, exactly like *_connection_secrets.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- capacity_holds — one short-lived reservation per booking for a (service,
-- slot) pair. status lifecycle:
--   active   → reserved, counts against capacity until it expires or is used
--   consumed → the booking was confirmed (payment succeeded); capacity locked
--   released → the checkout failed/cancelled; capacity returned to the pool
--   expired  → TTL elapsed without confirm; treated as non-consuming
-- A row is created 'active' by lumin.reserve_capacity with a short TTL
-- (expires_at = now() + p_ttl). booking_id is UNIQUE: at most one hold per
-- booking (re-reserving the same booking is idempotent — see the RPC).
-- ----------------------------------------------------------------------------
create table public.capacity_holds (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  service_id  uuid not null references public.services (id) on delete cascade,
  slot_start  timestamptz not null,
  slot_end    timestamptz not null,
  -- SI-3-style anchor: one hold per booking. A re-reservation reuses the row.
  booking_id  uuid not null unique references public.bookings (id) on delete cascade,
  -- Opaque server-minted token (audit / correlation); never a secret.
  hold_key    text not null,
  status      text not null default 'active'
              check (status in ('active', 'consumed', 'expired', 'released')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  check (slot_end > slot_start)
);

-- Reservation lookup path: (tenant, service, slot_start) — the same tuple the
-- advisory lock serializes on.
create index capacity_holds_lookup_idx
  on public.capacity_holds (tenant_id, service_id, slot_start);
create index capacity_holds_booking_id_idx
  on public.capacity_holds (booking_id);

-- ----------------------------------------------------------------------------
-- RLS: enable + FORCE, deny-by-default. capacity_holds joins the security core
-- (0007) conceptually; because it is a later table its enable/force lives here.
-- NO policies for anon/authenticated ⇒ zero rows / rejected writes for clients.
-- NO grants to anon/authenticated ⇒ the verbs are unreachable even if a policy
-- ever leaked. service_role (BYPASSRLS) and the definer RPCs are the only
-- writers/readers.
-- ----------------------------------------------------------------------------
alter table public.capacity_holds enable row level security;
alter table public.capacity_holds force row level security;

revoke all on public.capacity_holds from anon, authenticated;
grant all on public.capacity_holds to service_role;

-- ============================================================================
-- lumin.reserve_capacity — ATOMIC, DB-authoritative slot reservation (F1).
--
-- Serializes concurrent reservations for the SAME (tenant, service, slot) with
-- a TRANSACTION-SCOPED advisory lock, then counts current consumers and inserts
-- (or reactivates) an 'active' hold ONLY when consumers < p_capacity. Returns
-- 'GRANTED' with the hold, or 'NO_CAPACITY' with a null hold.
--
-- ADVISORY-LOCK KEY DERIVATION
--   pg_advisory_xact_lock(hashtextextended(<key>, 0)) where
--     <key> = p_tenant_id::text || ':' || p_service_id::text || ':' || p_slot_start::text
--   hashtextextended(text, seed=0) → bigint, the single-argument lock space.
--   Every concurrent reservation for the SAME slot derives the SAME bigint and
--   therefore contends on the SAME lock; different slots hash to (practically
--   always) different keys and never block each other. The lock is held to
--   COMMIT/ROLLBACK (xact-scoped), so the count-then-insert below is atomic
--   against any other reservation for the same slot: the loser blocks until the
--   winner commits, then sees the winner's hold in its own count.
--
-- CONSUMER COUNT (excludes THIS booking's own rows). A slot consumer is either:
--   (a) an ACTIVE, non-expired hold for the slot (an in-flight reservation:
--       a draft that reserved, or a pending_payment awaiting the webhook), OR
--   (b) a booking overlapping the slot in a capacity-consuming state
--       (pending_payment / confirmed / completed) that does NOT currently have
--       an active non-expired hold — i.e. a confirmed booking whose hold was
--       consumed, or a pending_payment booking whose hold already expired.
-- Counting holds and hold-less bookings this way avoids DOUBLE COUNTING a
-- pending_payment booking (it has BOTH a row and an active hold — counted once,
-- via the hold) while still counting a confirmed booking (consumed hold) and a
-- pending_payment booking whose hold expired (no active hold ⇒ counted via the
-- booking, so an expired hold can never silently open an oversell here).
-- Expired holds (expires_at < now()) never count.
--
-- IDEMPOTENT on p_booking_id: re-reserving a booking that already holds an
-- active (or consumed) hold returns THAT hold, never a second one. A hold left
-- 'expired'/'released' is re-evaluated against capacity and reactivated in place
-- (booking_id is UNIQUE, so the row is reused).
--
-- SECURITY DEFINER (owner postgres, BYPASSRLS): reads bookings + capacity_holds
-- and writes capacity_holds regardless of RLS. search_path pinned to '' so the
-- body resolves only schema-qualified objects.
-- ============================================================================
create or replace function lumin.reserve_capacity(
  p_tenant_id  uuid,
  p_service_id uuid,
  p_slot_start timestamptz,
  p_slot_end   timestamptz,
  p_booking_id uuid,
  p_capacity   integer,
  p_ttl        interval
)
returns table (result text, hold_id uuid, hold_status text, hold_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hold_id     uuid;
  v_hold_status text;
  v_expires     timestamptz;
  v_consumers   integer;
begin
  if p_capacity is null or p_capacity < 1 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001',
      detail = 'capacity must be a positive integer';
  end if;
  if p_slot_start is null or p_slot_end is null or p_slot_end <= p_slot_start then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001',
      detail = 'slot_end must be after slot_start';
  end if;

  -- Serialize every concurrent reservation for THIS (tenant, service, slot).
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id::text || ':' || p_service_id::text || ':' || p_slot_start::text,
      0
    )
  );

  -- Idempotency: does this booking already own a hold row?
  select h.id, h.status, h.expires_at
    into v_hold_id, v_hold_status, v_expires
  from public.capacity_holds h
  where h.booking_id = p_booking_id;

  if found then
    if v_hold_status = 'active' and v_expires > now() then
      -- Re-reserve of a live hold: return the existing one, no new row.
      result := 'GRANTED'; hold_id := v_hold_id; hold_status := 'active'; hold_expires_at := v_expires;
      return next; return;
    elsif v_hold_status = 'consumed' then
      -- Booking already confirmed: capacity is permanently locked in for it.
      result := 'GRANTED'; hold_id := v_hold_id; hold_status := 'consumed'; hold_expires_at := v_expires;
      return next; return;
    end if;
    -- else 'expired' / 'released' (or an active hold that has passed its TTL):
    -- fall through, re-evaluate capacity, and reactivate the row in place.
  end if;

  -- Count consumers OTHER than this booking (see header for the model).
  select
    (
      select count(*)
      from public.capacity_holds h
      where h.tenant_id  = p_tenant_id
        and h.service_id = p_service_id
        and h.booking_id <> p_booking_id
        and h.status = 'active'
        and h.expires_at > now()
        and h.slot_start < p_slot_end
        and h.slot_end   > p_slot_start
    )
    +
    (
      select count(*)
      from public.bookings b
      where b.tenant_id = p_tenant_id
        and b.id <> p_booking_id
        and (b.selection ->> 'serviceId')::uuid = p_service_id
        and b.state in ('pending_payment', 'confirmed', 'completed')
        and b.slot_start < p_slot_end
        and b.slot_end   > p_slot_start
        and not exists (
          select 1
          from public.capacity_holds h2
          where h2.booking_id = b.id
            and h2.status = 'active'
            and h2.expires_at > now()
        )
    )
  into v_consumers;

  if v_consumers >= p_capacity then
    result := 'NO_CAPACITY'; hold_id := null; hold_status := null; hold_expires_at := null;
    return next; return;
  end if;

  if v_hold_id is not null then
    -- Reactivate the booking's existing (expired/released) hold row in place.
    update public.capacity_holds
      set status     = 'active',
          slot_start = p_slot_start,
          slot_end   = p_slot_end,
          hold_key   = encode(public.gen_random_bytes(16), 'hex'),
          expires_at = now() + p_ttl
      where id = v_hold_id
      returning id, status, expires_at into v_hold_id, v_hold_status, v_expires;
  else
    insert into public.capacity_holds
      (tenant_id, service_id, slot_start, slot_end, booking_id, hold_key, status, expires_at)
    values
      (p_tenant_id, p_service_id, p_slot_start, p_slot_end, p_booking_id,
       encode(public.gen_random_bytes(16), 'hex'), 'active', now() + p_ttl)
    returning id, status, expires_at into v_hold_id, v_hold_status, v_expires;
  end if;

  result := 'GRANTED'; hold_id := v_hold_id; hold_status := v_hold_status; hold_expires_at := v_expires;
  return next; return;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.consume_hold — active → consumed. Called when the booking is confirmed
-- (payment succeeded). Returns true iff a live active hold was consumed.
-- ----------------------------------------------------------------------------
create or replace function lumin.consume_hold(p_booking_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.capacity_holds
    set status = 'consumed'
    where booking_id = p_booking_id
      and status = 'active'
      and expires_at > now();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.release_hold — active → released. Called on payment failure/cancel so
-- the slot returns to the pool immediately (not waiting for TTL expiry).
-- ----------------------------------------------------------------------------
create or replace function lumin.release_hold(p_booking_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  update public.capacity_holds
    set status = 'released'
    where booking_id = p_booking_id
      and status = 'active';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- Function privileges: definer-only. anon/authenticated get NO execute (holds
-- are server-internal); the trusted runtime calls these as service_role via the
-- public wrappers below.
-- ----------------------------------------------------------------------------
revoke all on function lumin.reserve_capacity(uuid, uuid, timestamptz, timestamptz, uuid, integer, interval)
  from public, anon, authenticated;
revoke all on function lumin.consume_hold(uuid) from public, anon, authenticated;
revoke all on function lumin.release_hold(uuid) from public, anon, authenticated;

grant execute on function lumin.reserve_capacity(uuid, uuid, timestamptz, timestamptz, uuid, integer, interval)
  to service_role;
grant execute on function lumin.consume_hold(uuid) to service_role;
grant execute on function lumin.release_hold(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Thin public wrappers so PostgREST exposes the RPCs to the edge functions
-- (supabase-js .rpc() targets the `public` schema). SECURITY INVOKER: the
-- caller (service_role) still needs — and has — EXECUTE on the lumin function.
-- No anon/authenticated grants: unreachable from any client role.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_capacity(
  p_tenant_id  uuid,
  p_service_id uuid,
  p_slot_start timestamptz,
  p_slot_end   timestamptz,
  p_booking_id uuid,
  p_capacity   integer,
  p_ttl        interval
)
returns table (result text, hold_id uuid, hold_status text, expires_at timestamptz)
language sql
volatile
as $fn$
  select * from lumin.reserve_capacity(
    p_tenant_id, p_service_id, p_slot_start, p_slot_end, p_booking_id, p_capacity, p_ttl
  );
$fn$;

create or replace function public.consume_hold(p_booking_id uuid)
returns boolean language sql volatile as $fn$
  select lumin.consume_hold(p_booking_id);
$fn$;

create or replace function public.release_hold(p_booking_id uuid)
returns boolean language sql volatile as $fn$
  select lumin.release_hold(p_booking_id);
$fn$;

revoke all on function public.reserve_capacity(uuid, uuid, timestamptz, timestamptz, uuid, integer, interval)
  from public, anon, authenticated;
revoke all on function public.consume_hold(uuid) from public, anon, authenticated;
revoke all on function public.release_hold(uuid) from public, anon, authenticated;

grant execute on function public.reserve_capacity(uuid, uuid, timestamptz, timestamptz, uuid, integer, interval)
  to service_role;
grant execute on function public.consume_hold(uuid) to service_role;
grant execute on function public.release_hold(uuid) to service_role;

comment on table public.capacity_holds is
  'DB-authoritative capacity reservations (RC-3 F1). One short-TTL hold per booking; reserved atomically under a (tenant,service,slot) advisory lock by lumin.reserve_capacity BEFORE any Stripe intent is minted. Server-internal: RLS forced, no client policies/grants.';
