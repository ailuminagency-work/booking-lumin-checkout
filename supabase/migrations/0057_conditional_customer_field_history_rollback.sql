-- Fixed owner read only; private bound service grants remain closed.
begin;
create function public.owner_conditional_customer_field_version_history(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows; schema integer; versions jsonb;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select v.render_schema_version into schema from public.flow_versions v where v.tenant_id=p_tenant and v.flow_id=p_flow and v.id=f.published_version_id for share;
 if schema is null or schema not in (3,5,6) or not exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and render_schema_version=6) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select coalesce(jsonb_agg(x.row order by x.revision desc,x.id),'[]'::jsonb) into versions from (
  select v.id,v.source_revision revision,jsonb_build_object('tenantId',v.tenant_id,'flowId',v.flow_id,'versionId',v.id,'sourceRevision',v.source_revision::text,'renderSchemaVersion',v.render_schema_version,'snapshot',v.paid_snapshot,'config',v.config,'serviceId',b.service_id,'boundSnapshot',b.service_snapshot,
   'installations',coalesce((select jsonb_agg(i.row order by i.id) from (select i.id,jsonb_build_object('installationId',i.id,'allowedOrigins',i.allowed_origins) row from public.flow_installations i where i.tenant_id=v.tenant_id and i.flow_id=v.flow_id and i.version_id=v.id order by i.id limit 2) i),'[]'::jsonb)) row
  from public.flow_versions v left join public.bound_flow_versions b on b.tenant_id=v.tenant_id and b.flow_id=v.flow_id and b.version_id=v.id
  where v.tenant_id=p_tenant and v.flow_id=p_flow order by v.source_revision desc,v.id limit 51
 ) x;
 if jsonb_array_length(versions)>50 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('flowId',p_flow,'currentVersionId',f.published_version_id,'currentSchema',schema,'versions',versions);
end $$;
revoke all on function public.owner_conditional_customer_field_version_history(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_conditional_customer_field_version_history(uuid,uuid,uuid) to service_role;

-- Explicit prior mixed V3/V5/V6 publication pointer CAS. No draft or financial writer.

create function public.rollback_conditional_customer_field_publication(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected uuid,p_target uuid,p_approved_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows; current_v public.flow_versions; target_v public.flow_versions; current_b public.bound_flow_versions; target_b public.bound_flow_versions; service jsonb; cfg jsonb; i public.flow_installations; total integer; v public.flow_versions;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_expected is null or p_target is null or not lumin.flow_origins_storage_valid(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_expected=p_target then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active';
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if f.published_version_id is distinct from p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into current_b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=p_expected;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 -- Preserve publication's catalog-before-flow lock order and never reprice history.
 service:=lumin.paid_simple_service(p_tenant,current_b.service_id);

 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for update;
 if not found or f.published_version_id is distinct from p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 if not exists(select 1 from public.bound_flow_services where tenant_id=p_tenant and flow_id=p_flow and service_id=current_b.service_id) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if not exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and render_schema_version=6) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into current_v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_expected;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into target_v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_target for update;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if target_v.source_revision>=current_v.source_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into target_b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=p_target;
 if not found or target_b.service_id<>current_b.service_id then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if target_b.service_snapshot is distinct from service or current_b.service_snapshot is distinct from service then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 foreach v in array array[current_v,target_v] loop
  if v.render_schema_version not in (3,5,6) or not lumin.paid_simple_metadata_valid(v.paid_snapshot->'publication',v.source_revision)
   then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
  cfg:=jsonb_build_object('key',case v.render_schema_version when 3 then 'paid_simple' when 5 then 'paid_customer_field' else 'paid_conditional_customer_field' end,'steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
  if v.config is distinct from cfg then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
  if v.render_schema_version=3 then
   if v.paid_snapshot is distinct from jsonb_build_object('renderSchemaVersion',3,'submissionMode','paid_service_request','paymentMode','staging_mock','simulated',true,'service',service,'publication',v.paid_snapshot->'publication') then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
  elsif v.render_schema_version=5 then
   if not lumin.customer_draft_fields_valid(v.paid_snapshot->'customerFields') or v.paid_snapshot is distinct from jsonb_build_object('renderSchemaVersion',5,'submissionMode','paid_customer_field_request','paymentMode','staging_mock','simulated',true,'service',service,'publication',v.paid_snapshot->'publication','customerFields',v.paid_snapshot->'customerFields') then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
  else
   if not lumin.conditional_customer_field_snapshot_valid(v.paid_snapshot,v.source_revision) or v.paid_snapshot is distinct from jsonb_build_object('renderSchemaVersion',6,'submissionMode','paid_conditional_customer_field_request','paymentMode','staging_mock','simulated',true,'service',service,'publication',v.paid_snapshot->'publication','customerFields',v.paid_snapshot->'customerFields') then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 end if;
 end loop;
 -- The target version FOR UPDATE fences installation inserts through its FK KEY SHARE.
 -- The existing installation FOR SHARE below protects its origins and deletion.
 select count(*) into total from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=p_target;
 if total<>1 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into i from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=p_target for share;
 if not lumin.flow_origins_storage_valid(i.allowed_origins) or (select count(*) from jsonb_array_elements(i.allowed_origins))<>(select count(distinct value) from jsonb_array_elements(i.allowed_origins))
 or exists(select 1 from jsonb_array_elements(i.allowed_origins) origin where not(p_approved_origins @> jsonb_build_array(origin))) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 update public.flows set name=target_v.paid_snapshot#>>'{publication,name}',published_version_id=p_target where tenant_id=p_tenant and id=p_flow and published_version_id=p_expected;
 if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('flowId',p_flow,'versionId',p_target,'installationId',i.id,'renderSchemaVersion',target_v.render_schema_version,'hostedPath','/checkout/flow/'||i.id::text);
end $$;
revoke all on function public.rollback_conditional_customer_field_publication(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rollback_conditional_customer_field_publication(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
