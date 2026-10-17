-- Private V9 session resolution only; no expiry extension or customer writer.
begin;
create function public.resolve_paid_journey_customer_field_session(p_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_customer_field_sessions;c jsonb;
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or not lumin.flow_origins_storage_valid(jsonb_build_array(p_origin)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into s from public.paid_journey_customer_field_sessions where token_hash=p_hash;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if s.origin<>p_origin or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- The accepted issuance context locks tenant/catalog/profile before flow and
 -- rechecks exact current alias, server catalog and publication generation.
 c:=lumin.paid_journey_customer_field_session_context(s.installation_id,p_origin);
 if row(s.tenant_id,s.flow_id,s.version_id,s.installation_id,s.service_id,s.publication_generation) is distinct from
    row((c->>'tenantId')::uuid,(c->>'flowId')::uuid,(c->>'versionId')::uuid,(c->>'installationId')::uuid,(c->>'serviceId')::uuid,(c->>'generation')::bigint)
    or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',s.tenant_id,'flowId',s.flow_id,'versionId',s.version_id,'installationId',s.installation_id,'serviceId',s.service_id,'publicationGeneration',s.publication_generation,'expiresAt',s.expires_at,'render',c->'render');
end$$;
revoke all on function public.resolve_paid_journey_customer_field_session(text,text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_paid_journey_customer_field_session(text,text) to service_role;
commit;
