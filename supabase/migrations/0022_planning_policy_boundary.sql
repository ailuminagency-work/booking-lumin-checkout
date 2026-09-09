-- Explicit tentative-planning service boundary only. No allocator or auto opt-in.
-- Policy writes serialize with legacy reservations and booking consumers through
-- a table fence: absent policy rows cannot create a READ COMMITTED phantom gap.
begin;
create table public.allocation_policies (
 tenant_id uuid not null,
 service_id uuid not null,
 revision bigint not null check(revision between 1 and 9007199254740991),
 setup_minutes integer not null check(setup_minutes between 0 and 1440),
 cleanup_minutes integer not null check(cleanup_minutes between 0 and 1440),
 ttl_seconds integer not null check(ttl_seconds between 30 and 900),
 resource_mode text not null check(resource_mode in('none','linked')),
 primary key(tenant_id,service_id),
 foreign key(tenant_id,service_id) references public.services(tenant_id,id) on delete restrict on update restrict
);
alter table public.allocation_policies enable row level security;
alter table public.allocation_policies force row level security;
revoke all on public.allocation_policies from public,anon,authenticated,service_role;
comment on table public.allocation_policies is 'Explicit planning-only opt-in; no defaults, deletion or opt-out. Legacy paid checkout reservation is unavailable for opted services. No allocator is installed by this migration.';
create function lumin.planning_policy_identity() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'PLANNING_OPT_OUT_UNSUPPORTED' using errcode='0A000';end if;
 if new.tenant_id is distinct from old.tenant_id or new.service_id is distinct from old.service_id then raise exception 'PLANNING_IDENTITY_IMMUTABLE' using errcode='0A000';end if;
 return new;
end $$;
create trigger allocation_policy_identity before update or delete on public.allocation_policies for each row execute function lumin.planning_policy_identity();
-- Match PostgreSQL's accepted UUID syntax (including uppercase and braces).
-- Invalid legacy selections remain non-service selections; never cast unchecked.
create function lumin.planning_service_id(p_selection jsonb) returns uuid language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(p_selection->'serviceId') is distinct from 'string' then return null;end if;
 begin return (p_selection->>'serviceId')::uuid;exception when invalid_text_representation then return null;end;
end $$;
create function lumin.guard_planning_booking() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare old_service uuid;new_service uuid;old_consuming boolean:=false;
begin
 -- A row trigger already owns bookings RowExclusive: an inverted writer can
 -- deadlock with policy creation. PostgreSQL must abort that entire transaction.
 lock table public.allocation_policies in share mode;
 new_service:=lumin.planning_service_id(new.selection);
 if tg_op='UPDATE' then old_service:=lumin.planning_service_id(old.selection);old_consuming:=old.state in('pending_payment','confirmed','completed');end if;
 if new.state in('pending_payment','confirmed','completed') or old_consuming then
  if exists(select 1 from public.allocation_policies p where (p.tenant_id=new.tenant_id and p.service_id=new_service)
   or (tg_op='UPDATE' and p.tenant_id=old.tenant_id and p.service_id=old_service)) then
   raise exception 'PLANNING_ONLY_SERVICE' using errcode='0A000';
  end if;
 end if;
 return new;
end $$;
create trigger bookings_planning_boundary before insert or update on public.bookings for each row execute function lumin.guard_planning_booking();

create function public.save_allocation_policy(p_actor_id uuid,p_tenant_id uuid,p_service_id uuid,p_expected_revision bigint,p_setup_minutes integer,p_cleanup_minutes integer,p_ttl_seconds integer,p_resource_mode text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare rev bigint;
begin
 -- Fixed order, before any actor/service row locks. SHARE ROW EXCLUSIVE on the
 -- policy table conflicts with every guarded read, including an absent row.
 lock table public.allocation_policies in share row exclusive mode;
 lock table public.bookings,public.capacity_holds,public.service_resources,public.services in share mode;
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991
 or p_setup_minutes is null or p_setup_minutes not between 0 and 1440
 or p_cleanup_minutes is null or p_cleanup_minutes not between 0 and 1440
 or p_ttl_seconds is null or p_ttl_seconds not between 30 and 900
 or p_resource_mode is null or p_resource_mode not in('none','linked') then raise exception 'INVALID_POLICY' using errcode='22023';end if;
 perform 1 from public.services where tenant_id=p_tenant_id and id=p_service_id and active for share;
 if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode='P0002';end if;
 if (p_resource_mode='none' and exists(select 1 from public.service_resources where tenant_id=p_tenant_id and service_id=p_service_id))
 or (p_resource_mode='linked' and not exists(select 1 from public.service_resources where tenant_id=p_tenant_id and service_id=p_service_id)) then raise exception 'RESOURCE_MODE_CONFLICT' using errcode='22023';end if;
 if exists(select 1 from public.bookings b where b.tenant_id=p_tenant_id and lumin.planning_service_id(b.selection)=p_service_id and b.state in('pending_payment','confirmed','completed'))
 or exists(select 1 from public.capacity_holds h where (h.service_id=p_service_id or exists(select 1 from public.bookings b where b.id=h.booking_id and b.tenant_id=p_tenant_id and lumin.planning_service_id(b.selection)=p_service_id)) and (h.status='consumed' or (h.status='active' and h.expires_at>clock_timestamp()))) then raise exception 'EXISTING_CAPACITY_OBLIGATION' using errcode='40001';end if;
 if p_expected_revision=0 then
  insert into public.allocation_policies(tenant_id,service_id,revision,setup_minutes,cleanup_minutes,ttl_seconds,resource_mode) values(p_tenant_id,p_service_id,1,p_setup_minutes,p_cleanup_minutes,p_ttl_seconds,p_resource_mode);rev:=1;
 else
  update public.allocation_policies set revision=revision+1,setup_minutes=p_setup_minutes,cleanup_minutes=p_cleanup_minutes,ttl_seconds=p_ttl_seconds,resource_mode=p_resource_mode where tenant_id=p_tenant_id and service_id=p_service_id and revision=p_expected_revision returning revision into rev;
  if not found then raise exception 'POLICY_REVISION_CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('serviceId',p_service_id,'revision',rev,'setupMinutes',p_setup_minutes,'cleanupMinutes',p_cleanup_minutes,'ttlSeconds',p_ttl_seconds,'resourceMode',p_resource_mode,'planningOnly',true);
end $$;
revoke all on function lumin.planning_policy_identity(),lumin.planning_service_id(jsonb),lumin.guard_planning_booking(),public.save_allocation_policy(uuid,uuid,uuid,bigint,integer,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.save_allocation_policy(uuid,uuid,uuid,bigint,integer,integer,integer,text) to service_role;

-- Exact accepted 0014 implementation, private; non-opted behavior is retained.
create function lumin.reserve_capacity_nonplanning(
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
revoke all on function lumin.reserve_capacity_nonplanning(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval) from public,anon,authenticated,service_role;
create or replace function lumin.reserve_capacity(p_tenant_id uuid,p_service_id uuid,p_slot_start timestamptz,p_slot_end timestamptz,p_booking_id uuid,p_capacity integer,p_ttl interval)
returns table(result text,hold_id uuid,hold_status text,hold_expires_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare actual_booking public.bookings;
begin
 lock table public.allocation_policies in share mode;
 select * into actual_booking from public.bookings where id=p_booking_id for share;
 -- Canonical service IDs are globally unique. Do not let caller tenant/service
 -- mismatches or the legacy existing-hold retry bypass an opted actual identity.
 if exists(select 1 from public.allocation_policies p where p.service_id=p_service_id
  or (p.tenant_id=actual_booking.tenant_id and p.service_id=lumin.planning_service_id(actual_booking.selection))
  or exists(select 1 from public.capacity_holds h where h.booking_id=p_booking_id and h.service_id=p.service_id)) then raise exception 'PLANNING_ONLY_SERVICE' using errcode='0A000';end if;
 return query select * from lumin.reserve_capacity_nonplanning(p_tenant_id,p_service_id,p_slot_start,p_slot_end,p_booking_id,p_capacity,p_ttl);
end $$;
-- Existing public.reserve_capacity wrapper retains the original function OID and
-- therefore passes through this guard; no new public/private bypass is granted.
commit;
