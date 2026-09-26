-- A child catalog row must belong to the same tenant as its service. Existing
-- single-column FKs and RLS do not establish that relationship. Fail closed on
-- historical mismatches; investigation/repair is a separate, reviewed action.
begin;

lock table public.services, public.service_items, public.service_addons,
  public.service_questions in share row exclusive mode;

do $preflight$
begin
  if exists (
    select 1 from public.service_items c
    join public.services s on s.id = c.service_id
    where c.tenant_id <> s.tenant_id
  ) or exists (
    select 1 from public.service_addons c
    join public.services s on s.id = c.service_id
    where c.tenant_id <> s.tenant_id
  ) or exists (
    select 1 from public.service_questions c
    join public.services s on s.id = c.service_id
    where c.tenant_id <> s.tenant_id
  ) then
    raise exception 'SERVICE_CHILD_TENANT_INTEGRITY_PREFLIGHT_FAILED'
      using errcode = '23503',
      detail = 'Existing service children cross tenant boundaries; no data was changed.';
  end if;
end;
$preflight$;

-- services(tenant_id,id) is unique since 0014. Keep delete cascades from the
-- original service_id FKs when adding tenant-aware constraints alongside them.
alter table public.service_items
  add constraint service_items_tenant_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade;

alter table public.service_addons
  add constraint service_addons_tenant_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade;

alter table public.service_questions
  add constraint service_questions_tenant_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade;

commit;
