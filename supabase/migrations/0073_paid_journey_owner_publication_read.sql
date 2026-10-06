-- Authenticated owner verification is distinct from customer-origin installation reads.
begin;
create function public.get_paid_journey_owner_publication(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v public.flow_versions;i public.flow_installations;service jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select version.* into v from public.flows f join public.flow_versions version on version.tenant_id=f.tenant_id and version.flow_id=f.id and version.id=f.published_version_id
 where f.tenant_id=p_tenant and f.id=p_flow and f.status='active' and version.render_schema_version=8;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if not lumin.paid_journey_snapshot_valid(v.journey_snapshot) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 perform lumin.paid_journey_service(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid,v.journey_snapshot#>'{form,journey}');
 service:=lumin.paid_simple_service(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid);
 if service is distinct from v.journey_snapshot->'service' then raise exception 'CONFLICT' using errcode='40001';end if;
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and published_version_id=v.id and status='active' for share;
 if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 select installation.* into i from public.paid_journey_publications p join public.flow_installations installation on installation.id=p.installation_id and installation.tenant_id=p.tenant_id and installation.flow_id=p.flow_id and installation.version_id=p.version_id
 join public.bound_flow_versions b on b.tenant_id=p.tenant_id and b.flow_id=p.flow_id and b.version_id=p.version_id and b.service_id=(v.journey_snapshot#>>'{service,id}')::uuid
 where p.tenant_id=p_tenant and p.flow_id=p_flow and p.version_id=v.id and b.service_snapshot=service;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'flowId',p_flow,'draftRevision',v.source_revision,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',8,'allowedOrigins',i.allowed_origins,'render',v.journey_snapshot||jsonb_build_object('versionId',v.id));
end$$;
revoke all on function public.get_paid_journey_owner_publication(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_paid_journey_owner_publication(uuid,uuid,uuid) to service_role;
commit;
