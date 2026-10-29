-- Private schema7 payment provenance only; sole confirmation writer unchanged.
begin;
create function public.detailing_payment_target(hash text,origin text,approved jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions;r public.flow_requests;d public.detailing_request_receipts;b public.bookings;ctx jsonb;model jsonb;receipt jsonb;h public.capacity_holds;payments jsonb;p public.payments;
begin
 perform lumin.group_prefix(false);
 select * into s from public.flow_sessions where token_hash=hash for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;

 select * into r from public.flow_requests where tenant_id=s.tenant_id and session_id=s.id for share;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into d from public.detailing_request_receipts where tenant_id=s.tenant_id and session_id=s.id and booking_id=r.booking_id for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- Catalog tenant fence precedes a non-waiting payment lock, then booking.
 -- A direct confirmation already holding payment while awaiting tenant yields
 -- a bounded conflict here, never a tenant/payment wait cycle.
 ctx:=public.resolve_detailing_flow_session(hash,origin,approved);
 perform 1 from public.payments where booking_id=r.booking_id order by id for update nowait;
 model:=lumin.detailing_request_model(ctx->'service',d.canonical_payload->'selection',d.canonical_payload->'customer',(d.canonical_payload->>'requestedStart')::timestamptz);
 if model->'payload' is distinct from d.canonical_payload or r.request_hash is distinct from encode(sha256(convert_to(d.canonical_payload::text,'UTF8')),'hex') or r.customer_answers is distinct from '{}'::jsonb or r.customer_payload is distinct from d.canonical_payload->'customer' then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into b from public.bookings where tenant_id=s.tenant_id and id=r.booking_id for update;
 if not found or b.state not in ('draft','confirmed') or exists(select 1 from public.allocation_group_heads where booking_id=b.id) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if b.idempotency_key is distinct from 'flow-session:'||s.id::text or b.selection is distinct from model->'selection' or b.pricing is distinct from model->'pricing' or b.slot_start is distinct from (model#>>'{slot,start}')::timestamptz or b.slot_end is distinct from (model#>>'{slot,end}')::timestamptz or not exists(select 1 from public.customers c where c.id=b.customer_id and c.tenant_id=s.tenant_id and c.email=d.canonical_payload#>>'{customer,email}') then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Booking FOR UPDATE fences new payment FK inserts; reread all evidence after it.
 select coalesce(jsonb_agg(jsonb_build_object('id',pay.id,'tenant_id',pay.tenant_id,'provider',pay.provider,'provider_intent_id',pay.provider_intent_id,'state',pay.state,'amount',pay.amount,'currency',pay.currency) order by pay.id),'[]') into payments from public.payments pay where pay.booking_id=b.id;
 if exists(select 1 from public.refunds where booking_id=b.id or payment_id=b.payment_id) then raise exception 'CONFLICT' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||b.tenant_id::text||':'||s.service_id::text,0));
 select * into h from public.capacity_holds where booking_id=b.id for update;
 if not found or h.tenant_id<>b.tenant_id or h.service_id<>s.service_id or h.slot_start<>b.slot_start or h.slot_end<>b.slot_end or h.group_id is not null then raise exception 'CONFLICT' using errcode='40001';end if;
 if b.state='draft' then
  if b.payment_id is not null or jsonb_array_length(payments)<>0 or h.status<>'active' or not isfinite(h.expires_at) or h.expires_at<=clock_timestamp() then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  if jsonb_array_length(payments)<>1 or b.payment_id is null or h.status<>'consumed' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into p from public.payments where id=b.payment_id and booking_id=b.id;
  if not found or p.tenant_id<>b.tenant_id or p.provider<>'staging_mock' or p.provider_intent_id<>'staging_mock:'||b.id::text or p.state<>'succeeded' or p.amount<>(model#>>'{pricing,total,amount}')::bigint or p.currency::text<>model#>>'{pricing,total,currency}' then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 if (model#>>'{pricing,total,amount}')::numeric<=0 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 receipt:=jsonb_build_object('schemaVersion',1,'versionId',s.version_id,'installationId',s.installation_id,'serviceId',s.service_id,'bookingId',b.id,'reference',b.reference,'selection',d.canonical_payload->'selection','pricing',model->'pricing','slot',model->'slot','state','draft','confirmed',false,'paymentMode','unavailable');
 if receipt is distinct from d.accepted_receipt or s.expires_at<=clock_timestamp() then raise exception 'CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('context',ctx,'receipt',receipt,'booking',jsonb_build_object('id',b.id,'tenant_id',b.tenant_id,'state',b.state,'payment_id',b.payment_id,'pricing',b.pricing),'payments',payments);
end$$;

revoke all on function public.detailing_payment_target(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.detailing_payment_target(text,text,jsonb) to service_role;
commit;
