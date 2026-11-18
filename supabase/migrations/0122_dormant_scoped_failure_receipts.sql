-- Dormant failure/cancel-only boundary. No runtime ingress/ACK/provider activation.
begin;
create or replace function payment_internal.apply_payment_failure(p_payment_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare p public.payments%rowtype; b public.bookings%rowtype;
begin
  select * into p from public.payments where id=p_payment_id for update;
  if not found then return jsonb_build_object('result','NOT_FOUND'); end if;
  if p.state not in ('requires_payment','processing')
    or exists(select 1 from public.payment_reviews where payment_id=p.id) then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  select * into b from public.bookings where id=p.booking_id for update;
  if not found or b.tenant_id is distinct from p.tenant_id then
    raise exception 'PAYMENT_BOOKING_MISMATCH' using errcode='22023'; end if;
  if b.state not in ('draft','pending_payment') then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  update public.payments set state='failed' where id=p.id;
  perform lumin.release_hold(p.booking_id);
  update public.bookings set state='failed' where id=b.id;
  return jsonb_build_object('result','FAILED','payment_id',p.id,'booking_id',b.id,'booking_state','failed');
end $fn$;
revoke all on function payment_internal.apply_payment_failure(uuid) from public,anon,authenticated,service_role;
create or replace function public.fail_payment_webhook(p_payment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare p public.payments;
begin
 select * into p from public.payments where id=p_payment_id for update;
 if not found then return jsonb_build_object('result','NOT_FOUND'); end if;
 if p.source_scope_id is not null or p.attempt_id is not null then
  raise exception 'SCOPED_PAYMENT_PROCESSING_DISABLED' using errcode='42501';
 end if;
 return payment_internal.apply_payment_failure(p.id);
end$$;
revoke all on function public.fail_payment_webhook(uuid) from public,anon,authenticated,service_role;
grant execute on function public.fail_payment_webhook(uuid) to service_role;
create or replace function payment_internal.record_quarantined_event(p_facts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r payment_internal.event_receipts; original jsonb; outcome text; inserted boolean; conflicted boolean;
begin
 -- Explicit trusted-server assertions only. SQL does not verify signatures or
 -- authenticate ingress/platform identity. All fields required; no extras accepted.
 if jsonb_typeof(p_facts) is distinct from 'object' then raise exception 'INVALID_PAYMENT_RECEIPT'; end if;
 if not p_facts ?& array['provider','platformAccountId','accountId','livemode','eventId','objectType','eventType','eventCreated','eventApiVersion','parserVersion','schemaVersion','intentId','intentAmount','currency']
 or (select count(*) from jsonb_object_keys(p_facts))<>14
 or exists(select 1 from unnest(array['provider','platformAccountId','accountId','eventId','objectType','eventType','intentId','currency']) k where jsonb_typeof(p_facts->k) is distinct from 'string')
 or jsonb_typeof(p_facts->'livemode') is distinct from 'boolean'
 or exists(select 1 from unnest(array['eventCreated','parserVersion','schemaVersion','intentAmount']) k where jsonb_typeof(p_facts->k) is distinct from 'number' or (p_facts->>k) !~ '^[0-9]+$')
 or jsonb_typeof(p_facts->'eventApiVersion') not in ('null','string')
 then raise exception 'INVALID_PAYMENT_RECEIPT'; end if;
 begin
  insert into payment_internal.event_receipts(provider,platform_account_id,connected_account_id,livemode,event_id,object_type,event_type,event_created,event_api_version,parser_version,schema_version,intent_id,intent_amount,currency)
  values(p_facts->>'provider',p_facts->>'platformAccountId',p_facts->>'accountId',(p_facts->>'livemode')::boolean,p_facts->>'eventId',p_facts->>'objectType',p_facts->>'eventType',(p_facts->>'eventCreated')::bigint,p_facts->>'eventApiVersion',(p_facts->>'parserVersion')::integer,(p_facts->>'schemaVersion')::integer,p_facts->>'intentId',(p_facts->>'intentAmount')::bigint,p_facts->>'currency')
  on conflict(provider,platform_account_id,connected_account_id,livemode,event_id) do nothing returning * into r;
  inserted:=found;
 exception when check_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then
  raise exception 'INVALID_PAYMENT_RECEIPT';
 end;
 if not inserted then
  -- INSERT's unique arbitration waits for the winner; this volatile statement
  -- sees its committed immutable row. No receipt can be deleted or rewritten.
  select * into r from payment_internal.event_receipts where provider=p_facts->>'provider'
   and platform_account_id=p_facts->>'platformAccountId' and connected_account_id=p_facts->>'accountId'
   and livemode=(p_facts->>'livemode')::boolean and event_id=p_facts->>'eventId';
  if not found then raise exception 'PAYMENT_RECEIPT_UNAVAILABLE'; end if;
 end if;
 -- Serialize conflict admission with the scoped failure decision. New rows
 -- are already owned; existing rows must take this explicit parent lock.
 select * into r from payment_internal.event_receipts where id=r.id for update;
 original:=jsonb_build_object('provider',r.provider,'platformAccountId',r.platform_account_id,'accountId',r.connected_account_id,
  'livemode',r.livemode,'eventId',r.event_id,'objectType',r.object_type,'eventType',r.event_type,'eventCreated',r.event_created,'eventApiVersion',r.event_api_version,
  'parserVersion',r.parser_version,'schemaVersion',r.schema_version,'intentId',r.intent_id,'intentAmount',r.intent_amount,'currency',r.currency);
 if original is distinct from p_facts then
  insert into payment_internal.event_receipt_conflicts(receipt_id) values(r.id) on conflict(receipt_id) do nothing;
  outcome:='conflict';
 else outcome:=case when inserted then 'inserted' else 'duplicate' end;
 end if;
 select exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id) into conflicted;
 if conflicted then outcome:='conflict'; end if;
 return jsonb_build_object('receiptId',r.id,'facts',original,'quarantineState','quarantined','outcome',outcome,
  'conflictSeen',conflicted);
end$$;
revoke all on function payment_internal.record_quarantined_event(jsonb) from public,anon,authenticated,service_role;
grant execute on function payment_internal.record_quarantined_event(jsonb) to service_role;

create function payment_internal.process_scoped_failure_receipt(p_receipt_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r payment_internal.event_receipts; p public.payments; b public.bookings;
 first_resolution jsonb; checked jsonb; effect jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'PAYMENT_RECEIPT_ISOLATION_UNSUPPORTED' using errcode='25000';
 end if;
 select * into r from payment_internal.event_receipts where id=p_receipt_id for update;
 if not found then return jsonb_build_object('status','quarantined','reason','unmatched'); end if;
 -- Fresh read after receipt lock. Recorder takes this same lock before adding
 -- a marker; future conflicts after our COMMIT cannot undo committed effects.
 if exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id) then
  return jsonb_build_object('status','quarantined','reason','conflict'); end if;
 if r.event_type not in ('payment_intent.payment_failed','payment_intent.canceled') then
  return jsonb_build_object('status','quarantined','reason','unsupported_type'); end if;
 first_resolution:=payment_internal.resolve_quarantined_payment_receipt(r.id);
 if first_resolution->>'status' is distinct from 'matched_observation' then return first_resolution; end if;
 select * into p from public.payments where id=(first_resolution->>'paymentId')::uuid for update;
 if not found then return jsonb_build_object('status','quarantined','reason','unmatched'); end if;
 select * into b from public.bookings where id=p.booking_id for update;
 if not found then return jsonb_build_object('status','quarantined','reason','authority_conflict'); end if;
 -- Revalidate full historical source, canonical immutable graph, money and
 -- mutable booking/payment identity under locks. No caller-selected routing.
 checked:=payment_internal.resolve_quarantined_payment_receipt(r.id);
 if checked->>'status' is distinct from 'matched_observation' then return checked; end if;
 if checked is distinct from first_resolution or p.source_scope_id is null or p.attempt_id is null then
  return jsonb_build_object('status','quarantined','reason','authority_conflict'); end if;
 effect:=payment_internal.apply_payment_failure(p.id);
 if effect->>'result'='FAILED' then return jsonb_build_object('status','failure_applied'); end if;
 if effect->>'result'='IGNORED' then return jsonb_build_object('status','failure_ignored'); end if;
 raise exception 'PAYMENT_RECEIPT_UNAVAILABLE';
end$$;
revoke all on function payment_internal.process_scoped_failure_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.process_scoped_failure_receipt(uuid) to service_role;
comment on function payment_internal.process_scoped_failure_receipt(uuid) is 'Dormant trusted-ingress receipt failure/cancel decision only; SQL does not verify signatures. Receipt remains quarantined; return is not webhook ACK permission. Success/refund excluded. No provider calls.';
commit;
