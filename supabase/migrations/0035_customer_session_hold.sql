-- Customer holds derive their sole booking target from existing request provenance.
begin;
create function public.customer_flow_hold_target(p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare scope jsonb; sess public.flow_sessions; req public.flow_requests; bk public.bookings;
begin
 scope:=public.customer_flow_availability_scope(p_token_hash,p_origin);
 select * into sess from public.flow_sessions where token_hash=p_token_hash for share;
 select * into req from public.flow_requests where session_id=sess.id and tenant_id=sess.tenant_id for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into bk from public.bookings where id=req.booking_id and tenant_id=req.tenant_id for update;
 if not found or bk.state<>'draft' then raise exception 'NOT_AVAILABLE' using errcode='P0002'; end if;
 if bk.selection->>'serviceId' is distinct from sess.service_id::text then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('tenantId',sess.tenant_id,'serviceId',sess.service_id,'bookingId',bk.id);
end $$;
revoke all on function public.customer_flow_hold_target(text,text) from public,anon,authenticated,service_role;
grant execute on function public.customer_flow_hold_target(text,text) to service_role;
commit;
