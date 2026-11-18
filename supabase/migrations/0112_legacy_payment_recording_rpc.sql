-- Compatibility floor only. Keep global provider/intent uniqueness intact.
begin;
create function public.record_legacy_payment_observation(p_tenant_id uuid,p_booking_id uuid,p_provider_intent_id text,p_state text,p_amount bigint,p_currency text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare p public.payments;
begin
 if p_tenant_id is null or p_booking_id is null or p_provider_intent_id is null or length(btrim(p_provider_intent_id))=0
 or p_state is null or p_state not in ('requires_payment','processing','succeeded','failed','refunded','partially_refunded')
 or p_amount is null or p_amount not between 1 and 9007199254740991 or p_currency is null or p_currency !~ '^[A-Z]{3}$'
 then raise exception 'INVALID_PAYMENT_RECORDING'; end if;
 -- No explicit booking lock before unique arbitration. INSERT still performs
 -- normal booking FK checks/KEY SHARE; this is not a universal no-lock claim.
 -- Existing financial RPCs acquire
 -- payment before booking. Old direct insert/upsert remains compatible.
 insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(p_tenant_id,p_booking_id,'stripe_connect',p_provider_intent_id,p_state,p_amount,p_currency)
 on conflict(provider,provider_intent_id) do nothing;
 select * into p from public.payments where provider='stripe_connect' and provider_intent_id=p_provider_intent_id for update;
 if not found then raise exception 'PAYMENT_RECORDING_UNAVAILABLE'; end if;
 if p.tenant_id is distinct from p_tenant_id or p.booking_id is distinct from p_booking_id
 or p.amount is distinct from p_amount or p.currency::text is distinct from p_currency
 then raise exception 'PAYMENT_RECORDING_CONFLICT'; end if;
 -- Identity only; terminal observations persist. No confirmation, hold release,
 -- refund, booking transition, source attribution or frontend capability.
 perform 1 from public.bookings where id=p_booking_id and tenant_id=p_tenant_id for share;
 if not found then raise exception 'PAYMENT_RECORDING_CONFLICT'; end if;
 return jsonb_build_object('tenant_id',p.tenant_id,'booking_id',p.booking_id,'provider',p.provider,
  'provider_intent_id',p.provider_intent_id,'state',p.state,'amount',p.amount,'currency',p.currency);
end$$;
revoke all on function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) to service_role;
comment on function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) is 'Legacy Stripe compatibility writer, not source-aware. Insert-only global arbitration and authoritative reread preserve advanced state. No provenance, provider calls or capabilities. Retain global unique constraint.';
commit;
