-- Explicit prior V3 publication pointer CAS. No draft or financial writer.
begin;
create function public.rollback_paid_simple_publication(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected uuid,p_target uuid,p_approved_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows; current_v public.flow_versions; target_v public.flow_versions; current_b public.bound_flow_versions; target_b public.bound_flow_versions; service jsonb; cfg jsonb; i public.flow_installations; total integer; v public.flow_versions;
begin
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
 cfg:=jsonb_build_object('key','paid_simple','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for update;
 if not found or f.published_version_id is distinct from p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into current_v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_expected;
 select * into target_v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_target for update;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if target_v.source_revision>=current_v.source_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into target_b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=p_target;
 if not found or target_b.service_id<>current_b.service_id then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if target_b.service_snapshot is distinct from service or current_b.service_snapshot is distinct from service then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 foreach v in array array[current_v,target_v] loop
  if v.render_schema_version<>3 or not lumin.paid_simple_metadata_valid(v.paid_snapshot->'publication',v.source_revision)
  or v.config is distinct from cfg or v.paid_snapshot is distinct from jsonb_build_object('renderSchemaVersion',3,'submissionMode','paid_service_request','paymentMode','staging_mock','simulated',true,'service',service,'publication',v.paid_snapshot->'publication')
  then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
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
 return jsonb_build_object('flowId',p_flow,'versionId',p_target,'installationId',i.id,'renderSchemaVersion',3,'hostedPath','/checkout/flow/'||i.id::text);
end $$;
revoke all on function public.rollback_paid_simple_publication(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rollback_paid_simple_publication(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
