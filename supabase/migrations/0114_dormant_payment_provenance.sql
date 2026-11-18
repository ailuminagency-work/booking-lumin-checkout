-- Dormant compatibility phase: retain GLOBAL provider/intent uniqueness.
-- No backfill, provider call, runtime activation, ACK or financial policy change.
begin;
alter table public.payments
 add column source_scope_id uuid references public.payment_source_scopes(id),
 add column attempt_id uuid references public.payment_attempt_intents(attempt_id),
 add constraint payments_provenance_pair check ((source_scope_id is null and attempt_id is null) or (source_scope_id is not null and attempt_id is not null and provider='stripe_connect')),
 add constraint payments_attempt_unique unique(attempt_id);

create function lumin.guard_payment_provenance() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='DELETE' then
  if OLD.attempt_id is not null or OLD.source_scope_id is not null then raise exception 'PAYMENT_PROVENANCE_IMMUTABLE'; end if;
  return OLD;
 end if;
 if TG_OP='UPDATE' then
  if NEW.source_scope_id is distinct from OLD.source_scope_id or NEW.attempt_id is distinct from OLD.attempt_id
   or (OLD.attempt_id is not null and row(NEW.id,NEW.tenant_id,NEW.booking_id,NEW.provider,NEW.provider_intent_id,NEW.amount,NEW.currency)
       is distinct from row(OLD.id,OLD.tenant_id,OLD.booking_id,OLD.provider,OLD.provider_intent_id,OLD.amount,OLD.currency))
  then raise exception 'PAYMENT_PROVENANCE_IMMUTABLE'; end if;
 end if;
 if NEW.source_scope_id is null and NEW.attempt_id is null then return NEW; end if;
 -- Immutable authority only; never lock booking from a BEFORE trigger.
 if not exists(select 1 from public.booking_payment_attempt_sources a
  join public.payment_attempt_requests q on q.attempt_id=a.id
  join public.payment_attempt_intents i on i.attempt_id=a.id
  join public.payment_request_envelopes e on e.attempt_id=a.id
  join public.payment_source_scopes s on s.id=a.source_scope_id
  join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id and b.idempotency_key=a.idempotency_key
  where a.id=NEW.attempt_id and a.source_scope_id=NEW.source_scope_id
   and a.tenant_id=NEW.tenant_id and a.booking_id=NEW.booking_id and a.provider=NEW.provider
   and s.tenant_id=a.tenant_id and s.provider=a.provider
   and i.source_scope_id=s.id and i.provider_intent_id=NEW.provider_intent_id
   and q.amount=NEW.amount and q.currency=NEW.currency::text)
 then raise exception 'PAYMENT_PROVENANCE_CONFLICT'; end if;
 return NEW;
end$$;
revoke all on function lumin.guard_payment_provenance() from public,anon,authenticated,service_role;
create trigger payment_provenance_guard before insert or update or delete on public.payments
 for each row execute function lumin.guard_payment_provenance();

create function payment_internal.record_scoped_payment_observation(p_attempt_id uuid,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempt_sources; q public.payment_attempt_requests;
 i public.payment_attempt_intents; p public.payments;
begin
 if p_state is null or p_state not in ('requires_payment','processing','succeeded','failed','refunded','partially_refunded')
 then raise exception 'INVALID_PAYMENT_RECORDING'; end if;
 select * into a from public.booking_payment_attempt_sources where id=p_attempt_id;
 select * into q from public.payment_attempt_requests where attempt_id=p_attempt_id;
 select * into i from public.payment_attempt_intents where attempt_id=p_attempt_id;
 if a.id is null or q.attempt_id is null or i.attempt_id is null
 then raise exception 'PAYMENT_PROVENANCE_CONFLICT'; end if;
 -- Guard checks canonical source/request/association/envelope. New INSERT still
 -- performs normal booking FK KEY SHARE; not a universal deadlock-free claim.
 insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency,source_scope_id,attempt_id)
 values(a.tenant_id,a.booking_id,a.provider,i.provider_intent_id,p_state,q.amount,q.currency,a.source_scope_id,a.id)
 on conflict(provider,provider_intent_id) do nothing;
 select * into p from public.payments where provider=a.provider and provider_intent_id=i.provider_intent_id for update;
 if not found or p.attempt_id is distinct from a.id or p.source_scope_id is distinct from a.source_scope_id
 or p.tenant_id is distinct from a.tenant_id or p.booking_id is distinct from a.booking_id
 or p.amount is distinct from q.amount or p.currency::text is distinct from q.currency
 then raise exception 'PAYMENT_PROVENANCE_CONFLICT'; end if;
 perform 1 from public.bookings where id=a.booking_id and tenant_id=a.tenant_id and idempotency_key=a.idempotency_key for share;
 if not found then raise exception 'PAYMENT_PROVENANCE_CONFLICT'; end if;
 return jsonb_build_object('paymentId',p.id,'attemptId',p.attempt_id,'sourceScopeId',p.source_scope_id,'state',p.state);
end$$;
revoke all on function payment_internal.record_scoped_payment_observation(uuid,text) from public,anon,authenticated,service_role;
grant execute on function payment_internal.record_scoped_payment_observation(uuid,text) to service_role;

-- One MVCC observation. A match is NOT processing, retry or ACK permission;
-- even matched receipts stay quarantined and subsequent conflicts may appear.
create function payment_internal.resolve_quarantined_payment_receipt(p_receipt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 select case
  when c.receipt_id is not null then jsonb_build_object('status','quarantined','reason','conflict')
  when p.id is null then jsonb_build_object('status','quarantined','reason','unmatched')
  when a.id is null or q.attempt_id is null or i.attempt_id is null or e.attempt_id is null
   or s.tenant_id is distinct from p.tenant_id or s.provider is distinct from p.provider
   or a.tenant_id is distinct from p.tenant_id or a.booking_id is distinct from p.booking_id
   or a.provider is distinct from p.provider or a.source_scope_id is distinct from p.source_scope_id
   or i.source_scope_id is distinct from p.source_scope_id or i.provider_intent_id is distinct from p.provider_intent_id
   or q.amount is distinct from p.amount or q.currency is distinct from p.currency::text
   or b.tenant_id is distinct from p.tenant_id or b.idempotency_key is distinct from a.idempotency_key
  then jsonb_build_object('status','quarantined','reason','authority_conflict')
  when r.intent_amount is distinct from p.amount or r.currency is distinct from p.currency::text
  then jsonb_build_object('status','quarantined','reason','money_mismatch')
  else jsonb_build_object('status','matched_observation','paymentId',p.id,'attemptId',p.attempt_id,'sourceScopeId',p.source_scope_id)
 end into result
 from payment_internal.event_receipts r
 left join payment_internal.event_receipt_conflicts c on c.receipt_id=r.id
 left join public.payment_source_scopes s on s.provider=r.provider and s.platform_account_id=r.platform_account_id
  and s.connected_account_id=r.connected_account_id and s.livemode=r.livemode and s.charge_model='direct'
 left join public.payments p on p.source_scope_id=s.id and p.provider=r.provider and p.provider_intent_id=r.intent_id
 left join public.booking_payment_attempt_sources a on a.id=p.attempt_id
 left join public.payment_attempt_requests q on q.attempt_id=a.id
 left join public.payment_attempt_intents i on i.attempt_id=a.id
 left join public.payment_request_envelopes e on e.attempt_id=a.id
 left join public.bookings b on b.id=p.booking_id
 where r.id=p_receipt_id;
 return coalesce(result,jsonb_build_object('status','quarantined','reason','unmatched'));
end$$;
revoke all on function payment_internal.resolve_quarantined_payment_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.resolve_quarantined_payment_receipt(uuid) to service_role;

-- Legacy RPC replacement follows below; signature remains compatible.

create or replace function public.record_legacy_payment_observation(p_tenant_id uuid,p_booking_id uuid,p_provider_intent_id text,p_state text,p_amount bigint,p_currency text)
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
 if p.source_scope_id is not null or p.attempt_id is not null
 or p.tenant_id is distinct from p_tenant_id or p.booking_id is distinct from p_booking_id
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
