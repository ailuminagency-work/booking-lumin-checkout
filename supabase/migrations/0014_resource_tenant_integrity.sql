-- Additive correction for 0012: RLS on a child row does not validate FK tenancy.
-- No data is repaired or deleted. Existing invalid relationships block migration.
begin;

-- Prevent writes between preflight and constraint installation. Deploy during a
-- controlled migration window; transaction failure releases all locks/DDL.
lock table public.services, public.resources, public.bookings,
  public.service_resources, public.service_areas, public.resource_reservations
  in share row exclusive mode;

do $preflight$
begin
  if exists (
    select 1 from public.service_resources sr
    join public.services s on s.id = sr.service_id
    join public.resources r on r.id = sr.resource_id
    where sr.tenant_id <> s.tenant_id or sr.tenant_id <> r.tenant_id
  ) or exists (
    select 1 from public.service_areas a
    join public.services s on s.id = a.service_id
    where a.tenant_id <> s.tenant_id
  ) or exists (
    select 1 from public.resource_reservations rr
    join public.resources r on r.id = rr.resource_id
    join public.bookings b on b.id = rr.booking_id
    where rr.tenant_id <> r.tenant_id or rr.tenant_id <> b.tenant_id
  ) then
    raise exception 'RESOURCE_TENANT_INTEGRITY_PREFLIGHT_FAILED'
      using errcode = '23503',
      detail = 'Existing resource relationships cross tenant boundaries; migration made no data repairs.';
  end if;
end;
$preflight$;

alter table public.services add constraint services_tenant_id_id_key unique (tenant_id, id);
alter table public.resources add constraint resources_tenant_id_id_key unique (tenant_id, id);
alter table public.bookings add constraint bookings_tenant_id_id_key unique (tenant_id, id);

alter table public.service_resources
  add constraint service_resources_tenant_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade,
  add constraint service_resources_tenant_resource_fk foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete cascade;

-- MATCH SIMPLE preserves tenant-wide areas whose service_id is NULL.
alter table public.service_areas
  add constraint service_areas_tenant_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade;

-- Trusted server writers must obey the same relationship integrity as clients.
alter table public.resource_reservations
  add constraint resource_reservations_tenant_resource_fk foreign key (tenant_id, resource_id)
    references public.resources (tenant_id, id) on delete cascade,
  add constraint resource_reservations_tenant_booking_fk foreign key (tenant_id, booking_id)
    references public.bookings (tenant_id, id) on delete cascade;

commit;
