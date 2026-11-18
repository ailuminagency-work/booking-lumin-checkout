-- Legacy-only compatibility boundary; no source-aware processing or ACK policy.
begin;
create function public.process_legacy_payment_webhook(p_provider_intent_id text,p_kind text,p_observed_amount bigint,p_refund_id text,p_is_cumulative boolean)
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
 -- Global uniqueness is a required migration/cutover prerequisite. STRICT
 -- additionally fails closed if a corrupted deployment ever makes it ambiguous.
 begin
  select * into strict p from public.payments
   where provider='stripe_connect' and provider_intent_id=p_provider_intent_id for update;
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
comment on function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) is 'Legacy NULL-provenance eligibility and financial operation in one transaction. Trusted verified-event assertions; not source-aware processing. Global intent uniqueness required. No provider calls.';
commit;
