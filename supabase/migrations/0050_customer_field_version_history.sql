-- Fixed owner read only; private bound service grants remain closed.
begin;
create function public.owner_customer_field_version_history(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows; schema integer; versions jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select v.render_schema_version into schema from public.flow_versions v where v.tenant_id=p_tenant and v.flow_id=p_flow and v.id=f.published_version_id for share;
 if schema is distinct from 5 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select coalesce(jsonb_agg(x.row order by x.revision desc,x.id),'[]'::jsonb) into versions from (
  select v.id,v.source_revision revision,jsonb_build_object('tenantId',v.tenant_id,'flowId',v.flow_id,'versionId',v.id,'sourceRevision',v.source_revision::text,'renderSchemaVersion',v.render_schema_version,'snapshot',v.paid_snapshot,'config',v.config,'serviceId',b.service_id,'boundSnapshot',b.service_snapshot,
   'installations',coalesce((select jsonb_agg(i.row order by i.id) from (select i.id,jsonb_build_object('installationId',i.id,'allowedOrigins',i.allowed_origins) row from public.flow_installations i where i.tenant_id=v.tenant_id and i.flow_id=v.flow_id and i.version_id=v.id order by i.id limit 2) i),'[]'::jsonb)) row
  from public.flow_versions v left join public.bound_flow_versions b on b.tenant_id=v.tenant_id and b.flow_id=v.flow_id and b.version_id=v.id
  where v.tenant_id=p_tenant and v.flow_id=p_flow order by v.source_revision desc,v.id limit 51
 ) x;
 if jsonb_array_length(versions)>50 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('flowId',p_flow,'currentVersionId',f.published_version_id,'currentSchema',schema,'versions',versions);
end $$;
revoke all on function public.owner_customer_field_version_history(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_customer_field_version_history(uuid,uuid,uuid) to service_role;
commit;
