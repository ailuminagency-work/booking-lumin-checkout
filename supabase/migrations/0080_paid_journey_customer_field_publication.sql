-- Explicit V9 owner publication only. Customer/session/financial paths remain unchanged.
begin;
create function lumin.paid_journey_customer_field_snapshot_valid(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare form jsonb;s jsonb;price jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p))<>6 or not(p ?& array['renderSchemaVersion','submissionMode','paymentMode','simulated','service','form'])
 or p->'renderSchemaVersion' is distinct from '9'::jsonb or p->>'submissionMode' is distinct from 'paid_journey_customer_field_request'
 or p->>'paymentMode' is distinct from 'staging_mock' or p->'simulated' is distinct from 'true'::jsonb then return false;end if;
 form:=p->'form';s:=p->'service';price:=s->'price';
 if not lumin.paid_journey_customer_field_form_valid(form) or jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(price) is distinct from 'object' or lumin.paid_journey_customer_field_json_bytes(p)>24576 then return false;end if;
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
revoke all on function lumin.paid_journey_customer_field_snapshot_valid(jsonb) from public,anon,authenticated,service_role;
alter table public.flow_versions drop constraint flow_versions_render_schema_version_check;
alter table public.flow_versions add constraint flow_versions_render_schema_version_check check(render_schema_version in(1,2,3,4,5,6,7,8,9));
alter table public.flow_versions drop constraint flow_version_render_shape;
alter table public.flow_versions add constraint flow_version_render_shape check(
 ((render_schema_version=1 and configurable_snapshot is null and paid_snapshot is null)
 or(render_schema_version=2 and configurable_snapshot is not null and paid_snapshot is null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config)
 or(render_schema_version in(3,4) and configurable_snapshot is null and paid_snapshot is not null and jsonb_typeof(paid_snapshot)='object' and paid_snapshot->'renderSchemaVersion'=to_jsonb(render_schema_version) and paid_snapshot->>'submissionMode'=case when render_schema_version=3 then 'paid_service_request' else 'paid_option_request' end)
 or(render_schema_version=5 and configurable_snapshot is null and lumin.customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=6 and configurable_snapshot is null and lumin.conditional_customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=7 and configurable_snapshot is null and paid_snapshot is null and lumin.detailing_snapshot_valid(detailing_snapshot,source_revision))
 or(render_schema_version=8 and configurable_snapshot is null and paid_snapshot is null and detailing_snapshot is null and lumin.paid_journey_snapshot_valid(journey_snapshot))
 or(render_schema_version=9 and configurable_snapshot is null and paid_snapshot is null and detailing_snapshot is null and lumin.paid_journey_customer_field_snapshot_valid(journey_snapshot))) is true);
alter table public.flow_versions drop constraint journey_snapshot_exclusive;
alter table public.flow_versions add constraint journey_snapshot_exclusive check((render_schema_version in(8,9))=(journey_snapshot is not null));

create table public.paid_journey_customer_field_publications(
 tenant_id uuid not null,flow_id uuid not null,version_id uuid primary key,installation_id uuid not null unique,
 foreign key(tenant_id,flow_id,version_id) references public.flow_versions(tenant_id,flow_id,id),
 foreign key(installation_id) references public.flow_installations(id) deferrable initially deferred
);
alter table public.paid_journey_customer_field_publications enable row level security;
alter table public.paid_journey_customer_field_publications force row level security;
revoke all on public.paid_journey_customer_field_publications from public,anon,authenticated,service_role;
create trigger paid_journey_customer_field_publications_immutable before update or delete on public.paid_journey_customer_field_publications for each row execute function lumin.reject_flow_version_mutation();
create function lumin.guard_journey_customer_field_installation() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare schema_id integer;old_schema integer;
begin
 if tg_op<>'INSERT' then
  select render_schema_version into old_schema from public.flow_versions where id=old.version_id;
  if old_schema=9 then raise exception 'JOURNEY_INSTALLATION_IMMUTABLE' using errcode='55000';end if;
 end if;
 if tg_op<>'DELETE' then
  select render_schema_version into schema_id from public.flow_versions where id=new.version_id;
  if schema_id=9 and (tg_op<>'INSERT' or not exists(select 1 from public.paid_journey_customer_field_publications where tenant_id=new.tenant_id and flow_id=new.flow_id and version_id=new.version_id and installation_id=new.id)) then raise exception 'JOURNEY_INSTALLATION_ALIAS_FORBIDDEN' using errcode='55000';end if;
  return new;
 end if;
 return old;
end$$;
revoke all on function lumin.guard_journey_customer_field_installation() from public,anon,authenticated,service_role;
create trigger journey_customer_field_installation_guard before insert or update or delete on public.flow_installations for each row execute function lumin.guard_journey_customer_field_installation();

create table lumin.paid_journey_customer_field_publication_proofs(transaction_id bigint not null,backend_id integer not null,tenant_id uuid not null,flow_id uuid not null,version_id uuid,action text not null check(action in('insert','publish')),primary key(transaction_id,backend_id,flow_id));
alter table lumin.paid_journey_customer_field_publication_proofs enable row level security;
alter table lumin.paid_journey_customer_field_publication_proofs force row level security;
revoke all on lumin.paid_journey_customer_field_publication_proofs from public,anon,authenticated,service_role;
create or replace function lumin.guard_paid_journey_customer_field_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$declare identity uuid;begin
 if tg_table_name='flows' then identity:=new.id;else identity:=new.flow_id;end if;
 if identity is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Existing V9 identities reject legacy draft writers before they wait on the
 -- namespace lock, avoiding flow-row/advisory inversion in legacy RPCs.
 if tg_table_name not in('flows','paid_journey_customer_field_drafts') and exists(select 1 from public.paid_journey_customer_field_drafts where flow_id=identity) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 perform pg_advisory_xact_lock(hashtextextended(identity::text,79009));
 if tg_table_name='paid_journey_customer_field_drafts' then
  if tg_op='UPDATE' and new.flow_id is distinct from old.flow_id then raise exception 'IDENTITY_IMMUTABLE' using errcode='55000';end if;
  if exists(select 1 from public.flow_drafts where flow_id=identity) or exists(select 1 from public.paid_simple_drafts where flow_id=identity) or exists(select 1 from public.detailing_drafts where flow_id=identity) or exists(select 1 from public.paid_journey_drafts where flow_id=identity) or (exists(select 1 from public.flows where id=identity) and not exists(select 1 from public.paid_journey_customer_field_publications p join public.flow_versions v on v.id=p.version_id and v.tenant_id=p.tenant_id and v.flow_id=p.flow_id where p.flow_id=identity and p.tenant_id=new.tenant_id and v.render_schema_version=9)) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 elsif exists(select 1 from public.paid_journey_customer_field_drafts where flow_id=identity) then
  -- Separate record-shape branches: legacy draft NEW rows have no flow pointer.
  if tg_table_name<>'flows' or tg_op<>'INSERT' then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
  if not exists(select 1 from lumin.paid_journey_customer_field_publication_proofs p where p.transaction_id=txid_current() and p.backend_id=pg_backend_pid() and p.flow_id=identity and p.tenant_id=new.tenant_id and p.action='insert' and p.version_id is null and new.published_version_id is null and new.status='active' and new.name=(select form->>'name' from public.paid_journey_customer_field_drafts where flow_id=identity and tenant_id=new.tenant_id)) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 end if;
 return new;
end$$;
revoke all on function lumin.guard_paid_journey_customer_field_identity() from public,anon,authenticated,service_role;
create function lumin.guard_paid_journey_customer_field_flow_mutation() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.paid_journey_customer_field_drafts where flow_id=old.id) then raise exception 'V9_FLOW_MUTATION_FORBIDDEN' using errcode='55000';end if;return old;
 end if;
 if tg_op='UPDATE' then
  if exists(select 1 from public.paid_journey_customer_field_drafts where flow_id=old.id) then
   if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.status<>'active' or not exists(select 1 from lumin.paid_journey_customer_field_publication_proofs p join public.paid_journey_customer_field_publications r on r.tenant_id=p.tenant_id and r.flow_id=p.flow_id and r.version_id=p.version_id join public.flow_versions v on v.id=r.version_id and v.tenant_id=r.tenant_id and v.flow_id=r.flow_id where p.transaction_id=txid_current() and p.backend_id=pg_backend_pid() and p.action='publish' and p.tenant_id=new.tenant_id and p.flow_id=new.id and p.version_id=new.published_version_id and v.render_schema_version=9 and new.name=v.journey_snapshot#>>'{form,name}') then raise exception 'V9_FLOW_MUTATION_FORBIDDEN' using errcode='55000';end if;
  elsif exists(select 1 from public.paid_journey_customer_field_drafts where flow_id=new.id) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 end if;return new;
end$$;
revoke all on function lumin.guard_paid_journey_customer_field_flow_mutation() from public,anon,authenticated,service_role;
create trigger paid_journey_customer_field_flow_mutation before update or delete on public.flows for each row execute function lumin.guard_paid_journey_customer_field_flow_mutation();
create or replace function public.save_paid_journey_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_form jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare next_revision bigint;begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or not lumin.paid_journey_customer_field_form_valid(p_form) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.paid_journey_customer_field_catalog(p_tenant,p_service);
 -- Shared narrow identity reservation; old rows are scanned without row locks.
 perform pg_advisory_xact_lock(hashtextextended(p_flow::text,79009));
 if exists(select 1 from public.flow_drafts where flow_id=p_flow) or exists(select 1 from public.paid_simple_drafts where flow_id=p_flow) or exists(select 1 from public.detailing_drafts where flow_id=p_flow) or exists(select 1 from public.paid_journey_drafts where flow_id=p_flow) or (exists(select 1 from public.flows where id=p_flow) and not exists(select 1 from public.paid_journey_customer_field_publications p join public.flow_versions v on v.id=p.version_id and v.tenant_id=p.tenant_id and v.flow_id=p.flow_id where p.flow_id=p_flow and p.tenant_id=p_tenant and v.render_schema_version=9)) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 if p_expected_revision=0 then
  insert into public.paid_journey_customer_field_drafts(flow_id,tenant_id,service_id,revision,form) values(p_flow,p_tenant,p_service,1,p_form) returning revision into next_revision;
 else
  update public.paid_journey_customer_field_drafts set service_id=p_service,revision=revision+1,form=p_form where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',p_tenant,'flowId',p_flow,'revision',next_revision);
end$$;
create function public.publish_paid_journey_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb,p_approved_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_journey_customer_field_drafts;service jsonb;snapshot jsonb;cfg jsonb;f public.flows;v public.flow_versions;b public.bound_flow_versions;i public.flow_installations;registry public.paid_journey_customer_field_publications;replay boolean:=false;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_version is null or p_installation is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or not lumin.flow_origins_storage_valid(p_origins) or not lumin.flow_origins_storage_valid(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if (select count(distinct value) from jsonb_array_elements(p_origins))<>jsonb_array_length(p_origins)
 or (select count(distinct value) from jsonb_array_elements(p_approved_origins))<>jsonb_array_length(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if not(p_origins<@p_approved_origins) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into d from public.paid_journey_customer_field_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if d.revision<>p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Align save lock order: profile/catalog first, then freeze exact draft revision.
 perform lumin.paid_journey_customer_field_catalog(p_tenant,d.service_id);service:=lumin.paid_simple_service(p_tenant,d.service_id);
 perform pg_advisory_xact_lock(hashtextextended(p_flow::text,79009));
 select * into d from public.paid_journey_customer_field_drafts where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision for update;
 if not found or d.service_id::text is distinct from service->>'id' then raise exception 'CONFLICT' using errcode='40001';end if;
 if not lumin.paid_journey_customer_field_form_valid(d.form) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 snapshot:=jsonb_build_object('renderSchemaVersion',9,'submissionMode','paid_journey_customer_field_request','paymentMode','staging_mock','simulated',true,'service',service,
 'form',d.form);
 if not lumin.paid_journey_customer_field_snapshot_valid(snapshot) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 cfg:=jsonb_build_object('key','paid_journey','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 select * into f from public.flows where id=p_flow for update;
 if found then
  if f.tenant_id<>p_tenant or f.status<>'active' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id;
  if not found or v.render_schema_version<>9 then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision=p_expected_revision;
  if found then
   if f.published_version_id<>v.id or v.render_schema_version<>9 or v.journey_snapshot is distinct from snapshot or v.config is distinct from cfg then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or b.service_id<>d.service_id or b.service_snapshot is distinct from service then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into registry from public.paid_journey_customer_field_publications where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or (select count(*) from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id)<>1 then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into i from public.flow_installations where id=registry.installation_id and tenant_id=p_tenant and flow_id=p_flow and version_id=v.id for share;
   if not found or i.allowed_origins is distinct from p_origins then raise exception 'CONFLICT' using errcode='40001';end if;
   p_version:=v.id;p_installation:=i.id;replay:=true;
  elsif exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision>=p_expected_revision) then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  insert into lumin.paid_journey_customer_field_publication_proofs values(txid_current(),pg_backend_pid(),p_tenant,p_flow,null,'insert');
  insert into public.flows(id,tenant_id,name,status) values(p_flow,p_tenant,d.form->>'name','active');
  delete from lumin.paid_journey_customer_field_publication_proofs where transaction_id=txid_current() and backend_id=pg_backend_pid() and flow_id=p_flow;
 end if;
 if not replay then
  insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,journey_snapshot) values(p_version,p_tenant,p_flow,d.revision,'unconfirmed_request',cfg,9,snapshot);
  insert into public.bound_flow_services values(p_tenant,p_flow,d.service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
  insert into public.bound_flow_versions values(p_tenant,p_flow,p_version,d.service_id,service);
  insert into public.paid_journey_customer_field_publications(tenant_id,flow_id,version_id,installation_id) values(p_tenant,p_flow,p_version,p_installation);
  insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation,p_tenant,p_flow,p_version,p_origins);
  insert into lumin.paid_journey_customer_field_publication_proofs values(txid_current(),pg_backend_pid(),p_tenant,p_flow,p_version,'publish');
  update public.flows set name=d.form->>'name',status='active',published_version_id=p_version where tenant_id=p_tenant and id=p_flow;
  delete from lumin.paid_journey_customer_field_publication_proofs where transaction_id=txid_current() and backend_id=pg_backend_pid() and flow_id=p_flow;
 end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',p_tenant,'flowId',p_flow,'draftRevision',d.revision,'versionId',p_version,'installationId',p_installation,'renderSchemaVersion',9,'replayed',replay);
end$$;
revoke all on function public.publish_paid_journey_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_paid_journey_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb,jsonb) to service_role;
create function public.get_paid_journey_customer_field_owner_publication(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v public.flow_versions;i public.flow_installations;service jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select version.* into v from public.flows f join public.flow_versions version on version.tenant_id=f.tenant_id and version.flow_id=f.id and version.id=f.published_version_id
 where f.tenant_id=p_tenant and f.id=p_flow and f.status='active' and version.render_schema_version=9;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if not lumin.paid_journey_customer_field_snapshot_valid(v.journey_snapshot) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 perform lumin.paid_journey_customer_field_catalog(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid);
 service:=lumin.paid_simple_service(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid);
 if service is distinct from v.journey_snapshot->'service' then raise exception 'CONFLICT' using errcode='40001';end if;
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and published_version_id=v.id and status='active' for share;
 if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 select installation.* into i from public.paid_journey_customer_field_publications p join public.flow_installations installation on installation.id=p.installation_id and installation.tenant_id=p.tenant_id and installation.flow_id=p.flow_id and installation.version_id=p.version_id
 join public.bound_flow_versions b on b.tenant_id=p.tenant_id and b.flow_id=p.flow_id and b.version_id=p.version_id and b.service_id=(v.journey_snapshot#>>'{service,id}')::uuid
 where p.tenant_id=p_tenant and p.flow_id=p_flow and p.version_id=v.id and b.service_snapshot=service;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',p_tenant,'flowId',p_flow,'draftRevision',v.source_revision,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',9,'allowedOrigins',i.allowed_origins,'render',v.journey_snapshot||jsonb_build_object('versionId',v.id));
end$$;
revoke all on function public.get_paid_journey_customer_field_owner_publication(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_paid_journey_customer_field_owner_publication(uuid,uuid,uuid) to service_role;
commit;
