-- V7 is Detailing. V8 is a separate immutable journey family; no customer writer.
begin;
create function lumin.paid_journey_snapshot_valid(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare form jsonb;s jsonb;price jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p))<>6 or not(p ?& array['renderSchemaVersion','submissionMode','paymentMode','simulated','service','form'])
 or p->'renderSchemaVersion' is distinct from '8'::jsonb or p->>'submissionMode' is distinct from 'paid_journey_request'
 or p->>'paymentMode' is distinct from 'staging_mock' or p->'simulated' is distinct from 'true'::jsonb then return false;end if;
 form:=p->'form';s:=p->'service';price:=s->'price';
 if jsonb_typeof(form) is distinct from 'object' or jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(price) is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(form))<>3 or not(form ?& array['name','presentation','journey'])
 or jsonb_typeof(form->'name') is distinct from 'string' or lumin.utf16_length(form->>'name') not between 1 and 200
 or jsonb_typeof(form->'presentation') is distinct from 'object' or not lumin.paid_journey_valid(form->'journey') then return false;end if;
 if form->>'name' ~ U&'[\0001-\001f\007f-\009f]' or length(btrim(form->>'name',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))=0
 or form->>'name'<>btrim(form->>'name',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
 or exists(select 1 from jsonb_array_elements(form#>'{journey,stages}') stage where stage->>'kind'='informational') then return false;end if;
 if (select count(*) from jsonb_object_keys(form->'presentation'))<>2 or not((form->'presentation') ?& array['accentColor','layout'])
 or jsonb_typeof(form#>'{presentation,accentColor}') is distinct from 'string' or jsonb_typeof(form#>'{presentation,layout}') is distinct from 'string'
 or form#>>'{presentation,accentColor}' not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or form#>>'{presentation,layout}' not in('stacked','compact') then return false;end if;
 if (select count(*) from jsonb_object_keys(s))<>4 or not(s ?& array['id','name','durationMinutes','price'])
 or jsonb_typeof(s->'id') is distinct from 'string' or s->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or jsonb_typeof(s->'name') is distinct from 'string' or lumin.utf16_length(s->>'name') not between 1 and 200
 or jsonb_typeof(s->'durationMinutes') is distinct from 'number' then return false;end if;
 if s->>'name' ~ U&'[\0001-\001f\007f-\009f]' or length(btrim(s->>'name',U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))=0 then return false;end if;
 if (s->>'durationMinutes')::numeric not between 5 and 1440 or trunc((s->>'durationMinutes')::numeric)<>(s->>'durationMinutes')::numeric then return false;end if;
 if (select count(*) from jsonb_object_keys(price))<>2 or not(price ?& array['amount','currency'])
 or jsonb_typeof(price->'amount') is distinct from 'number' or jsonb_typeof(price->'currency') is distinct from 'string' or price->>'currency' !~ '^[A-Z]{3}$' then return false;end if;
 if (price->>'amount')::numeric not between 1 and 9007199254740991 or trunc((price->>'amount')::numeric)<>(price->>'amount')::numeric then return false;end if;
 return true;
end$$;
revoke all on function lumin.paid_journey_snapshot_valid(jsonb) from public,anon,authenticated,service_role;
alter table public.flow_versions add column journey_snapshot jsonb;
alter table public.flow_versions drop constraint flow_versions_render_schema_version_check;
alter table public.flow_versions add constraint flow_versions_render_schema_version_check check(render_schema_version in(1,2,3,4,5,6,7,8));
alter table public.flow_versions drop constraint flow_version_render_shape;
alter table public.flow_versions add constraint flow_version_render_shape check(
 ((render_schema_version=1 and configurable_snapshot is null and paid_snapshot is null)
 or(render_schema_version=2 and configurable_snapshot is not null and paid_snapshot is null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config)
 or(render_schema_version in(3,4) and configurable_snapshot is null and paid_snapshot is not null and jsonb_typeof(paid_snapshot)='object' and paid_snapshot->'renderSchemaVersion'=to_jsonb(render_schema_version) and paid_snapshot->>'submissionMode'=case when render_schema_version=3 then 'paid_service_request' else 'paid_option_request' end)
 or(render_schema_version=5 and configurable_snapshot is null and lumin.customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=6 and configurable_snapshot is null and lumin.conditional_customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=7 and configurable_snapshot is null and paid_snapshot is null and lumin.detailing_snapshot_valid(detailing_snapshot,source_revision))
 or(render_schema_version=8 and configurable_snapshot is null and paid_snapshot is null and detailing_snapshot is null and lumin.paid_journey_snapshot_valid(journey_snapshot))) is true);
alter table public.flow_versions add constraint journey_snapshot_exclusive check((render_schema_version=8)=(journey_snapshot is not null));

create table public.paid_journey_publications(
 tenant_id uuid not null,flow_id uuid not null,version_id uuid primary key,installation_id uuid not null unique,
 foreign key(tenant_id,flow_id,version_id) references public.flow_versions(tenant_id,flow_id,id),
 foreign key(installation_id) references public.flow_installations(id) deferrable initially deferred
);
alter table public.paid_journey_publications enable row level security;
alter table public.paid_journey_publications force row level security;
revoke all on public.paid_journey_publications from public,anon,authenticated,service_role;
create trigger paid_journey_publications_immutable before update or delete on public.paid_journey_publications for each row execute function lumin.reject_flow_version_mutation();
create function lumin.guard_journey_installation() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare schema_id integer;old_schema integer;
begin
 if tg_op<>'INSERT' then
  select render_schema_version into old_schema from public.flow_versions where id=old.version_id;
  if old_schema=8 then raise exception 'JOURNEY_INSTALLATION_IMMUTABLE' using errcode='55000';end if;
 end if;
 if tg_op<>'DELETE' then
  select render_schema_version into schema_id from public.flow_versions where id=new.version_id;
  if schema_id=8 and (tg_op<>'INSERT' or not exists(select 1 from public.paid_journey_publications where tenant_id=new.tenant_id and flow_id=new.flow_id and version_id=new.version_id and installation_id=new.id)) then raise exception 'JOURNEY_INSTALLATION_ALIAS_FORBIDDEN' using errcode='55000';end if;
  return new;
 end if;
 return old;
end$$;
revoke all on function lumin.guard_journey_installation() from public,anon,authenticated,service_role;
create trigger journey_installation_guard before insert or update or delete on public.flow_installations for each row execute function lumin.guard_journey_installation();

create function public.publish_paid_journey_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb,p_approved_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_journey_drafts;service jsonb;snapshot jsonb;cfg jsonb;f public.flows;v public.flow_versions;b public.bound_flow_versions;i public.flow_installations;registry public.paid_journey_publications;replay boolean:=false;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_version is null or p_installation is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or not lumin.flow_origins_storage_valid(p_origins) or not lumin.flow_origins_storage_valid(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if (select count(distinct value) from jsonb_array_elements(p_origins))<>jsonb_array_length(p_origins)
 or (select count(distinct value) from jsonb_array_elements(p_approved_origins))<>jsonb_array_length(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if not(p_origins<@p_approved_origins) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into d from public.paid_journey_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if d.revision<>p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Align save lock order: profile/catalog first, then freeze exact draft revision.
 perform lumin.paid_journey_service(p_tenant,d.service_id,d.journey);service:=lumin.paid_simple_service(p_tenant,d.service_id);
 select * into d from public.paid_journey_drafts where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision for update;
 if not found or d.service_id::text is distinct from service->>'id' then raise exception 'CONFLICT' using errcode='40001';end if;
 if not lumin.paid_journey_valid(d.journey) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 snapshot:=jsonb_build_object('renderSchemaVersion',8,'submissionMode','paid_journey_request','paymentMode','staging_mock','simulated',true,'service',service,
 'form',jsonb_build_object('name',d.name,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout),'journey',d.journey));
 if not lumin.paid_journey_snapshot_valid(snapshot) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 cfg:=jsonb_build_object('key','paid_journey','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 select * into f from public.flows where id=p_flow for update;
 if found then
  if f.tenant_id<>p_tenant or f.status<>'active' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id;
  if not found or v.render_schema_version<>8 then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision=p_expected_revision;
  if found then
   if f.published_version_id<>v.id or v.render_schema_version<>8 or v.journey_snapshot is distinct from snapshot or v.config is distinct from cfg then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or b.service_id<>d.service_id or b.service_snapshot is distinct from service then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into registry from public.paid_journey_publications where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or (select count(*) from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id)<>1 then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into i from public.flow_installations where id=registry.installation_id and tenant_id=p_tenant and flow_id=p_flow and version_id=v.id for share;
   if not found or i.allowed_origins is distinct from p_origins then raise exception 'CONFLICT' using errcode='40001';end if;
   p_version:=v.id;p_installation:=i.id;replay:=true;
  elsif exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision>=p_expected_revision) then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  insert into public.flows(id,tenant_id,name,status) values(p_flow,p_tenant,d.name,'active');
 end if;
 if not replay then
  insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,journey_snapshot) values(p_version,p_tenant,p_flow,d.revision,'unconfirmed_request',cfg,8,snapshot);
  insert into public.bound_flow_services values(p_tenant,p_flow,d.service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
  insert into public.bound_flow_versions values(p_tenant,p_flow,p_version,d.service_id,service);
  insert into public.paid_journey_publications(tenant_id,flow_id,version_id,installation_id) values(p_tenant,p_flow,p_version,p_installation);
  insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation,p_tenant,p_flow,p_version,p_origins);
  update public.flows set name=d.name,status='active',published_version_id=p_version where tenant_id=p_tenant and id=p_flow;
 end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'flowId',p_flow,'draftRevision',d.revision,'versionId',p_version,'installationId',p_installation,'renderSchemaVersion',8,'replayed',replay);
end$$;
revoke all on function public.publish_paid_journey_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_paid_journey_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb,jsonb) to service_role;
commit;
