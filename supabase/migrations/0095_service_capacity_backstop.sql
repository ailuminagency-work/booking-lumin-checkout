-- 0095_service_capacity_backstop.sql — R1b service-capacity confirmation guard.
--
-- Forward-only staging migration. A service that participates in the
-- availability schedule may only reach `confirmed` with a matching consumed
-- capacity_holds row. The reserve/consume path remains the authority for
-- creating that row; this trigger closes the privileged direct-write backdoor
-- that previously allowed a caller to insert or confirm an overbooking without
-- any capacity hold at all.
--
-- Unscheduled simple services retain the historical direct-write fixture
-- behavior. Rental services retain their separate resource-reservation
-- confirmation authority from 0033. No client grant or client confirmation
-- path is added by this migration.

begin;

-- Parse the server-owned service identifier without making malformed legacy
-- fixture selections fail at INSERT time. The confirmation guard below fails
-- closed when a scheduled tenant has no usable service identifier.
create or replace function lumin.booking_service_id(p_selection jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $fn$
begin
  if p_selection is null
     or jsonb_typeof(p_selection) is distinct from 'object'
     or jsonb_typeof(p_selection->'serviceId') is distinct from 'string' then
    return null;
  end if;

  begin
    return (p_selection->>'serviceId')::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$fn$;

revoke all on function lumin.booking_service_id(jsonb)
  from public, anon, authenticated, service_role;

-- Every confirmation writer (including service_role/direct SQL) reaches this
-- trigger. SECURITY DEFINER is intentional: forced RLS must not turn the
-- backstop into a role-dependent check.
create or replace function lumin.enforce_service_capacity_confirmation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $fn$
declare
  v_service_id uuid;
  v_old_service_id uuid;
  v_archetype text;
  v_scheduled boolean;
begin
  if new.state is distinct from 'confirmed' then
    return new;
  end if;

  v_service_id := lumin.booking_service_id(new.selection);

  -- A confirmed booking cannot be retargeted to another service or tenant,
  -- even by service_role. This comparison is deliberately performed before
  -- the schedule lookup so a mutation from a scheduled service to an
  -- unscheduled one cannot escape the authority check. Same-state updates that
  -- keep identity/slot intact still run the complete authority validation.
  if tg_op = 'UPDATE' and old.state = 'confirmed' and new.state = 'confirmed' then
    v_old_service_id := lumin.booking_service_id(old.selection);
    if new.tenant_id is distinct from old.tenant_id
       or v_service_id is distinct from v_old_service_id then
      raise exception 'CONFIRMATION_HOLD_INVALID'
        using errcode = '40001',
              detail = 'confirmed booking identity and service scope are immutable';
    end if;
  end if;

  -- Rental confirmations are guarded by resource_reservations in 0033. Keep
  -- that authority caller-independent as well: a direct rental confirmation
  -- must carry the complete consumed resource set for the service, with exact
  -- slot and quantity matches.
  select s.archetype
    into v_archetype
    from public.services s
   where s.id = v_service_id
     and s.tenant_id = new.tenant_id;
  if v_archetype = 'rental' then
    if not exists (
      select 1 from public.service_resources sr
       where sr.tenant_id = new.tenant_id and sr.service_id = v_service_id
    )
    or exists (
      select 1
        from public.service_resources sr
        left join public.resources r
          on r.id = sr.resource_id
         and r.tenant_id = sr.tenant_id
        left join public.resource_reservations rr
          on rr.tenant_id = sr.tenant_id
         and rr.resource_id = sr.resource_id
         and rr.booking_id = new.id
       where sr.tenant_id = new.tenant_id
         and sr.service_id = v_service_id
         and (r.id is null
              or r.active is not true
              or r.capacity < sr.quantity_required
              or rr.id is null
              or rr.status is distinct from 'consumed'
              or rr.slot_start is distinct from new.slot_start
              or rr.slot_end is distinct from new.slot_end
              or rr.quantity is distinct from sr.quantity_required)
    )
    or exists (
      select 1
        from public.resource_reservations rr
       where rr.tenant_id = new.tenant_id
         and rr.booking_id = new.id
         and not exists (
           select 1 from public.service_resources sr
            where sr.tenant_id = new.tenant_id
              and sr.service_id = v_service_id
              and sr.resource_id = rr.resource_id
         )
    ) then
      raise exception 'CONFIRMATION_HOLD_INVALID'
        using errcode = '40001',
              detail = 'rental confirmations require the complete matching consumed resource reservation set';
    end if;
    return new;
  end if;

  -- A service-specific rule/override or a tenant-wide rule/override marks the
  -- service as scheduled/capacity-controlled. If serviceId is malformed or
  -- absent, fail closed whenever the tenant has any schedule at all.
  if v_service_id is null then
    select exists (
             select 1 from public.availability_rules ar
              where ar.tenant_id = new.tenant_id
           )
        or exists (
             select 1 from public.availability_overrides ao
              where ao.tenant_id = new.tenant_id
           )
      into v_scheduled;
  else
    select exists (
             select 1 from public.availability_rules ar
              where ar.tenant_id = new.tenant_id
                and (ar.service_id = v_service_id or ar.service_id is null)
           )
        or exists (
             select 1 from public.availability_overrides ao
              where ao.tenant_id = new.tenant_id
                and (ao.service_id = v_service_id or ao.service_id is null)
           )
      into v_scheduled;
  end if;

  if not v_scheduled then
    return new;
  end if;

  if v_service_id is null
     or not exists (
       select 1
         from public.capacity_holds h
        where h.booking_id = new.id
          and h.tenant_id = new.tenant_id
          and h.service_id = v_service_id
          and h.slot_start = new.slot_start
          and h.slot_end = new.slot_end
          and h.status = 'consumed'
     ) then
    raise exception 'CONFIRMATION_HOLD_INVALID'
      using errcode = '40001',
            detail = 'scheduled service confirmations require a matching consumed capacity hold';
  end if;

  return new;
end;
$fn$;

revoke all on function lumin.enforce_service_capacity_confirmation()
  from public, anon, authenticated, service_role;

-- PostgreSQL evaluates same-event triggers by name. `require` sorts after the
-- RC-2 `guard` trigger, preserving FORBIDDEN for authenticated portal writes,
-- and after the transition trigger, preserving ILLEGAL_TRANSITION for invalid
-- state edges. Trusted service-role/direct writes still reach this guard.
create trigger bookings_require_service_capacity_hold
  before insert or update on public.bookings
  for each row execute function lumin.enforce_service_capacity_confirmation();

comment on function lumin.enforce_service_capacity_confirmation() is
  'R1b: scheduled non-rental bookings may enter confirmed only with a matching consumed capacity_holds row; runtime confirmation remains the hold creator.';

commit;

