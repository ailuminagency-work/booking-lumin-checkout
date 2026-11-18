-- Facts only: externally issued refunds remain quarantined. No financial effects.
begin;
alter table payment_internal.event_receipts
 add column charge_id text check(charge_id ~ '^ch_[A-Za-z0-9]{1,252}$'),
 add column refund_id text check(refund_id ~ '^re_[A-Za-z0-9]{1,252}$'),
 add column charge_amount bigint check(charge_amount between 0 and 9007199254740991),
 add column charge_captured boolean,
 add column charge_amount_captured bigint check(charge_amount_captured between 0 and 9007199254740991),
 add column charge_amount_refunded bigint check(charge_amount_refunded between 0 and 9007199254740991),
 add column charge_refunded boolean,
 add column refund_amount bigint check(refund_amount between 0 and 9007199254740991),
 add column refund_status text check(refund_status in ('pending','requires_action','succeeded','failed','canceled')),
 alter column intent_id drop not null,
 alter column intent_amount drop not null,
 drop constraint event_receipts_object_type_check,
 drop constraint event_receipts_event_type_check,
 drop constraint event_receipts_parser_version_check,
 drop constraint event_receipts_schema_version_check,
 drop constraint event_receipts_version_facts_check,
 add constraint event_receipts_object_type_check check(object_type in ('payment_intent','charge','refund')),
 add constraint event_receipts_event_type_check check(event_type in ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled','charge.refunded','refund.created','refund.updated','refund.failed')),
 add constraint event_receipts_parser_version_check check(parser_version in (1,2,3)),
 add constraint event_receipts_schema_version_check check(schema_version in (1,2,3)),
 add constraint event_receipts_version_facts_check check(
  (object_type='payment_intent' and event_type in ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled')
   and intent_id is not null and intent_amount is not null
   and charge_id is null and refund_id is null and charge_amount is null and charge_captured is null and charge_amount_captured is null and charge_amount_refunded is null and charge_refunded is null and refund_amount is null and refund_status is null
   and ((schema_version=1 and parser_version=1 and intent_status is null and amount_received is null and amount_capturable is null)
    or (schema_version=2 and parser_version=2 and event_type='payment_intent.succeeded'
     and intent_status is not null and intent_status in ('requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded')
     and amount_received is not null and amount_received between 0 and 9007199254740991
     and amount_capturable is not null and amount_capturable between 0 and 9007199254740991)))
  or (schema_version=3 and parser_version=3 and intent_amount is null and intent_status is null and amount_received is null and amount_capturable is null
   and ((object_type='charge' and event_type='charge.refunded' and charge_id is not null and charge_amount is not null and charge_captured is not null and charge_amount_captured is not null and charge_amount_refunded is not null and charge_refunded is not null and refund_id is null and refund_amount is null and refund_status is null)
    or (object_type='refund' and event_type in ('refund.created','refund.updated','refund.failed') and refund_id is not null and refund_amount is not null and charge_amount is null and charge_captured is null and charge_amount_captured is null and charge_amount_refunded is null and charge_refunded is null)))
 );
create or replace function payment_internal.record_quarantined_event(p_facts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v integer; shape text; keys text[]; strings text[]; numbers text[]; r payment_internal.event_receipts; original jsonb; outcome text; inserted boolean; conflicted boolean;
begin
 -- Trusted server assertion only: not signature verification or financial authority.
 if jsonb_typeof(p_facts) is distinct from 'object' then raise exception 'INVALID_PAYMENT_RECEIPT'; end if;
 if p_facts->'schemaVersion'='1'::jsonb then v:=1;elsif p_facts->'schemaVersion'='2'::jsonb then v:=2;elsif p_facts->'schemaVersion'='3'::jsonb then v:=3;else raise exception 'INVALID_PAYMENT_RECEIPT';end if;
 shape:=p_facts->>'objectType';
 keys:=array['provider','platformAccountId','accountId','livemode','eventId','objectType','eventType','eventCreated','eventApiVersion','parserVersion','schemaVersion','intentId','currency'];
 strings:=array['provider','platformAccountId','accountId','eventId','objectType','eventType','currency'];numbers:=array['eventCreated','parserVersion','schemaVersion'];
 if v<3 then
  keys:=keys||array['intentAmount'];strings:=strings||array['intentId'];numbers:=numbers||array['intentAmount'];
  if v=2 then keys:=keys||array['intentStatus','amountReceived','amountCapturable'];strings:=strings||array['intentStatus'];numbers:=numbers||array['amountReceived','amountCapturable'];end if;
 elsif shape='charge' then
  keys:=keys||array['chargeId','chargeAmount','chargeCaptured','chargeAmountCaptured','chargeAmountRefunded','chargeRefunded'];strings:=strings||array['chargeId'];numbers:=numbers||array['chargeAmount','chargeAmountCaptured','chargeAmountRefunded'];
  if jsonb_typeof(p_facts->'chargeCaptured') is distinct from 'boolean' or jsonb_typeof(p_facts->'chargeRefunded') is distinct from 'boolean' then raise exception 'INVALID_PAYMENT_RECEIPT';end if;
 elsif shape='refund' then
  keys:=keys||array['refundId','refundAmount','refundStatus','chargeId'];strings:=strings||array['refundId'];numbers:=numbers||array['refundAmount'];
  if jsonb_typeof(p_facts->'chargeId') not in ('string','null') or jsonb_typeof(p_facts->'refundStatus') not in ('string','null') then raise exception 'INVALID_PAYMENT_RECEIPT';end if;
 else raise exception 'INVALID_PAYMENT_RECEIPT';end if;
 if not p_facts ?& keys or (select count(*) from jsonb_object_keys(p_facts))<>cardinality(keys)
  or exists(select 1 from unnest(strings) k where jsonb_typeof(p_facts->k) is distinct from 'string')
  or exists(select 1 from unnest(numbers) k where jsonb_typeof(p_facts->k) is distinct from 'number' or (p_facts->>k)!~'^[0-9]+$')
  or jsonb_typeof(p_facts->'livemode') is distinct from 'boolean'
  or jsonb_typeof(p_facts->'eventApiVersion') not in ('null','string')
  or (v=3 and jsonb_typeof(p_facts->'intentId') not in ('null','string')) then raise exception 'INVALID_PAYMENT_RECEIPT';end if;
 begin
  insert into payment_internal.event_receipts(provider,platform_account_id,connected_account_id,livemode,event_id,object_type,event_type,event_created,event_api_version,parser_version,schema_version,intent_id,intent_amount,currency,intent_status,amount_received,amount_capturable,charge_id,refund_id,charge_amount,charge_captured,charge_amount_captured,charge_amount_refunded,charge_refunded,refund_amount,refund_status)
  values(p_facts->>'provider',p_facts->>'platformAccountId',p_facts->>'accountId',(p_facts->>'livemode')::boolean,p_facts->>'eventId',shape,p_facts->>'eventType',(p_facts->>'eventCreated')::bigint,p_facts->>'eventApiVersion',(p_facts->>'parserVersion')::integer,v,p_facts->>'intentId',(p_facts->>'intentAmount')::bigint,p_facts->>'currency',p_facts->>'intentStatus',(p_facts->>'amountReceived')::bigint,(p_facts->>'amountCapturable')::bigint,p_facts->>'chargeId',p_facts->>'refundId',(p_facts->>'chargeAmount')::bigint,(p_facts->>'chargeCaptured')::boolean,(p_facts->>'chargeAmountCaptured')::bigint,(p_facts->>'chargeAmountRefunded')::bigint,(p_facts->>'chargeRefunded')::boolean,(p_facts->>'refundAmount')::bigint,p_facts->>'refundStatus')
  on conflict(provider,platform_account_id,connected_account_id,livemode,event_id) do nothing returning * into r;
  inserted:=found;
 exception when check_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then raise exception 'INVALID_PAYMENT_RECEIPT';end;
 if not inserted then
  select * into r from payment_internal.event_receipts where provider=p_facts->>'provider' and platform_account_id=p_facts->>'platformAccountId' and connected_account_id=p_facts->>'accountId' and livemode=(p_facts->>'livemode')::boolean and event_id=p_facts->>'eventId';
  if not found then raise exception 'PAYMENT_RECEIPT_UNAVAILABLE';end if;
 end if;
 -- Retain parent receipt serialization with processing/conflict admission.
 select * into r from payment_internal.event_receipts where id=r.id for update;
 original:=jsonb_build_object('provider',r.provider,'platformAccountId',r.platform_account_id,'accountId',r.connected_account_id,'livemode',r.livemode,'eventId',r.event_id,'objectType',r.object_type,'eventType',r.event_type,'eventCreated',r.event_created,'eventApiVersion',r.event_api_version,'parserVersion',r.parser_version,'schemaVersion',r.schema_version,'intentId',r.intent_id,'currency',r.currency);
 if r.schema_version<3 then original:=original||jsonb_build_object('intentAmount',r.intent_amount);
  if r.schema_version=2 then original:=original||jsonb_build_object('intentStatus',r.intent_status,'amountReceived',r.amount_received,'amountCapturable',r.amount_capturable);end if;
 elsif r.object_type='charge' then original:=original||jsonb_build_object('chargeId',r.charge_id,'chargeAmount',r.charge_amount,'chargeCaptured',r.charge_captured,'chargeAmountCaptured',r.charge_amount_captured,'chargeAmountRefunded',r.charge_amount_refunded,'chargeRefunded',r.charge_refunded);
 else original:=original||jsonb_build_object('refundId',r.refund_id,'refundAmount',r.refund_amount,'refundStatus',r.refund_status,'chargeId',r.charge_id);end if;
 if original is distinct from p_facts then insert into payment_internal.event_receipt_conflicts(receipt_id) values(r.id) on conflict(receipt_id) do nothing;outcome:='conflict';else outcome:=case when inserted then 'inserted' else 'duplicate' end;end if;
 select exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id) into conflicted;
 if conflicted then outcome:='conflict';end if;
 return jsonb_build_object('receiptId',r.id,'facts',original,'quarantineState','quarantined','outcome',outcome,'conflictSeen',conflicted);
end$$;
revoke all on function payment_internal.record_quarantined_event(jsonb) from public,anon,authenticated,service_role;
grant execute on function payment_internal.record_quarantined_event(jsonb) to service_role;
comment on column payment_internal.event_receipts.charge_amount_refunded is 'Cumulative observation for this charge only; never a PaymentIntent refunded total or completed-refund verdict.';
comment on column payment_internal.event_receipts.refund_status is 'Explicit nullable individual-refund status. Event names do not infer status. Old PI rows remain NULL.';
commit;
