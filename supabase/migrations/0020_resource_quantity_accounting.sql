-- W4 prerequisite only: shared unit accounting for old and new resource writers.
-- No booking confirmation, worker allocation, payment, or public client grant.
begin;
alter table public.resource_reservations
 add column quantity integer not null default 1 check (quantity > 0);

create function lumin.reserve_resource_quantity(
 p_tenant_id uuid,p_resource_id uuid,p_slot_start timestamptz,p_slot_end timestamptz,
 p_booking_id uuid,p_ttl interval,p_quantity integer
) returns table(result text,reservation_id uuid,reservation_status text,reservation_expires_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare cap integer; active_resource boolean; old public.resource_reservations%rowtype;
 used bigint; current_time_value timestamptz;
begin
 if p_tenant_id is null or p_resource_id is null or p_booking_id is null
 or p_slot_start is null or p_slot_end is null or not isfinite(p_slot_start) or not isfinite(p_slot_end)
 or p_slot_end<=p_slot_start or p_quantity is null or p_quantity<1
 or p_ttl is null or p_ttl<=interval '0' then
  raise exception 'INVALID_REQUEST' using errcode='22023';
 end if;
 -- Same namespace as 0014: legacy and quantity-aware writers serialize together.
 perform pg_advisory_xact_lock(hashtextextended('lumin:resource-capacity:'||p_tenant_id::text||':'||p_resource_id::text,0));
 select r.capacity,r.active into cap,active_resource from public.resources r
 where r.id=p_resource_id and r.tenant_id=p_tenant_id for share;
 if not found or active_resource is not true then
  return query select 'NO_CAPACITY'::text,null::uuid,null::text,null::timestamptz;return;
 end if;
 -- The primitive is server-only; reject a foreign booking even on a retry.
 if not exists(select 1 from public.bookings b where b.id=p_booking_id and b.tenant_id=p_tenant_id) then
  raise exception 'INVALID_BOOKING' using errcode='23503';
 end if;
 select rr.* into old from public.resource_reservations rr
 where rr.tenant_id=p_tenant_id and rr.resource_id=p_resource_id and rr.booking_id=p_booking_id for update;
 if found and (old.status='consumed' or (old.status='held' and old.expires_at>clock_timestamp())) then
  if old.slot_start is distinct from p_slot_start or old.slot_end is distinct from p_slot_end or old.quantity is distinct from p_quantity then
   raise exception 'RESERVATION_CONFLICT' using errcode='40001';
  end if;
  return query select 'GRANTED'::text,old.id,old.status,old.expires_at;return;
 end if;
 -- Half-open intervals. Expired held rows do not consume units; consumed rows do.
 -- Row locking above can wait after the advisory lock; refresh after both waits.
 current_time_value:=clock_timestamp();
 select coalesce(sum(rr.quantity),0) into used from public.resource_reservations rr
 where rr.tenant_id=p_tenant_id and rr.resource_id=p_resource_id and rr.booking_id<>p_booking_id
 and (rr.status='consumed' or (rr.status='held' and rr.expires_at>current_time_value))
 and rr.slot_start<p_slot_end and rr.slot_end>p_slot_start;
 if used+p_quantity::bigint>cap::bigint then
  return query select 'NO_CAPACITY'::text,null::uuid,null::text,null::timestamptz;return;
 end if;
 current_time_value:=clock_timestamp();
 if old.id is null then
  insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity)
  values(p_tenant_id,p_resource_id,p_booking_id,p_slot_start,p_slot_end,encode(public.gen_random_bytes(16),'hex'),'held',current_time_value+p_ttl,p_quantity)
  returning * into old;
 else
  update public.resource_reservations rr set status='held',slot_start=p_slot_start,slot_end=p_slot_end,
   hold_key=encode(public.gen_random_bytes(16),'hex'),expires_at=current_time_value+p_ttl,quantity=p_quantity
  where rr.id=old.id returning rr.* into old;
 end if;
 return query select 'GRANTED'::text,old.id,old.status,old.expires_at;
end $$;
revoke all on function lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer) from public,anon,authenticated;
grant execute on function lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer) to service_role;

-- Preserve the accepted six-argument signature and result shape, delegating one unit.
create or replace function lumin.reserve_resource(
 p_tenant_id uuid,p_resource_id uuid,p_slot_start timestamptz,p_slot_end timestamptz,p_booking_id uuid,p_ttl interval
) returns table(result text,reservation_id uuid,reservation_status text,reservation_expires_at timestamptz)
language sql volatile security definer set search_path='' as $$
 select * from lumin.reserve_resource_quantity(p_tenant_id,p_resource_id,p_slot_start,p_slot_end,p_booking_id,p_ttl,1)
$$;
comment on column public.resource_reservations.quantity is 'Positive reserved units. Existing rows and legacy reserve_resource callers consume one unit. Server orchestration must derive requested quantities from trusted service requirements.';
commit;
