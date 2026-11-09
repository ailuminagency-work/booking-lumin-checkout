-- Customer scheduling capability. Never accepts tenant/service identity from a caller.
begin;
create function public.customer_flow_availability_scope(p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare sess public.flow_sessions; result jsonb;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_origin is null then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 -- Match the reservation policy prefix and prevent opt-in/resource insert races.
 lock table public.allocation_policies in share mode;
 lock table public.service_resources in share mode;
 select * into sess from public.flow_sessions where token_hash=p_token_hash for share;
 if not found or sess.revoked or sess.expires_at<=clock_timestamp() or sess.origin is distinct from p_origin then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 perform 1 from public.tenants where id=sess.tenant_id and status='active' for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.flows where tenant_id=sess.tenant_id and id=sess.flow_id and status='active' for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.flow_installations where id=sess.installation_id and tenant_id=sess.tenant_id
  and flow_id=sess.flow_id and version_id=sess.version_id and allowed_origins ? p_origin for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.bound_flow_versions where tenant_id=sess.tenant_id and flow_id=sess.flow_id
  and version_id=sess.version_id and service_id=sess.service_id;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select jsonb_build_object('tenantId',s.tenant_id,'serviceId',s.id,'timezone',t.timezone,'durationMinutes',s.duration_minutes)
 into result from public.services s join public.tenants t on t.id=s.tenant_id
 where s.tenant_id=sess.tenant_id and s.id=sess.service_id and s.active for share of s;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 -- Resource/group scheduling requires its own allocation authority.
 if exists(select 1 from public.service_resources where tenant_id=sess.tenant_id and service_id=sess.service_id)
 or exists(select 1 from public.allocation_policies where tenant_id=sess.tenant_id and service_id=sess.service_id) then
  raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';
 end if;
 if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return result;
end $$;
revoke all on function public.customer_flow_availability_scope(text,text) from public,anon,authenticated,service_role;
grant execute on function public.customer_flow_availability_scope(text,text) to service_role;
commit;
