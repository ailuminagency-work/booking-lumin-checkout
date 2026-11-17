-- Dedicated V8 scheduling read scope; legacy sessions and financial writers unchanged.
begin;
create function public.paid_journey_availability_scope(p_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_sessions;r jsonb;zone text;
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or not lumin.flow_origins_storage_valid(jsonb_build_array(p_origin)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into s from public.paid_journey_sessions where token_hash=p_hash for share;
 if not found or s.origin is distinct from p_origin or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- Keep approved installation origins stable through scheduling reads. Existing
 -- session resolution locks current flow, profile, catalog and tenant authority.
 perform 1 from public.flow_installations where id=s.installation_id and tenant_id=s.tenant_id and flow_id=s.flow_id and version_id=s.version_id and allowed_origins ? p_origin for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 r:=public.resolve_paid_journey_session(p_hash,p_origin);
 select timezone into zone from public.tenants where id=s.tenant_id and status='active' for share;
 if not found or s.expires_at<=clock_timestamp() or (r#>>'{render,service,id}')::uuid<>s.service_id then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('tenantId',s.tenant_id,'serviceId',s.service_id,'timezone',zone,'durationMinutes',(r#>>'{render,service,durationMinutes}')::integer);
end$$;
revoke all on function public.paid_journey_availability_scope(text,text) from public,anon,authenticated,service_role;
grant execute on function public.paid_journey_availability_scope(text,text) to service_role;
commit;
