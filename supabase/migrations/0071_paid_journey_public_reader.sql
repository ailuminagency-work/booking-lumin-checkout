-- Dedicated V8 read boundary. No session, booking, hold or financial writer.
begin;
create function public.get_paid_journey_render(p_installation uuid,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare snapshot jsonb;version uuid;
begin
 if p_installation is null or not lumin.flow_origins_storage_valid(jsonb_build_array(p_origin)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select v.journey_snapshot,v.id into snapshot,version
 from public.flow_installations i
 join public.paid_journey_publications p on p.installation_id=i.id and p.tenant_id=i.tenant_id and p.flow_id=i.flow_id and p.version_id=i.version_id
 join public.flow_versions v on v.id=i.version_id and v.tenant_id=i.tenant_id and v.flow_id=i.flow_id
 join public.flows f on f.id=i.flow_id and f.tenant_id=i.tenant_id and f.published_version_id=i.version_id and f.status='active'
 join public.tenants t on t.id=i.tenant_id and t.status='active'
 join public.services service on service.id=(v.journey_snapshot#>>'{service,id}')::uuid and service.tenant_id=i.tenant_id and service.active
 join public.business_profiles b on b.tenant_id=i.tenant_id and b.business_type='HOUSEKEEPING'
 where i.id=p_installation and v.render_schema_version=8 and i.allowed_origins ? p_origin;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if not lumin.paid_journey_snapshot_valid(snapshot) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return snapshot||jsonb_build_object('versionId',version);
end$$;
revoke all on function public.get_paid_journey_render(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_paid_journey_render(uuid,text) to service_role;
commit;
