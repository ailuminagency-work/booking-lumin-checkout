-- Dormant source-resolved success decisions. No ingress/ACK/provider activation.
begin;
create function payment_internal.confirm_scoped_payment(p_payment_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $fn$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
  h public.capacity_holds%rowtype;
  service_row public.services%rowtype;
  sid uuid;
  was_active boolean;
  confirmation_deadline timestamptz;
  resource_link_count integer := 0;
  resource_hold_count integer := 0;
  consumed_resource_count integer := 0;
  resource_id uuid;
  rental_periods numeric;
  rental_min_periods numeric;
  rental_max_periods numeric;
  total_amount numeric;
  deposit_amount numeric;
  charge_amount numeric;
  resource_linked boolean := false;
begin
  perform lumin.group_prefix(false);

  -- Preserve 0032's simple-service lock scope.  Rental confirmation adds the
  -- resources table fence only after the service archetype is known below.
  lock table public.service_resources, public.refunds in share mode;

  if p_payment_id is null then
    raise exception 'CONFIRMATION_INVALID' using errcode = '22023';
  end if;

  select * into p from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'CONFIRMATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 0088 PROVENANCE GATE. The sole confirmation writer must never commit a
  -- booking against a payment whose provider this deployment cannot confirm.
  -- Placed here deliberately: the payment row is locked and p.provider is known,
  -- but no other row is locked yet and no state has changed, so an unconfirmable
  -- provider is refused before this function can touch anything. Default-closed:
  -- an unknown provider has no row, so it is refused. The share lock stops the
  -- allowlist row being deleted underneath an in-flight confirmation.
  perform 1 from public.confirmable_payment_providers
   where provider = p.provider for share;
  if not found then
    raise exception 'CONFIRMATION_PROVIDER_FORBIDDEN' using errcode = '42501';
  end if;

  perform 1 from public.tenants where id = p.tenant_id and status = 'active' for share;
  if not found then
    raise exception 'CONFIRMATION_FORBIDDEN' using errcode = '42501';
  end if;

  select * into b from public.bookings where id = p.booking_id for update;
  if not found or b.tenant_id <> p.tenant_id then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  sid := lumin.planning_service_id(b.selection);
  if sid is null then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;
  select * into service_row
    from public.services s
   where s.id = sid and s.tenant_id = b.tenant_id;
  if not found then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  if exists (select 1 from public.allocation_group_heads where booking_id = b.id)
     or exists (select 1 from public.allocation_policies where service_id = sid) then
    raise exception 'CONFIRMATION_UNSUPPORTED' using errcode = '0A000';
  end if;

  if p.booking_id <> b.id or p.tenant_id <> b.tenant_id
     or p.state <> 'succeeded' or p.amount <= 0
     or p.amount > 9007199254740991 then
    raise exception 'CONFIRMATION_PAYMENT_INVALID' using errcode = '22023';
  end if;
  if b.payment_id is not null and b.payment_id <> p.id then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  -- A rental charge is explicitly defined here as persisted PriceBreakdown v1
  -- total.amount + deposit.amount.  Both components and their currency must
  -- be present in the server-written booking.pricing object; no client amount
  -- or service.rental field is accepted as a payment amount by this function.
  if service_row.archetype = 'rental' then
    if service_row.rental is null then
      raise exception 'CONFIRMATION_UNSUPPORTED' using errcode = '0A000';
    end if;
    lock table public.resources in share mode;
    if b.selection->>'serviceId' <> sid::text
       or jsonb_typeof(b.selection->'itemQuantities') is distinct from 'object'
       or (case when jsonb_typeof(b.selection->'itemQuantities') = 'object'
           then (select count(*) from jsonb_object_keys(b.selection->'itemQuantities'))
           else -1 end) <> 0
       or jsonb_typeof(b.selection->'addonIds') is distinct from 'array'
       or (case when jsonb_typeof(b.selection->'addonIds') = 'array'
           then jsonb_array_length(b.selection->'addonIds')
           else -1 end) <> 0
       or jsonb_typeof(b.selection->'answers') is distinct from 'object'
       or (case when jsonb_typeof(b.selection->'answers') = 'object'
           then (select count(*) from jsonb_object_keys(b.selection->'answers'))
           else -1 end) <> 0
       or jsonb_typeof(b.selection->'rentalPeriods') is distinct from 'number' then
      raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
    end if;
    begin
      rental_periods := (b.selection->>'rentalPeriods')::numeric;
      rental_min_periods := (service_row.rental->>'minPeriods')::numeric;
      rental_max_periods := (service_row.rental->>'maxPeriods')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
    end;
    if trunc(rental_periods) <> rental_periods
       or rental_periods < rental_min_periods
       or rental_periods > rental_max_periods then
      raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
    end if;
    if jsonb_typeof(b.pricing->'total') is distinct from 'object'
       or jsonb_typeof(b.pricing->'deposit') is distinct from 'object'
       or jsonb_typeof(b.pricing#>'{total,amount}') is distinct from 'number'
       or jsonb_typeof(b.pricing#>'{deposit,amount}') is distinct from 'number'
       or jsonb_typeof(b.pricing#>'{total,currency}') is distinct from 'string'
       or jsonb_typeof(b.pricing#>'{deposit,currency}') is distinct from 'string'
       or b.pricing#>>'{total,currency}' <> p.currency::text
       or b.pricing#>>'{deposit,currency}' <> p.currency::text
       or b.pricing#>>'{total,currency}' <> b.pricing#>>'{deposit,currency}' then
      raise exception 'CONFIRMATION_PAYMENT_INVALID' using errcode = '22023';
    end if;
    begin
      total_amount := (b.pricing#>>'{total,amount}')::numeric;
      deposit_amount := (b.pricing#>>'{deposit,amount}')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'CONFIRMATION_PAYMENT_INVALID' using errcode = '22023';
    end;
    if total_amount < 0 or deposit_amount < 0
       or trunc(total_amount) <> total_amount
       or trunc(deposit_amount) <> deposit_amount then
      raise exception 'CONFIRMATION_PAYMENT_INVALID' using errcode = '22023';
    end if;
    charge_amount := total_amount + deposit_amount;
    if charge_amount <= 0 or charge_amount > 9007199254740991
       or trunc(charge_amount) <> charge_amount
       or charge_amount <> p.amount::numeric then
      raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
    end if;
  else
    -- Preserve 0032's exact non-rental payment contract.
    if exists (select 1 from public.service_resources where service_id = sid)
       then
      raise exception 'CONFIRMATION_UNSUPPORTED' using errcode = '0A000';
    end if;
    if jsonb_typeof(b.pricing#>'{total,amount}') is distinct from 'number'
       or jsonb_typeof(b.pricing#>'{total,currency}') is distinct from 'string' then
      raise exception 'CONFIRMATION_PAYMENT_INVALID' using errcode = '22023';
    end if;
    if (b.pricing#>>'{total,amount}')::numeric <> p.amount
       or b.pricing#>>'{total,currency}' <> p.currency::text
       or (b.payment_id is not null and b.payment_id <> p.id)
       or exists (select 1 from public.refunds where booking_id = b.id or payment_id = p.id) then
      raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
    end if;
  end if;

  if exists (select 1 from public.refunds where booking_id = b.id or payment_id = p.id) then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
  end if;

  if service_row.archetype = 'rental' then
    -- Resource reservations and requirements are tenant-scoped, and every
    -- reservation writer uses this same advisory key.  Lock in resource-id
    -- order to avoid multi-resource confirmation deadlocks.
    select count(*) into resource_link_count
      from public.service_resources sr
      join public.resources r on r.id = sr.resource_id and r.tenant_id = sr.tenant_id
     where sr.tenant_id = b.tenant_id and sr.service_id = sid
       and r.active is true and r.capacity >= 1 and sr.quantity_required >= 1;
    if resource_link_count = 0
       or resource_link_count <> (select count(*) from public.service_resources where tenant_id = b.tenant_id and service_id = sid)
       then
      raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
    end if;
    for resource_id in
      select sr.resource_id from public.service_resources sr
       where sr.tenant_id = b.tenant_id and sr.service_id = sid
       order by sr.resource_id
    loop
      perform pg_advisory_xact_lock(hashtextextended('lumin:resource-capacity:' || b.tenant_id::text || ':' || resource_id::text, 0));
    end loop;

    -- Lock every row for this booking before validating, including extras.  An
    -- extra, foreign, expired, consumed, wrong-slot, or wrong-quantity row is
    -- invalid; no reservation is silently ignored.
    perform 1 from public.resource_reservations rr where rr.booking_id = b.id for update;
    select count(*) into resource_hold_count
      from public.resource_reservations rr
     where rr.booking_id = b.id;
    if resource_hold_count <> resource_link_count
       or exists (
          select 1
            from public.service_resources sr
            join public.resources r on r.id = sr.resource_id and r.tenant_id = sr.tenant_id
            left join public.resource_reservations rr
              on rr.booking_id = b.id and rr.resource_id = sr.resource_id
           where sr.tenant_id = b.tenant_id and sr.service_id = sid
             and (rr.id is null or rr.tenant_id <> b.tenant_id
               or rr.slot_start is distinct from b.slot_start
               or rr.slot_end is distinct from b.slot_end
               or (b.state = 'confirmed' and rr.status is distinct from 'consumed')
               or (b.state <> 'confirmed' and (rr.status is distinct from 'held'
                 or not isfinite(rr.expires_at) or rr.expires_at <= clock_timestamp()))
               or rr.quantity is distinct from sr.quantity_required
               or r.active is not true or r.capacity < sr.quantity_required)
       )
       or exists (
          select 1 from public.resource_reservations rr
           where rr.booking_id = b.id
             and not exists (
               select 1 from public.service_resources sr
                where sr.tenant_id = b.tenant_id and sr.service_id = sid
                  and sr.resource_id = rr.resource_id)
       ) then
      raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
    end if;

    if b.state = 'confirmed' then
      -- Confirmed replay requires the same complete, consumed resource set.
      -- No re-consumption or new payment is allowed.
      if exists (
        select 1 from public.service_resources sr
         left join public.resource_reservations rr
           on rr.booking_id = b.id and rr.resource_id = sr.resource_id
        where sr.tenant_id = b.tenant_id and sr.service_id = sid
          and (rr.id is null or rr.status is distinct from 'consumed'
            or rr.slot_start is distinct from b.slot_start
            or rr.slot_end is distinct from b.slot_end
            or rr.quantity is distinct from sr.quantity_required)
      ) or exists (
        select 1 from public.resource_reservations rr
         where rr.booking_id = b.id and rr.status is distinct from 'consumed'
      ) or b.payment_id is distinct from p.id then
        raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
      end if;
      return jsonb_build_object('bookingId', b.id, 'paymentId', p.id, 'state', 'confirmed', 'replayed', true);
    end if;

    if b.state not in ('draft', 'pending_payment') then
      raise exception 'CONFIRMATION_STATE_INVALID' using errcode = '40001';
    end if;
    select min(rr.expires_at) into confirmation_deadline
      from public.resource_reservations rr where rr.booking_id = b.id;
    update public.resource_reservations rr
       set status = 'consumed'
     where rr.booking_id = b.id
       and rr.status = 'held'
       and rr.expires_at > clock_timestamp();
    get diagnostics consumed_resource_count = row_count;
    if consumed_resource_count <> resource_link_count then
      raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
    end if;
  else
    -- Existing capacity-hold path, retained exactly from 0032.
    perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:' || b.tenant_id::text || ':' || sid::text, 0));
    select * into h from public.capacity_holds where booking_id = b.id for update;
    if not found or h.tenant_id <> b.tenant_id or h.service_id <> sid
       or h.slot_start <> b.slot_start or h.slot_end <> b.slot_end or h.group_id is not null then
      raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
    end if;
    if b.state = 'confirmed' then
      if b.payment_id is distinct from p.id or h.status <> 'consumed' then
        raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023';
      end if;
      return jsonb_build_object('bookingId', b.id, 'paymentId', p.id, 'state', 'confirmed', 'replayed', true);
    end if;
    if b.state not in ('draft', 'pending_payment') then
      raise exception 'CONFIRMATION_STATE_INVALID' using errcode = '40001';
    end if;
    was_active := h.status = 'active';
    if not (was_active or h.status = 'consumed')
       or (was_active and (not isfinite(h.expires_at) or h.expires_at <= clock_timestamp())) then
      raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
    end if;
    if was_active then
      confirmation_deadline := h.expires_at;
      if not public.consume_hold(b.id) then
        raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
      end if;
    end if;
    if was_active and h.expires_at <= clock_timestamp() then
      raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
    end if;
  end if;

  if b.state = 'draft' then
    update public.bookings set state = 'pending_payment' where id = b.id;
  end if;
  update public.bookings set payment_id = p.id, state = 'confirmed' where id = b.id;
  -- Preserve the original first-confirmation hold deadline across state triggers.
  if confirmation_deadline is not null and confirmation_deadline <= clock_timestamp() then
    raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
  end if;
  -- The booking row is already serialized by the existing payment-first writer.
  -- A conflicting or failed envelope insert aborts the complete confirmation.
  -- Replays return above: no duplicate enqueue and no historical backfill.
  insert into public.durable_outbox(tenant_id,booking_id,event_type,dedup_key,payload,max_attempts)
  values(b.tenant_id,b.id,'booking.confirmed',b.id,'{}'::jsonb,5);
  -- Outbox triggers are part of this transaction; late work must roll it all back.
  if confirmation_deadline is not null and confirmation_deadline <= clock_timestamp() then
    raise exception 'CONFIRMATION_HOLD_INVALID' using errcode = '40001';
  end if;
  return jsonb_build_object('bookingId', b.id, 'paymentId', p.id, 'state', 'confirmed', 'replayed', false);
end;
$fn$;
revoke all on function payment_internal.confirm_scoped_payment(uuid) from public,anon,authenticated,service_role;
create or replace function public.confirm_succeeded_payment(p_payment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $fn$
declare
  p public.payments%rowtype;
  b public.bookings%rowtype;
  h public.capacity_holds%rowtype;
  service_row public.services%rowtype;
  sid uuid;
  was_active boolean;
  confirmation_deadline timestamptz;
  resource_link_count integer := 0;
  resource_hold_count integer := 0;
  consumed_resource_count integer := 0;
  resource_id uuid;
  rental_periods numeric;
  rental_min_periods numeric;
  rental_max_periods numeric;
  total_amount numeric;
  deposit_amount numeric;
  charge_amount numeric;
  resource_linked boolean := false;
begin
  perform lumin.group_prefix(false);

  -- Preserve 0032's simple-service lock scope.  Rental confirmation adds the
  -- resources table fence only after the service archetype is known below.
  lock table public.service_resources, public.refunds in share mode;

  if p_payment_id is null then
    raise exception 'CONFIRMATION_INVALID' using errcode = '22023';
  end if;

  select * into p from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'CONFIRMATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Legacy authority only: reject BEFORE terminal no-op, dedupe or effects.
  if p.source_scope_id is not null or p.attempt_id is not null then
    raise exception 'SCOPED_PAYMENT_PROCESSING_DISABLED' using errcode='42501';
  end if;

  return payment_internal.confirm_scoped_payment(p_payment_id);
end;
$fn$;
revoke all on function public.confirm_succeeded_payment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_succeeded_payment(uuid) to service_role;
create function payment_internal.apply_payment_success(p_payment_id uuid,p_observed_amount bigint)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare p public.payments%rowtype; b public.bookings%rowtype; result jsonb;
begin
  -- Match confirm_succeeded_payment / record_refund_webhook table-before-row
  -- ordering. The confirmation authority still owns hold/resource validation.
  lock table public.service_resources, public.refunds in share mode;
  select * into p from public.payments where id=p_payment_id for update;
  if not found then return jsonb_build_object('result','NOT_FOUND'); end if;
  if p.state not in ('requires_payment','processing','succeeded')
    or exists(select 1 from public.payment_reviews where payment_id=p.id) then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  select * into b from public.bookings where id=p.booking_id for update;
  if not found or b.tenant_id is distinct from p.tenant_id then
    raise exception 'PAYMENT_BOOKING_MISMATCH' using errcode='22023'; end if;
  if b.state='confirmed' and p.state='succeeded' then
    result := payment_internal.confirm_scoped_payment(p.id);
    return result || jsonb_build_object('result','CONFIRMED');
  end if;
  if b.state not in ('draft','pending_payment') then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  if p_observed_amount is null or p_observed_amount <= 0 or p_observed_amount <> p.amount then
    return payment_internal.park_scoped_payment(p.id,'amount_mismatch',p_observed_amount); end if;
  -- Roll back the temporary promotion if the canonical hold authority rejects
  -- capacity. Do not turn unrelated errors, deadlocks, or outages into reviews.
  begin
    update public.payments set state='succeeded' where id=p.id;
    result := payment_internal.confirm_scoped_payment(p.id);
  exception when sqlstate '40001' then
    if SQLERRM <> 'CONFIRMATION_HOLD_INVALID' then raise; end if;
    return payment_internal.park_scoped_payment(p.id,'capacity_oversold',p_observed_amount);
  end;
  return result || jsonb_build_object('result','CONFIRMED');
end $fn$;
revoke all on function payment_internal.apply_payment_success(uuid,bigint) from public,anon,authenticated,service_role;
create or replace function public.succeed_payment_webhook(p_payment_id uuid,p_observed_amount bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare p public.payments%rowtype; b public.bookings%rowtype; result jsonb;
begin
  -- Match confirm_succeeded_payment / record_refund_webhook table-before-row
  -- ordering. The confirmation authority still owns hold/resource validation.
  lock table public.service_resources, public.refunds in share mode;
  select * into p from public.payments where id=p_payment_id for update;
  if not found then return jsonb_build_object('result','NOT_FOUND'); end if;
  -- Legacy authority only: reject BEFORE terminal no-op, dedupe or effects.
  if p.source_scope_id is not null or p.attempt_id is not null then
    raise exception 'SCOPED_PAYMENT_PROCESSING_DISABLED' using errcode='42501';
  end if;

  return payment_internal.apply_payment_success(p_payment_id,p_observed_amount);
end;
$fn$;
revoke all on function public.succeed_payment_webhook(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.succeed_payment_webhook(uuid,bigint) to service_role;
create function payment_internal.park_scoped_payment(p_payment_id uuid,p_reason text,p_observed_amount bigint)
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
  return jsonb_build_object('result','PARKED','payment_id',p.id,'reason',p_reason);
end $fn$;
revoke all on function payment_internal.park_scoped_payment(uuid,text,bigint) from public,anon,authenticated,service_role;
create or replace function public.park_payment_webhook(p_payment_id uuid,p_reason text,p_observed_amount bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare p public.payments%rowtype; b public.bookings%rowtype;
begin
  select * into p from public.payments where id=p_payment_id for update;
  if not found then return jsonb_build_object('result','NOT_FOUND'); end if;
  -- Legacy authority only: reject BEFORE terminal no-op, dedupe or effects.
  if p.source_scope_id is not null or p.attempt_id is not null then
    raise exception 'SCOPED_PAYMENT_PROCESSING_DISABLED' using errcode='42501';
  end if;

  return payment_internal.park_scoped_payment(p_payment_id,p_reason,p_observed_amount);
end;
$fn$;
revoke all on function public.park_payment_webhook(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.park_payment_webhook(uuid,text,bigint) to service_role;
create function payment_internal.process_scoped_success_receipt(p_receipt_id uuid)
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
 effect:=payment_internal.apply_payment_success(p.id,r.amount_received);
 if effect->>'result'='CONFIRMED' then return jsonb_build_object('status','success_confirmed','replayed',effect->'replayed'); end if;
 if effect->>'result'='PARKED' then return jsonb_build_object('status','success_parked'); end if;
 if effect->>'result'='IGNORED' then return jsonb_build_object('status','success_ignored'); end if;
 raise exception 'PAYMENT_RECEIPT_UNAVAILABLE';
end$$;
revoke all on function payment_internal.process_scoped_success_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.process_scoped_success_receipt(uuid) to service_role;

comment on function payment_internal.process_scoped_success_receipt(uuid) is 'Dormant trusted-ingress v2 succeeded receipt decision only; SQL does not verify signatures. No ACK permission or refund/provider calls. Failure-first and hold-only parking semantics inherited, not complete recovery.';
commit;
