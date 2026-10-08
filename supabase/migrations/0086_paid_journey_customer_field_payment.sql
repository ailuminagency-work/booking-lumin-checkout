-- Dedicated V9 simulated evidence. The unchanged confirm_succeeded_payment is the sole confirmation writer.
begin;
create function public.pay_paid_journey_customer_field_mock(hash text,origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_customer_field_sessions;r public.paid_journey_customer_field_requests;b public.bookings;p public.payments;h public.capacity_holds;ctx jsonb;final jsonb;payload jsonb;computed_pricing jsonb;money jsonb;zero jsonb;amount bigint;currency text;finish timestamptz;confirmed jsonb;count_payments integer;
begin
 ctx:=lumin.paid_journey_customer_field_hold_context(hash,origin);
 if hash is null or hash !~ '^[0-9a-f]{64}$' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into s from public.paid_journey_customer_field_sessions where token_hash=hash for update;
 if not found or s.origin is distinct from origin or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- The configuration/current-publication scope was acquired before session locks.
 select * into r from public.paid_journey_customer_field_requests where token_hash=hash for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 payload:=lumin.paid_journey_customer_field_request_payload(ctx->'render',r.canonical_payload->'customer',r.canonical_payload->'answers',(r.canonical_payload->>'requestedStart')::timestamptz);
 if r.canonical_payload is distinct from payload or r.published_render is distinct from ctx->'render' or row(r.tenant_id,r.flow_id,r.version_id,r.installation_id,r.service_id,r.publication_generation) is distinct from row(s.tenant_id,s.flow_id,s.version_id,s.installation_id,s.service_id,s.publication_generation) then raise exception 'CONFLICT' using errcode='40001';end if;
 if not lumin.paid_journey_customer_field_snapshot_valid(r.published_render-'versionId') then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 amount:=(r.published_render#>>'{service,price,amount}')::bigint;currency:=r.published_render#>>'{service,price,currency}';
 money:=jsonb_build_object('amount',amount,'currency',currency);zero:=jsonb_build_object('amount',0,'currency',currency);
 computed_pricing:=jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('code','base','label',r.published_render#>>'{service,name}','amount',money,'quantity',1)),'subtotal',money,'tax',zero,'deposit',zero,'total',money);
 finish:=(payload->>'requestedStart')::timestamptz+make_interval(mins=>(r.published_render#>>'{service,durationMinutes}')::integer);
 -- Match the sole confirmation prefix before payment/booking/hold acquisition.
 lock table public.service_resources in share mode;
 lock table public.refunds in share mode;
 -- Serialize with the existing generic mock evidence seam before booking locks.
 lock table public.payments in share row exclusive mode;
 -- Payment rows precede booking/hold locks, matching the sole confirmation writer.
 perform 1 from public.payments where booking_id=r.booking_id order by id for update;
 select count(*) into count_payments from public.payments where booking_id=r.booking_id;
 select * into p from public.payments where booking_id=r.booking_id;
 select * into b from public.bookings where id=r.booking_id and tenant_id=s.tenant_id for update;
 if not found or b.state not in('draft','confirmed') or b.selection is distinct from jsonb_build_object('serviceId',s.service_id) or b.idempotency_key is distinct from 'paid-journey:fields:'||hash or b.slot_start is distinct from (payload->>'requestedStart')::timestamptz or b.slot_end is distinct from finish or exists(select 1 from public.allocation_group_heads where booking_id=b.id) or not exists(select 1 from public.customers c where c.id=b.customer_id and c.tenant_id=s.tenant_id and c.email=payload#>>'{customer,email}') then raise exception 'CONFLICT' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||s.tenant_id::text||':'||s.service_id::text,0));
 select * into h from public.capacity_holds where booking_id=b.id for update;
 if not found or row(h.tenant_id,h.service_id,h.slot_start,h.slot_end) is distinct from row(s.tenant_id,s.service_id,b.slot_start,b.slot_end) or h.group_id is not null or (b.state='draft' and (h.status<>'active' or not isfinite(h.expires_at) or h.expires_at<=clock_timestamp())) or (b.state='confirmed' and h.status<>'consumed') then raise exception 'CONFLICT' using errcode='40001';end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if count_payments=0 then
  if b.state<>'draft' or b.payment_id is not null or b.pricing is distinct from '{}'::jsonb then raise exception 'CONFLICT' using errcode='40001';end if;
  insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values(s.tenant_id,b.id,'staging_mock','staging_journey_fields:'||b.id::text,'succeeded',amount,currency) returning * into p;
  update public.bookings set pricing=computed_pricing,payment_id=p.id where id=b.id;
 else
  if count_payments<>1 or p.tenant_id<>s.tenant_id or p.provider<>'staging_mock' or p.provider_intent_id<>'staging_journey_fields:'||b.id::text or p.state<>'succeeded' or p.amount<>amount or p.currency<>currency or b.payment_id is distinct from p.id or b.pricing is distinct from computed_pricing then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 confirmed:=public.confirm_succeeded_payment(p.id);
 if confirmed->>'bookingId' is distinct from b.id::text or confirmed->>'paymentId' is distinct from p.id::text or confirmed->>'state' is distinct from 'confirmed' then raise exception 'CONFLICT' using errcode='40001';end if;
 final:=public.resolve_paid_journey_customer_field_session(hash,origin);
 if final is distinct from ctx or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- Preserve the original active deadline through all confirmation updates/outbox triggers.
 if b.state='draft' and h.expires_at<=clock_timestamp() then raise exception 'CONFLICT' using errcode='40001';end if;
 return confirmed||jsonb_build_object('schemaVersion',2,'versionId',s.version_id,'installationId',s.installation_id,'serviceId',s.service_id,'reference',b.reference,'provider','staging_mock','simulated',true,'realPayment',false,'productionMoney',false,'amount',amount,'currency',currency);
end$$;
revoke all on function public.pay_paid_journey_customer_field_mock(text,text) from public,anon,authenticated,service_role;
grant execute on function public.pay_paid_journey_customer_field_mock(text,text) to service_role;
commit;
