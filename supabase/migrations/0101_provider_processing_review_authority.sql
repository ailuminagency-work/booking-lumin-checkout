-- Source candidate only: this branch does not include reserved 0099/0100.
-- No hosted attestation or deployment is implied.
begin;

create function lumin.guard_payment_review_writer()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare p public.payments%rowtype; b public.bookings%rowtype;
begin
  -- A row UPDATE/DELETE already owns the review tuple. Never wait for the
  -- parent here: park owns parent before review. NOWAIT forces the competing
  -- review writer to retry its complete transaction instead of deadlocking.
  select * into p from public.payments
    where id = case when TG_OP = 'DELETE' then OLD.payment_id else NEW.payment_id end
    for update nowait;
  if TG_OP = 'DELETE' then
    raise exception 'PAYMENT_REVIEW_HISTORY_IMMUTABLE' using errcode = '23514';
  end if;
  if not found or NEW.tenant_id is distinct from p.tenant_id
    or NEW.booking_id is distinct from p.booking_id
    or NEW.provider is distinct from p.provider
    or NEW.provider_intent_id is distinct from p.provider_intent_id
    or NEW.expected_amount is distinct from p.amount
    or NEW.currency is distinct from p.currency then
    raise exception 'PAYMENT_REVIEW_IDENTITY_INVALID' using errcode = '23514';
  end if;
  if TG_OP = 'UPDATE' and NEW.payment_id is distinct from OLD.payment_id then
    raise exception 'PAYMENT_REVIEW_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  if TG_OP = 'INSERT' then
    select * into b from public.bookings where id = p.booking_id for update nowait;
    if not found or b.tenant_id is distinct from p.tenant_id then
      raise exception 'PAYMENT_REVIEW_IDENTITY_INVALID' using errcode = '23514';
    end if;
    if p.state in ('failed','refunded','partially_refunded')
      or b.state not in ('draft','pending_payment') then
      raise exception 'PAYMENT_REVIEW_LATE_INSERT' using errcode = '23514';
    end if;
  end if;
  return NEW;
end $fn$;
revoke all on function lumin.guard_payment_review_writer() from public, anon, authenticated, service_role;
create trigger payment_review_writer_guard before insert or update or delete
on public.payment_reviews for each row execute function lumin.guard_payment_review_writer();

create or replace function public.park_payment_webhook(p_payment_id uuid,p_reason text,p_observed_amount bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
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

create or replace function public.fail_payment_webhook(p_payment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
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

create function public.succeed_payment_webhook(p_payment_id uuid,p_observed_amount bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
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
    result := public.confirm_succeeded_payment(p.id);
    return result || jsonb_build_object('result','CONFIRMED');
  end if;
  if b.state not in ('draft','pending_payment') then
    return jsonb_build_object('result','IGNORED','state',p.state); end if;
  if p_observed_amount is null or p_observed_amount <= 0 or p_observed_amount <> p.amount then
    return public.park_payment_webhook(p.id,'amount_mismatch',p_observed_amount); end if;
  -- Roll back the temporary promotion if the canonical hold authority rejects
  -- capacity. Do not turn unrelated errors, deadlocks, or outages into reviews.
  begin
    update public.payments set state='succeeded' where id=p.id;
    result := public.confirm_succeeded_payment(p.id);
  exception when sqlstate '40001' then
    if SQLERRM <> 'CONFIRMATION_HOLD_INVALID' then raise; end if;
    return public.park_payment_webhook(p.id,'capacity_oversold',p_observed_amount);
  end;
  return result || jsonb_build_object('result','CONFIRMED');
end $fn$;
revoke all on function public.succeed_payment_webhook(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.succeed_payment_webhook(uuid,bigint) to service_role;
-- Existing fail/park grants remain service-only under CREATE OR REPLACE.
commit;
