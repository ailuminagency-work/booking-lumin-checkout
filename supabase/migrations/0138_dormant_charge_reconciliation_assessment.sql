-- Dormant, incomplete observation assessment. Never accounting or processing permission.
begin;
create function payment_internal.assess_charge_reconciliation(p_charge_anchor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c payment_internal.charge_anchors; s public.payment_source_scopes; p public.payments;
 origin payment_internal.event_receipts; r payment_internal.event_receipts; first_charge payment_internal.event_receipts;
 f payment_internal.refund_anchors; fo payment_internal.event_receipts;
 charges payment_internal.event_receipts[]; observations payment_internal.event_receipts[]; anchors payment_internal.refund_anchors[];
 anchor_ids text[]; total numeric:=0; uncertain boolean:=false; status_uncertain boolean:=false; charge_uncertain boolean:=false;
 result jsonb:=jsonb_build_object('classification','coverage_unknown','reason','unmatched','coverageComplete',false,'accountingAuthorized',false,'individualObservedAmount',null,'chargeCumulativeObservedAmounts','[]'::jsonb);
begin
 -- STABLE uses the calling statement's one MVCC snapshot across these reads.
 -- No row locks, writes, provider lookup, timestamp winner or current-coverage claim.
 select * into c from payment_internal.charge_anchors where id=p_charge_anchor_id;
 if not found then return result;end if;
 select * into s from public.payment_source_scopes where id=c.source_scope_id;
 select * into p from public.payments where id=c.payment_id;
 select * into origin from payment_internal.event_receipts where id=c.origin_receipt_id;
 if s.id is null or p.id is null or origin.id is null or s.provider<>'stripe_connect' or s.charge_model<>'direct'
  or p.source_scope_id is distinct from s.id or p.attempt_id is distinct from c.attempt_id or p.provider is distinct from s.provider
  or p.tenant_id is distinct from s.tenant_id or p.currency::text is distinct from c.currency
  or origin.provider is distinct from s.provider or origin.platform_account_id is distinct from s.platform_account_id
  or origin.connected_account_id is distinct from s.connected_account_id or origin.livemode is distinct from s.livemode
  or origin.schema_version<>3 or origin.parser_version<>3 or origin.object_type<>'charge'
  or origin.charge_id is distinct from c.charge_id or origin.intent_id is distinct from p.provider_intent_id or origin.currency is distinct from c.currency
  or not exists(select 1 from public.booking_payment_attempt_sources a
    join public.payment_attempt_requests q on q.attempt_id=a.id
    join public.payment_attempt_intents i on i.attempt_id=a.id
    join public.payment_request_envelopes e on e.attempt_id=a.id
    join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
    where a.id=c.attempt_id and a.source_scope_id=s.id and a.tenant_id=s.tenant_id and a.provider=p.provider
     and a.booking_id=p.booking_id and b.idempotency_key=a.idempotency_key
     and i.source_scope_id=s.id and i.provider_intent_id=p.provider_intent_id and q.amount=p.amount and q.currency=p.currency::text)
  or exists(select 1 from payment_internal.charge_anchor_conflicts where anchor_id=c.id)
  or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=c.origin_receipt_id) then
  return result||jsonb_build_object('classification','authority_conflict','reason','canonical_authority');
 end if;
 -- Bound materialized evidence, not a claim of bounded physical scan cost.
 select array_agg(x) into charges from (select er.* from payment_internal.event_receipts er
  where er.provider=s.provider and er.platform_account_id=s.platform_account_id and er.connected_account_id=s.connected_account_id and er.livemode=s.livemode
   and er.object_type='charge' and er.charge_id=c.charge_id limit 257) x;
 select array_agg(x),array_agg(x.refund_id) into anchors,anchor_ids from (select af.* from payment_internal.refund_anchors af where af.charge_anchor_id=c.id limit 257) x;
 if coalesce(cardinality(charges),0)>256 or coalesce(cardinality(anchors),0)>256 then return result||jsonb_build_object('reason','evidence_limit');end if;
 select array_agg(x) into observations from (select er.* from payment_internal.event_receipts er
  where er.provider=s.provider and er.platform_account_id=s.platform_account_id and er.connected_account_id=s.connected_account_id and er.livemode=s.livemode
   and er.object_type='refund' and (er.charge_id=c.charge_id or er.refund_id=any(coalesce(anchor_ids,array[]::text[]))
    or (er.charge_id is null and er.intent_id=p.provider_intent_id)) limit 257) x;
 if coalesce(cardinality(observations),0)>256 then return result||jsonb_build_object('reason','evidence_limit');end if;
 if coalesce(cardinality(charges),0)=0 then return result||jsonb_build_object('reason','missing_charge_observation');end if;
 foreach r in array charges loop
  if r.schema_version<>3 or r.parser_version<>3 or r.currency is distinct from c.currency
   or (r.intent_id is not null and r.intent_id is distinct from p.provider_intent_id)
   or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id) then
   return result||jsonb_build_object('classification','authority_conflict','reason','charge_observation_conflict');end if;
  if r.intent_id is null then uncertain:=true;end if;
  if first_charge.id is null then first_charge:=r;
  elsif row(r.charge_amount,r.charge_captured,r.charge_amount_captured,r.charge_amount_refunded,r.charge_refunded)
   is distinct from row(first_charge.charge_amount,first_charge.charge_captured,first_charge.charge_amount_captured,first_charge.charge_amount_refunded,first_charge.charge_refunded) then charge_uncertain:=true;end if;
 end loop;
 if anchors is not null then foreach f in array anchors loop
  select * into fo from payment_internal.event_receipts where id=f.origin_receipt_id;
  if f.source_scope_id is distinct from s.id or f.payment_id is distinct from p.id or f.currency is distinct from c.currency
   or fo.id is null or fo.schema_version<>3 or fo.parser_version<>3 or fo.object_type<>'refund'
   or fo.provider is distinct from s.provider or fo.platform_account_id is distinct from s.platform_account_id
   or fo.connected_account_id is distinct from s.connected_account_id or fo.livemode is distinct from s.livemode
   or fo.refund_id is distinct from f.refund_id or fo.charge_id is distinct from c.charge_id
   or fo.intent_id is distinct from p.provider_intent_id or fo.currency is distinct from f.currency or fo.refund_amount is distinct from f.amount
   or exists(select 1 from payment_internal.refund_anchor_conflicts where anchor_id=f.id)
   or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=f.origin_receipt_id) then
   return result||jsonb_build_object('classification','authority_conflict','reason','refund_authority');end if;
  -- One amount per immutable source/refund identity, never per receipt.
  total:=total+f.amount::numeric;
 end loop;end if;
 foreach r in array coalesce(observations,array[]::payment_internal.event_receipts[]) loop
  select * into f from payment_internal.refund_anchors where source_scope_id=s.id and refund_id=r.refund_id;
  if r.schema_version<>3 or r.parser_version<>3 or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id) then
   return result||jsonb_build_object('classification','authority_conflict','reason','refund_observation_conflict');end if;
  if f.id is not null and f.charge_anchor_id is distinct from c.id and r.charge_id is null then
   -- Matching PI alone cannot attribute another charge's refund, status or binding conflict.
   uncertain:=true;
   continue;
  end if;
  if f.id is not null then
   select * into fo from payment_internal.event_receipts where id=f.origin_receipt_id;
   if f.charge_anchor_id is distinct from c.id or f.payment_id is distinct from p.id or f.currency is distinct from c.currency
    or r.refund_amount is distinct from f.amount or r.currency is distinct from f.currency
    or (r.charge_id is not null and r.charge_id is distinct from c.charge_id)
    or (r.intent_id is not null and r.intent_id is distinct from p.provider_intent_id)
    or fo.id is null or exists(select 1 from payment_internal.refund_anchor_conflicts where anchor_id=f.id)
    or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=f.origin_receipt_id) then
    return result||jsonb_build_object('classification','authority_conflict','reason','refund_observation_conflict');end if;
  else
   -- Explicit known contradiction is not repaired by missing association.
   if r.charge_id=c.charge_id and (r.currency is distinct from c.currency or (r.intent_id is not null and r.intent_id is distinct from p.provider_intent_id)) then
    return result||jsonb_build_object('classification','authority_conflict','reason','refund_observation_conflict');end if;
   uncertain:=true;
  end if;
  if r.intent_id is null or r.charge_id is null then uncertain:=true;end if;
  if r.refund_status is distinct from 'succeeded' then status_uncertain:=true;end if;
 end loop;
 -- Finite arithmetic and no partial totals, regardless of other uncertainty.
 if total>9007199254740991 then return result||jsonb_build_object('reason','amount_limit');end if;
 if status_uncertain then return result||jsonb_build_object('classification','status_needs_verification','reason','refund_status_observations');end if;
 if uncertain then return result||jsonb_build_object('reason','unresolved_observations');end if;
 if charge_uncertain then return result||jsonb_build_object('reason','charge_observations_differ');end if;
 if total is distinct from first_charge.charge_amount_refunded::numeric then return result||jsonb_build_object('reason','observation_amounts_differ');end if;
 return result||jsonb_build_object('classification','observed_consistent','reason','observations_agree','individualObservedAmount',total::bigint,'chargeCumulativeObservedAmounts',jsonb_build_array(first_charge.charge_amount_refunded));
end$$;
revoke all on function payment_internal.assess_charge_reconciliation(uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.assess_charge_reconciliation(uuid) to service_role;
comment on function payment_internal.assess_charge_reconciliation(uuid) is 'Dormant incomplete single-snapshot observation assessment only. No financial permission, provider-current coverage, status winner or runtime caller. Unanchored both-null pointers cannot be attributed.';
commit;
