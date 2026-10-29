-- V9 token-bound scheduling scope only. Legacy availability and writers unchanged.
begin;
create function public.paid_journey_customer_field_availability_scope(p_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare context jsonb;zone text;
begin
 context:=public.resolve_paid_journey_customer_field_session(p_hash,p_origin);
 -- Resolver already holds tenant/catalog/profile/current-flow authority locks.
 select timezone into zone from public.tenants where id=(context->>'tenantId')::uuid and status='active' for share;
 if not found or (context->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',context->>'tenantId','flowId',context->>'flowId','versionId',context->>'versionId','installationId',context->>'installationId','serviceId',context->>'serviceId','publicationGeneration',context->'publicationGeneration','expiresAt',context->>'expiresAt','timezone',zone,'durationMinutes',(context#>>'{render,service,durationMinutes}')::integer);
end$$;
revoke all on function public.paid_journey_customer_field_availability_scope(text,text) from public,anon,authenticated,service_role;
grant execute on function public.paid_journey_customer_field_availability_scope(text,text) to service_role;
commit;
