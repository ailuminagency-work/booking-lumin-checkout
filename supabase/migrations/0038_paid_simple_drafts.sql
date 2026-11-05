-- Owner authoring persistence only. No publication or customer authority.
begin;
create table public.paid_simple_drafts (
 flow_id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 service_id uuid not null,
 revision bigint not null check(revision between 1 and 9007199254740991),
 name text not null check(length(name) between 1 and 200 and name=btrim(name)),
 accent_color text not null check(accent_color in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c')),
 layout text not null check(layout in('stacked','compact')),
 unique(tenant_id,flow_id),
 foreign key(tenant_id,service_id) references public.services(tenant_id,id)
);
alter table public.paid_simple_drafts enable row level security;
alter table public.paid_simple_drafts force row level security;
revoke all on public.paid_simple_drafts from public,anon,authenticated,service_role;

create function public.save_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_accent_color text,p_layout text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare next_revision bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991
 or p_name is null or length(btrim(p_name)) not between 1 and 200
 or p_accent_color is null or p_accent_color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c')
 or p_layout is null or p_layout not in('stacked','compact') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.paid_simple_service(p_tenant,p_service);
 if p_expected_revision=0 then
  insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout)
  values(p_flow,p_tenant,p_service,1,btrim(p_name),p_accent_color,p_layout);next_revision:=1;
 else
  update public.paid_simple_drafts set service_id=p_service,revision=revision+1,name=btrim(p_name),accent_color=p_accent_color,layout=p_layout
   where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('flowId',p_flow,'revision',next_revision);
end $$;

create function public.get_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_simple_service(p_tenant,d.service_id);
 return jsonb_build_object('flowId',d.flow_id,'revision',d.revision,'serviceId',d.service_id,'name',d.name,
  'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout));
end $$;
revoke all on function public.save_paid_simple_draft(uuid,uuid,uuid,uuid,bigint,text,text,text),public.get_paid_simple_draft(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_paid_simple_draft(uuid,uuid,uuid,uuid,bigint,text,text,text),public.get_paid_simple_draft(uuid,uuid,uuid) to service_role;
commit;
