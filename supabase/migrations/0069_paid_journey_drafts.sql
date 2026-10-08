-- Separate journey authoring only; no change to deployed render/financial paths.
begin;
create function lumin.paid_journey_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare s jsonb;ids text[]:='{}';kinds text[]:='{}';positions jsonb:='{}';i integer:=0;k text;id text;label text;
begin
 if p is null or jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>2 or not(p ?& array['schemaVersion','stages'])
 or p->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p->'stages') is distinct from 'array' then return false;end if;
 if jsonb_array_length(p->'stages') not between 6 and 16 or octet_length(p::text)>8192 then return false;end if;
 for s in select value from jsonb_array_elements(p->'stages') loop
  i:=i+1;
  if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>4 or not(s ?& array['id','kind','label','enabled'])
  or jsonb_typeof(s->'id') is distinct from 'string' or jsonb_typeof(s->'kind') is distinct from 'string'
  or jsonb_typeof(s->'label') is distinct from 'string' or jsonb_typeof(s->'enabled') is distinct from 'boolean' then return false;end if;
  id:=s->>'id';k:=s->>'kind';label:=s->>'label';
  if id=any(ids) or id !~ '^[a-z][a-z0-9_]{0,63}$' or id in('__proto__','constructor','prototype')
  or lumin.utf16_length(label) not between 1 and 80 or label ~ U&'[\0001-\001f\007f-\009f]'
  or length(btrim(label,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))=0 then return false;end if;
  ids:=array_append(ids,id);
  if k='informational' then
   if id not like 'informational_%' or substring(id from 1 for 14)<>'informational_' then return false;end if;
  elsif k in('service','options','schedule','information','review_payment','confirmation') then
   if id<>k or k=any(kinds) or (k<>'options' and s->'enabled'<>'true'::jsonb) then return false;end if;
   kinds:=array_append(kinds,k);positions:=positions||jsonb_build_object(k,i);
  else return false;end if;
 end loop;
 if cardinality(kinds)<>6 or (positions->>'service')::integer<>1 or (positions->>'confirmation')::integer<>i
 or (positions->>'options')::integer>=least((positions->>'schedule')::integer,(positions->>'information')::integer)
 or (positions->>'review_payment')::integer<=greatest((positions->>'schedule')::integer,(positions->>'information')::integer) then return false;end if;
 i:=0;for s in select value from jsonb_array_elements(p->'stages') loop
  i:=i+1;if s->>'kind'='informational' and (i<=(positions->>'options')::integer or i>=(positions->>'review_payment')::integer) then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function lumin.paid_journey_valid(jsonb) from public,anon,authenticated,service_role;

create table public.paid_journey_drafts(
 flow_id uuid primary key,tenant_id uuid not null references public.tenants(id),service_id uuid not null,
 schema_version integer not null default 1 check(schema_version=1),revision bigint not null check(revision between 1 and 9007199254740991),
 name text not null check(lumin.utf16_length(name) between 1 and 200 and name=btrim(name)),
 accent_color text not null check(accent_color in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c')),
 layout text not null check(layout in('stacked','compact')),journey jsonb not null check(lumin.paid_journey_valid(journey)),
 foreign key(tenant_id,service_id) references public.services(tenant_id,id),unique(tenant_id,flow_id)
);
alter table public.paid_journey_drafts enable row level security;
alter table public.paid_journey_drafts force row level security;
revoke all on public.paid_journey_drafts from public,anon,authenticated,service_role;

create function lumin.paid_journey_service(p_tenant uuid,p_service uuid,p_journey jsonb) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform 1 from public.business_profiles where tenant_id=p_tenant and business_type='HOUSEKEEPING' for share;
 if not found then raise exception 'UNSUPPORTED_PROFILE' using errcode='0A000';end if;
 -- This locks and derives eligibility from stored catalog, rejecting all questions,
 -- add-ons, item prices and resources. Therefore optionsRequired is false here.
 perform lumin.paid_simple_service(p_tenant,p_service);
 -- No field/consent binding exists for this new representation yet. Never assume
 -- arbitrary informational stages are harmless or omit a required definition.
 if exists(select 1 from jsonb_array_elements(p_journey->'stages') s where s->>'kind'='informational') then raise exception 'UNBOUND_INFORMATIONAL_STAGE' using errcode='0A000';end if;
end $$;
revoke all on function lumin.paid_journey_service(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.save_paid_journey_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_presentation jsonb,p_journey jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare next_revision bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991
 or p_name is null or lumin.utf16_length(btrim(p_name)) not between 1 and 200 or not lumin.paid_journey_valid(p_journey)
 or p_presentation is null or jsonb_typeof(p_presentation)<>'object' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_presentation))<>2 or not(p_presentation ?& array['accentColor','layout'])
 or jsonb_typeof(p_presentation->'accentColor') is distinct from 'string' or jsonb_typeof(p_presentation->'layout') is distinct from 'string'
 or p_presentation->>'accentColor' not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c')
 or p_presentation->>'layout' not in('stacked','compact') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.paid_journey_service(p_tenant,p_service,p_journey);
 if p_expected_revision=0 then
  insert into public.paid_journey_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout,journey)
  values(p_flow,p_tenant,p_service,1,btrim(p_name),p_presentation->>'accentColor',p_presentation->>'layout',p_journey) returning revision into next_revision;
 else
  update public.paid_journey_drafts set service_id=p_service,revision=revision+1,name=btrim(p_name),accent_color=p_presentation->>'accentColor',layout=p_presentation->>'layout',journey=p_journey
  where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'flowId',p_flow,'revision',next_revision);
end $$;

create function public.get_paid_journey_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_journey_drafts;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into d from public.paid_journey_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_journey_service(p_tenant,d.service_id,d.journey);
 return jsonb_build_object('schemaVersion',d.schema_version,'tenantId',d.tenant_id,'flowId',d.flow_id,'serviceId',d.service_id,'revision',d.revision,'name',d.name,
 'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout),'journey',d.journey);
end $$;
revoke all on function public.save_paid_journey_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb,jsonb),public.get_paid_journey_draft(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_paid_journey_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb,jsonb),public.get_paid_journey_draft(uuid,uuid,uuid) to service_role;
commit;
