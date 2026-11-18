-- Corrective dormant authority: attention, resource release and serialized admission.
begin;
create table payment_internal.payment_attention (
 receipt_id uuid primary key references payment_internal.event_receipts(id),
 tenant_id uuid not null references public.tenants(id),
 booking_id uuid not null references public.bookings(id),
 payment_id uuid not null references public.payments(id),
 reason text not null check(reason='late_success_after_failure'),
 created_at timestamptz not null default clock_timestamp()
);
alter table payment_internal.payment_attention enable row level security;
alter table payment_internal.payment_attention force row level security;
revoke all on payment_internal.payment_attention from public,anon,authenticated,service_role;
create trigger payment_attention_immutable before update or delete on payment_internal.payment_attention
 for each row execute function lumin.guard_payment_source_immutable();

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
  perform lumin.release_resource_holds(p.booking_id);
  update public.bookings set state='failed' where id=b.id;
  return jsonb_build_object('result','FAILED','payment_id',p.id,'booking_id',b.id,'booking_state','failed');
end $fn$;
create or replace function payment_internal.park_scoped_payment(p_payment_id uuid,p_reason text,p_observed_amount bigint)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare p public.payments%rowtype; b public.bookings%rowtype;
begin
  select * into p from public.payments where id=p_payment_id for update;
  if not found then return jsonb_build_object('result','NOT_FOUND'); end if;
  if p_reason is null or p_reason not in ('amount_mismatch','capacity_oversold') then
    raise exception 'PARK_INVALID_REASON' using errcode='22023'; end if;
  if p.state not in ('requires_payment','processing','succeeded')
    or exists(select 1 from public.payment_reviews where payment_id=p.id) then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  select * into b from public.bookings where id=p.booking_id for update;
  if not found or b.tenant_id is distinct from p.tenant_id then
    raise exception 'PAYMENT_BOOKING_MISMATCH' using errcode='22023'; end if;
  if b.state not in ('draft','pending_payment') then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  insert into public.payment_reviews(payment_id,tenant_id,booking_id,reason,provider,provider_intent_id,expected_amount,observed_amount,currency)
  values(p.id,p.tenant_id,p.booking_id,p_reason,p.provider,p.provider_intent_id,p.amount,p_observed_amount,p.currency);
  update public.payments set state='processing' where id=p.id;
  perform lumin.release_hold(p.booking_id);
  perform lumin.release_resource_holds(p.booking_id);
  return jsonb_build_object('result','PARKED','payment_id',p.id,'reason',p_reason);
end $fn$;
create or replace function payment_internal.process_scoped_success_receipt(p_receipt_id uuid)
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
 if r.event_type <> 'payment_intent.succeeded' then
  return jsonb_build_object('status','quarantined','reason','unsupported_type'); end if;
 -- Observed status and received/capturable money are required even on replay.
 -- A v1 event cannot acquire inferred facts or financial eligibility.
 if r.parser_version<>2 or r.schema_version<>2 or r.intent_status is distinct from 'succeeded'
  or r.amount_received is null or r.amount_received<=0 or r.amount_received is distinct from r.intent_amount
  or r.amount_capturable is distinct from 0::bigint then
  return jsonb_build_object('status','quarantined','reason','ineligible_facts'); end if;
 -- Match the financial authority's TABLE-before-payment/booking lock order.
 -- Receipt first is consistent with record+process composition in one transaction.
 lock table public.service_resources, public.refunds in share mode;
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
 if p.amount<=0 or p.amount is distinct from r.intent_amount or p.amount is distinct from r.amount_received
  or p.currency is distinct from r.currency or r.amount_capturable is distinct from 0::bigint
  or r.intent_status is distinct from 'succeeded' then
  return jsonb_build_object('status','quarantined','reason','ineligible_facts'); end if;
 -- A verified-source paid observation after failure must be visible, not ignored.
 -- Unexpected booking state is quarantined without inventing a state transition.
 if p.state='failed' then
  if b.state<>'failed' then
   return jsonb_build_object('status','quarantined','reason','failed_payment_state_mismatch'); end if;
  insert into payment_internal.payment_attention(receipt_id,tenant_id,booking_id,payment_id,reason)
   values(r.id,p.tenant_id,b.id,p.id,'late_success_after_failure') on conflict(receipt_id) do nothing;
  return jsonb_build_object('status','quarantined','reason','late_success_after_failure');
 end if;
 effect:=payment_internal.apply_payment_success(p.id,r.amount_received);
 if effect->>'result'='CONFIRMED' then return jsonb_build_object('status','success_confirmed','replayed',effect->'replayed'); end if;
 if effect->>'result'='PARKED' then return jsonb_build_object('status','success_parked'); end if;
 if effect->>'result'='IGNORED' then return jsonb_build_object('status','success_ignored'); end if;
 raise exception 'PAYMENT_RECEIPT_UNAVAILABLE';
end$$;
revoke all on function payment_internal.process_scoped_success_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.process_scoped_success_receipt(uuid) to service_role;


create function payment_internal.read_payment_attention(p_tenant_id uuid,p_receipt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- Trusted backend supplies authenticated tenant. Missing and foreign are identical.
 -- A single snapshot returns bounded historical attention, never an action token.
 select jsonb_build_object('receiptId',a.receipt_id,'bookingId',a.booking_id,'reason',a.reason,
  'recordedAt',a.created_at,'conflictSeen',exists(select 1 from payment_internal.event_receipt_conflicts c where c.receipt_id=a.receipt_id))
 into result from payment_internal.payment_attention a
 join public.payments p on p.id=a.payment_id and p.tenant_id=a.tenant_id and p.booking_id=a.booking_id
 join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
 where a.tenant_id=p_tenant_id and a.receipt_id=p_receipt_id;
 return result;
end$$;
revoke all on function payment_internal.read_payment_attention(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.read_payment_attention(uuid,uuid) to service_role;

do $patch$
declare target regprocedure:='lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer)'::regprocedure;
 source text; definition text; changed text;
begin
 select replace(prosrc,chr(13),'') into source from pg_proc where oid=target;
 if encode(sha256(convert_to(replace(source,'extensions.gen_random_bytes(16)','public.gen_random_bytes(16)'),'UTF8')),'hex')<>'b4b09f7d27dc9f718606bdc70d37cf3aa3f131b7cc224201bf64c62c96f796f8' then raise exception 'RESOURCE_ADMISSION_SOURCE_MISMATCH'; end if;
 if position('perform lumin.group_legacy_guard(p_booking_id);' in source)=0
 or position('gen_random_bytes(16)' in source)=0 then raise exception 'RESOURCE_ADMISSION_SOURCE_MISMATCH'; end if;
 definition:=pg_get_functiondef(target);
 changed:=replace(definition,' used bigint; current_time_value timestamptz;',
  ' used bigint; current_time_value timestamptz; booking_row public.bookings; eligible boolean;');
 if changed=definition then raise exception 'RESOURCE_ADMISSION_SOURCE_MISMATCH'; end if;
 definition:=changed;
 changed:=replace(definition,' -- Same namespace as 0014: legacy and quantity-aware writers serialize together.',
 $insert$ -- Booking before resource locks. NOWAIT avoids waits against payment-first
 -- financial writers and caller-held locks; no payment lock is acquired here.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'RESOURCE_ADMISSION_ISOLATION_UNSUPPORTED' using errcode='25000'; end if;
 select * into booking_row from public.bookings where id=p_booking_id and tenant_id=p_tenant_id for share nowait;
 if not found then raise exception 'INVALID_BOOKING' using errcode='23503'; end if;
 -- Fresh statement after lock acquisition; review writers also lock this booking.
 eligible:=booking_row.state in ('draft','pending_payment') and not exists(
  select 1 from public.payment_reviews pr where pr.booking_id=p_booking_id and pr.tenant_id=p_tenant_id);
 -- Same namespace as 0014: legacy and quantity-aware writers serialize together.$insert$);
 if changed=definition then raise exception 'RESOURCE_ADMISSION_SOURCE_MISMATCH'; end if;
 definition:=changed;
 changed:=replace(definition,$old$ if found and (old.status='consumed' or (old.status='held' and old.expires_at>clock_timestamp())) then$old$,
 $insert$ -- Only exact historical consumed replay may survive terminal/reviewed state.
 if not eligible and (old.id is null or old.status<>'consumed') then
  raise exception 'RESOURCE_BOOKING_INELIGIBLE' using errcode='55000'; end if;
 if found and (old.status='consumed' or (old.status='held' and old.expires_at>clock_timestamp())) then$insert$);
 if changed=definition then raise exception 'RESOURCE_ADMISSION_SOURCE_MISMATCH'; end if;
 execute changed;
end $patch$;
comment on function payment_internal.process_scoped_success_receipt(uuid) is 'Dormant source-resolved v2 success decision; failed payment/booking yields immutable late-success attention, mismatch quarantines. No ACK, refund initiation, provider call or signature-verification claim.';
commit;
