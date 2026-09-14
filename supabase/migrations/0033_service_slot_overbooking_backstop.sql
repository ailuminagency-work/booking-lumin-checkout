-- ============================================================================
-- 0033_service_slot_overbooking_backstop.sql — P0 OB-STRUCT, service-slot half.
--
-- Forward-only migration (Postgres 16 / Supabase). Does NOT edit 0001-0032.
--
-- THE AUDIT FINDING (P0 OB-STRUCT, capacity-slot bookings): 0031 closed the
-- RESOURCE half structurally (a btree_gist EXCLUDE on exclusive
-- resource_reservations) but explicitly DEFERRED the SERVICE-slot half (see the
-- NOTE at the foot of 0031). Two state='confirmed' bookings could be written on
-- ONE capacity-1 service slot with NO reserve_capacity call — a direct SQL
-- insert, an authenticated portal user flipping pending_payment->confirmed, or
-- any writer that bypasses lumin.reserve_capacity / lumin.consume_hold — was not
-- structurally prevented. The reserve RPC path is correct under concurrency, but
-- nothing behind it forced a confirmed booking to have gone through it.
--
-- THE FIX (defense-in-depth, caller-independent): a BEFORE INSERT/UPDATE trigger
-- on public.bookings that, at the moment a booking transitions INTO
-- state='confirmed', REQUIRES a CONSUMED capacity_hold for that booking — but
-- ONLY for services the operator has declared capacity-managed
-- (services.capacity_limited = true). Because a consumed hold can be minted only
-- by lumin.consume_hold (0010, definer-only) after lumin.reserve_capacity
-- GRANTED it, and reserve_capacity refuses to grant beyond p_capacity under a
-- per-(tenant,service,slot) advisory lock while counting BOTH active holds and
-- hold-less occupied bookings, the chain is:
--
--     confirmed  ⇒ consumed hold exists            (this trigger)
--     consumed hold ⇒ went through reserve_capacity (0010 consume_hold)
--     reserve_capacity ⇒ ≤ capacity consumers       (0010 advisory-lock count)
--   ⟹ at most `capacity` confirmed bookings per slot, structurally, for any
--     writer or role. A rogue direct-insert of a confirmed booking (or an
--     authenticated flip to confirmed) with no consumed hold is REJECTED.
--
-- WHY A PER-SERVICE MARKER, DEFAULT FALSE (non-breaking; respects the 0031
-- NOTE): "capacity-limited" is not a static property the schema already carries
-- — a slot's capacity lives in availability_rules per weekday/time, not on the
-- service row — so the rule must be gated by an explicit, operator-declared
-- flag. It defaults FALSE so that every service created before this migration
-- (including the ones the RLS / financial security suites insert confirmed
-- bookings against DIRECTLY, with no hold) is EXEMPT and those suites pass
-- unchanged. Onboarding / service configuration sets capacity_limited = true for
-- a service whose slots must admit at most `capacity` bookings; only then does
-- the structural requirement apply.
--
-- WHY NO FIXTURE BACKFILL FOR EXISTING CONFIRMED ROWS: the trigger fires ONLY on
-- the transition INTO confirmed (an INSERT that lands as confirmed, or an UPDATE
-- whose OLD.state was not already confirmed). It never fires on an already-
-- confirmed row, nor on the legal transitions OUT of confirmed (completed /
-- cancelled / refunded). So pre-existing confirmed bookings — which may predate
-- capacity_holds (0010) entirely — are grandfathered and need no synthetic hold.
--
-- RLS / grants: unchanged. No new policy; capacity_holds stays service_role
-- SELECT-only (0024) and the trigger reads it as SECURITY DEFINER. The new
-- services column inherits the services table ACLs and loosens nothing.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Operator-declared capacity-managed marker. DEFAULT false ⇒ additive and
--    non-breaking: every existing service (and every existing/seed confirmed
--    booking) is exempt until an operator opts a service in.
-- ----------------------------------------------------------------------------
alter table public.services
  add column capacity_limited boolean not null default false;

comment on column public.services.capacity_limited is
  'Operator-declared: true iff this service''s slots admit at most `capacity` '
  'bookings and must be reserved through lumin.reserve_capacity. When true, '
  'lumin.enforce_confirmed_requires_hold structurally requires a CONSUMED '
  'capacity_hold for any booking transitioning into state=confirmed (P0 '
  'OB-STRUCT service-slot backstop, the counterpart to 0031''s resource EXCLUDE). '
  'Default false ⇒ backward-compatible; existing services/bookings are exempt.';

-- ----------------------------------------------------------------------------
-- 2. The backstop trigger. Fires ONLY on the transition INTO confirmed, and
--    only for a capacity_limited service; then a CONSUMED capacity_hold for the
--    booking must exist, or the write raises.
--
--    Service resolution is by TEXT comparison against selection->>'serviceId'
--    (bookings carry the service inside the selection jsonb, not a column), so a
--    null/malformed serviceId simply matches no service ⇒ v_limited stays NULL ⇒
--    treated as NOT capacity_limited (fail-open for the marker lookup, never for
--    a resolved capacity_limited service). tenant_id is pinned as defense.
--
--    SECURITY DEFINER + search_path='' so it can always read public.services and
--    public.capacity_holds regardless of the invoking role — an authenticated
--    portal user has NO grant on capacity_holds (0024), so a SECURITY INVOKER
--    trigger would raise permission_denied instead of the intended check. No
--    role is exempt from the requirement itself (mirrors the 0005 transition
--    guard): the definer only lifts the READ privilege, not the rule.
-- ----------------------------------------------------------------------------
create or replace function lumin.enforce_confirmed_requires_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_limited boolean;
begin
  -- Only the transition INTO confirmed is gated. INSERT-as-confirmed (rogue
  -- direct write) and UPDATE pending_payment->confirmed both qualify; an already
  -- confirmed row and every transition OUT of confirmed are untouched.
  if new.state <> 'confirmed'
     or (tg_op = 'UPDATE' and old.state is not distinct from 'confirmed') then
    return new;
  end if;

  select s.capacity_limited into v_limited
    from public.services s
   where s.id::text = new.selection ->> 'serviceId'
     and s.tenant_id = new.tenant_id;

  if coalesce(v_limited, false) then
    if not exists (
      select 1
        from public.capacity_holds h
       where h.booking_id = new.id
         and h.status = 'consumed'
    ) then
      raise exception 'CONFIRMED_WITHOUT_CAPACITY_HOLD'
        using errcode = 'P0001',
              detail  = 'a capacity_limited service may reach state=confirmed '
                        || 'only via a reserved+consumed capacity_hold '
                        || '(lumin.reserve_capacity -> lumin.consume_hold)';
    end if;
  end if;

  return new;
end;
$fn$;

revoke all on function lumin.enforce_confirmed_requires_hold()
  from public, anon, authenticated;

-- AFTER the transition guard alphabetically ('c' > 'b'...'enforce_transition'),
-- but ordering is immaterial: this is a validate-only BEFORE trigger that either
-- raises or returns NEW unchanged, and it inspects no column another trigger
-- rewrites (state/selection are frozen for clients by guard_booking_client_write).
create trigger bookings_enforce_confirmed_requires_hold
  before insert or update on public.bookings
  for each row execute function lumin.enforce_confirmed_requires_hold();

comment on function lumin.enforce_confirmed_requires_hold() is
  'P0 OB-STRUCT (service-slot half): a booking for a capacity_limited service '
  'may transition INTO state=confirmed only when a CONSUMED capacity_hold exists '
  'for it, forcing every confirm through lumin.reserve_capacity/consume_hold so '
  'the advisory-lock capacity count caps confirmed bookings per slot. Fires only '
  'on the into-confirmed transition; existing/out-of-confirmed rows untouched.';

commit;
