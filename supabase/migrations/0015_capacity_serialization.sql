-- 0015_capacity_serialization.sql
-- Different-start overlapping slots (and timezone-dependent timestamp casts)
-- previously acquired different locks and could both consume final capacity.
-- Serialize on stable tenant + service/resource identifiers, never slot text.
-- Distinct namespaces prevent service/resource keys sharing the same input.
-- 64-bit hash collisions may serialize unrelated keys, never permit overselling.
-- Tradeoff: even disjoint intervals for one tenant+carrier serialize until COMMIT.
-- Keep reservation transactions short. This favors correctness over throughput.
-- READ COMMITTED is the supported reservation isolation level (existing runtime).
-- CREATE OR REPLACE preserves signatures, security-definer settings and ACLs.
-- Earlier migrations are immutable; no other reservation semantics change.

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

  -- Serialize every concurrent reservation for THIS (tenant, service), across all intervals.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'lumin:service-capacity:' || p_tenant_id::text || ':' || p_service_id::text,
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

  -- Serialize every concurrent reservation for THIS (tenant, resource), across all intervals.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'lumin:resource-capacity:' || p_tenant_id::text || ':' || p_resource_id::text,
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
