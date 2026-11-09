-- Resolve capability provenance without taking booking/hold locks ahead of payment authority.
begin;
create function public.customer_flow_payment_target(p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare sess public.flow_sessions; req public.flow_requests; bk public.bookings; h public.capacity_holds;
begin
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 select * into sess from public.flow_sessions where token_hash=p_token_hash for share;
 select * into req from public.flow_requests where tenant_id=sess.tenant_id and session_id=sess.id for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into bk from public.bookings where tenant_id=req.tenant_id and id=req.booking_id;
 if not found or bk.state not in('draft','pending_payment','confirmed') then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if bk.selection->>'serviceId' is distinct from sess.service_id::text then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into h from public.capacity_holds where booking_id=bk.id;
 if not found or h.tenant_id<>sess.tenant_id or h.service_id<>sess.service_id
 or h.slot_start<>bk.slot_start or h.slot_end<>bk.slot_end or h.group_id is not null then raise exception 'CONFLICT' using errcode='40001';end if;
 if bk.state='confirmed' then
  if h.status<>'consumed' or bk.payment_id is null then raise exception 'CONFLICT' using errcode='40001';end if;
 elsif h.status<>'active' or not isfinite(h.expires_at) or h.expires_at<=clock_timestamp() then raise exception 'CONFLICT' using errcode='40001';
 end if;
 if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('tenantId',sess.tenant_id,'serviceId',sess.service_id,'bookingId',bk.id,'paymentId',bk.payment_id);
end $$;
revoke all on function public.customer_flow_payment_target(text,text) from public,anon,authenticated,service_role;
grant execute on function public.customer_flow_payment_target(text,text) to service_role;
commit;
