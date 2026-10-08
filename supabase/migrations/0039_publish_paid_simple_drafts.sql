-- Explicit saved-revision publication. Existing versions and installations stay immutable.
begin;
create function lumin.paid_simple_metadata_valid(p jsonb,p_revision bigint) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
begin
 if p is null or jsonb_typeof(p)<>'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p))<>3 or not(p ?& array['name','presentation','draftRevision']) then return false;end if;
 if jsonb_typeof(p->'name') is distinct from 'string' or length(p->>'name') not between 1 and 200
 or jsonb_typeof(p->'draftRevision') is distinct from 'number' or p->'draftRevision' is distinct from to_jsonb(p_revision)
 or p_revision not between 1 and 9007199254740991 or jsonb_typeof(p->'presentation') is distinct from 'object' then return false;end if;
 if (select count(*) from jsonb_object_keys(p->'presentation'))<>2 or not((p->'presentation') ?& array['accentColor','layout']) then return false;end if;
 return ((p#>>'{presentation,accentColor}') in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c')
  and (p#>>'{presentation,layout}') in('stacked','compact')) is true;
end $$;
revoke all on function lumin.paid_simple_metadata_valid(jsonb,bigint) from public,anon,authenticated,service_role;
alter table public.flow_versions add constraint paid_simple_metadata_shape check(
 render_schema_version<>3 or not(paid_snapshot ? 'publication') or lumin.paid_simple_metadata_valid(paid_snapshot->'publication',source_revision));

create function public.publish_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts; service jsonb; snapshot jsonb; cfg jsonb; f public.flows; v public.flow_versions; b public.bound_flow_versions; i public.flow_installations; installation_count integer;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_version is null or p_installation is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or not lumin.flow_origins_storage_valid(p_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if d.revision<>p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Keep catalog-before-draft locking aligned with save, then recheck exact revision.
 service:=lumin.paid_simple_service(p_tenant,d.service_id);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision for update;
 if not found or d.service_id::text is distinct from service->>'id' then raise exception 'CONFLICT' using errcode='40001';end if;
 snapshot:=jsonb_build_object('renderSchemaVersion',3,'submissionMode','paid_service_request','paymentMode','staging_mock','simulated',true,'service',service,
  'publication',jsonb_build_object('name',d.name,'draftRevision',d.revision,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout)));
 cfg:=jsonb_build_object('key','paid_simple','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 select * into f from public.flows where id=p_flow for update;
 if found then
  if f.tenant_id<>p_tenant or f.status='archived' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id;
  if not found or v.render_schema_version<>3 then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision=p_expected_revision;
  if found then
   if f.status<>'active' or f.published_version_id<>v.id or v.render_schema_version<>3 or v.paid_snapshot is distinct from snapshot or v.config is distinct from cfg then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or b.service_id<>d.service_id or b.service_snapshot is distinct from service then raise exception 'CONFLICT' using errcode='40001';end if;
   select count(*) into installation_count from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if installation_count<>1 then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into i from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id for share;
   if i.allowed_origins is distinct from p_origins then raise exception 'CONFLICT' using errcode='40001';end if;
   return jsonb_build_object('flowId',p_flow,'draftRevision',d.revision,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',3,'replayed',true);
  end if;
  if exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision>=p_expected_revision) then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  insert into public.flows(id,tenant_id,name,status) values(p_flow,p_tenant,d.name,'active');
 end if;
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,paid_snapshot)
 values(p_version,p_tenant,p_flow,d.revision,'unconfirmed_request',cfg,3,snapshot);
 insert into public.bound_flow_services values(p_tenant,p_flow,d.service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 insert into public.bound_flow_versions values(p_tenant,p_flow,p_version,d.service_id,service);
 insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation,p_tenant,p_flow,p_version,p_origins);
 update public.flows set name=d.name,status='active',published_version_id=p_version where tenant_id=p_tenant and id=p_flow;
 return jsonb_build_object('flowId',p_flow,'draftRevision',d.revision,'versionId',p_version,'installationId',p_installation,'renderSchemaVersion',3,'replayed',false);
end $$;
revoke all on function public.publish_paid_simple_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_paid_simple_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;
commit;
