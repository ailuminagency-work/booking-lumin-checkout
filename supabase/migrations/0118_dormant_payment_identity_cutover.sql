-- Atomic source-only identity cutover. Old global conflict targets are unsupported.
begin;
-- The schema/table locks serialize this migration against pre-cutover writers.
lock table public.payments in access exclusive mode;
create function payment_internal.admit_payment_identity(p_intent text,p_scoped boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'PAYMENT_IDENTITY_ISOLATION_UNSUPPORTED' using errcode='25000';
 end if;
 if p_intent is null or p_scoped is null then raise exception 'PAYMENT_IDENTITY_INVALID'; end if;
 -- Hash collisions only cause conservative contention, never weaker exclusion.
 if not pg_try_advisory_xact_lock(hashtext('booking-lumin:payment-identity'),hashtext('stripe_connect:'||p_intent)) then
  raise exception 'PAYMENT_IDENTITY_BUSY' using errcode='55P03';
 end if;
 -- VOLATILE + READ COMMITTED obtains a fresh command snapshot AFTER acquiring
 -- the transaction lock. Do not mark stable or permit older transaction snapshots.
 if exists(select 1 from public.payments where provider='stripe_connect' and provider_intent_id=p_intent
  and case when p_scoped then source_scope_id is null or attempt_id is null
      else source_scope_id is not null or attempt_id is not null end)
 then raise exception 'PAYMENT_IDENTITY_CLASS_CONFLICT'; end if;
end$$;
revoke all on function payment_internal.admit_payment_identity(text,boolean) from public,anon,authenticated,service_role;
create function lumin.guard_payment_identity_admission() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if (OLD.provider='stripe_connect' or NEW.provider='stripe_connect')
   and row(NEW.id,NEW.tenant_id,NEW.booking_id,NEW.provider,NEW.provider_intent_id,NEW.source_scope_id,NEW.attempt_id)
    is distinct from row(OLD.id,OLD.tenant_id,OLD.booking_id,OLD.provider,OLD.provider_intent_id,OLD.source_scope_id,OLD.attempt_id)
  then raise exception 'PAYMENT_IDENTITY_IMMUTABLE'; end if;
  return NEW;
 end if;
 if NEW.provider='stripe_connect' then
  perform payment_internal.admit_payment_identity(NEW.provider_intent_id,NEW.source_scope_id is not null or NEW.attempt_id is not null);
 end if;
 return NEW;
end$$;
revoke all on function lumin.guard_payment_identity_admission() from public,anon,authenticated,service_role;
create trigger payment_identity_admission_guard before insert or update on public.payments
 for each row execute function lumin.guard_payment_identity_admission();
alter table public.payments drop constraint payments_provider_provider_intent_id_key;
create unique index payments_legacy_intent_unique on public.payments(provider,provider_intent_id)
 where source_scope_id is null and attempt_id is null;
create unique index payments_scoped_intent_unique on public.payments(provider,source_scope_id,provider_intent_id)
 where source_scope_id is not null and attempt_id is not null;
create or replace function payment_internal.record_scoped_payment_observation(p_attempt_id uuid,p_state text)
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
 begin perform payment_internal.admit_payment_identity(i.provider_intent_id,true);
 exception when raise_exception then
  if SQLERRM='PAYMENT_IDENTITY_CLASS_CONFLICT' then raise exception 'PAYMENT_PROVENANCE_CONFLICT'; end if;
  raise; end;
 insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency,source_scope_id,attempt_id)
 values(a.tenant_id,a.booking_id,a.provider,i.provider_intent_id,p_state,q.amount,q.currency,a.source_scope_id,a.id)
 on conflict(provider,source_scope_id,provider_intent_id) where source_scope_id is not null and attempt_id is not null do nothing;
 select * into p from public.payments where provider=a.provider and source_scope_id=a.source_scope_id and provider_intent_id=i.provider_intent_id and attempt_id is not null for update;
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
 -- Existing financial RPCs acquire payment before booking. Direct INSERT
 -- remains admitted by the trigger; old global ON CONFLICT targets are unsupported.
 begin perform payment_internal.admit_payment_identity(p_provider_intent_id,false);
 exception when raise_exception then
  if SQLERRM='PAYMENT_IDENTITY_CLASS_CONFLICT' then raise exception 'PAYMENT_RECORDING_CONFLICT'; end if;
  raise; end;
 insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(p_tenant_id,p_booking_id,'stripe_connect',p_provider_intent_id,p_state,p_amount,p_currency)
 on conflict(provider,provider_intent_id) where source_scope_id is null and attempt_id is null do nothing;
 select * into p from public.payments where provider='stripe_connect' and provider_intent_id=p_provider_intent_id and source_scope_id is null and attempt_id is null for update;
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
comment on function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) is 'Legacy-only writer with mixed-class admission and partial legacy uniqueness; never adopts scoped provenance. No provider calls or capabilities.';

create or replace function public.process_legacy_payment_webhook(p_provider_intent_id text,p_kind text,p_observed_amount bigint,p_refund_id text,p_is_cumulative boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payments; outcome jsonb; full_refund boolean; dedupe text;
begin
 if p_kind is null or p_kind not in ('payment_succeeded','payment_failed','refund_completed')
 or (p_kind='refund_completed' and p_is_cumulative is null)
 then raise exception 'INVALID_LEGACY_WEBHOOK'; end if;
 if p_provider_intent_id is null or length(btrim(p_provider_intent_id))=0
 then return jsonb_build_object('result','UNAVAILABLE'); end if;
 -- Branch-specific TABLE-before-payment order is mandatory. Do not prelock a
 -- payment then wait on nested financial table locks, or upgrade SHARE to ROW
 -- EXCLUSIVE for refund across concurrent transactions.
 if p_kind='payment_succeeded' then
  lock table public.service_resources,public.refunds in share mode;
 elsif p_kind='refund_completed' then
  lock table public.service_resources,public.refunds in row exclusive mode;
 end if;
 -- Mixed classes are excluded by admission; scoped-only identities never route. STRICT
 -- additionally fails closed if a corrupted deployment ever makes it ambiguous.
 if exists(select 1 from public.payments where provider='stripe_connect' and provider_intent_id=p_provider_intent_id and (source_scope_id is not null or attempt_id is not null))
 then return jsonb_build_object('result','UNAVAILABLE'); end if;
 begin
  select * into strict p from public.payments
   where provider='stripe_connect' and provider_intent_id=p_provider_intent_id and source_scope_id is null and attempt_id is null for update;
 exception when no_data_found or too_many_rows then
  return jsonb_build_object('result','UNAVAILABLE');
 end;
 if p.source_scope_id is not null or p.attempt_id is not null
 then return jsonb_build_object('result','UNAVAILABLE'); end if;
 -- NULL provenance is explicitly legacy, NOT proof of trusted provider source.
 -- Eligibility and financial action share this transaction and row lock.
 if p_kind='payment_succeeded' then
  outcome:=public.succeed_payment_webhook(p.id,p_observed_amount);
  if outcome is null or outcome->>'result'='NOT_FOUND' then raise exception 'LEGACY_WEBHOOK_UNAVAILABLE'; end if;
  return jsonb_build_object('received',true,'confirmed',outcome->>'result'='CONFIRMED')
   ||case when outcome->>'result'='CONFIRMED' then jsonb_build_object('replayed',coalesce((outcome->>'replayed')::boolean,false))
     when outcome->>'result'='PARKED' then jsonb_build_object('parked',outcome->>'reason') else '{}'::jsonb end;
 elsif p_kind='payment_failed' then
  outcome:=public.fail_payment_webhook(p.id);
  if outcome is null or outcome->>'result'='NOT_FOUND' then raise exception 'LEGACY_WEBHOOK_UNAVAILABLE'; end if;
  if outcome->>'result'='FAILED' then return jsonb_build_object('received',true,'failed',true); end if;
  return jsonb_build_object('received',true,'failed',false,'note','ignored stale failure');
 end if;
 -- Preserve existing inbound refund accounting, not refund initiation. Parse
 -- shape outside; derive full against the locked server amount, never a stale read.
 if p_observed_amount is null then
  return jsonb_build_object('received',true,'refunded',false,'full',false,'note','refund amount unavailable');
 end if;
 full_refund:=p_observed_amount>=p.amount;
 if p_observed_amount<=0 then
  return jsonb_build_object('received',true,'refunded',false,'full',full_refund);
 end if;
 dedupe:=coalesce(p_refund_id,p_provider_intent_id||':'||case when p_is_cumulative then 'cumulative' else 'individual' end||':'||p_observed_amount::text);
 outcome:=public.record_refund_webhook(p.id,dedupe,p_observed_amount,full_refund,p_is_cumulative);
 if outcome is null or outcome->>'result'='NOT_FOUND' then raise exception 'LEGACY_WEBHOOK_UNAVAILABLE'; end if;
 return jsonb_build_object('received',true,'refunded',outcome->>'result' in ('RECORDED','IGNORED'),
  'full',coalesce((outcome->>'full')::boolean,false) or full_refund);
end$$;
revoke all on function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) to service_role;
comment on function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) is 'Legacy NULL-provenance eligibility and financial operation in one transaction. Trusted verified-event assertions; not source-aware processing. Mixed-class admission and legacy partial uniqueness required. No provider calls.';
commit;
