-- 0096 webhook transaction authority
--
-- Stripe success, refund, and parked-review deliveries all contend on the same
-- payment row. These service-only RPCs make that row lock cover every financial
-- side effect, so a refund can never land between success and confirmation.
begin;

create or replace function public.park_payment_webhook(
  p_payment_id uuid,
  p_reason text,
  p_observed_amount bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment
    from public.payments
   where id = p_payment_id
   for update;
  if not found then
    return jsonb_build_object('result', 'NOT_FOUND');
  end if;
  if p_reason not in ('amount_mismatch', 'capacity_oversold') then
    raise exception 'PARK_INVALID_REASON' using errcode = '22023';
  end if;

  -- A parked payment is already a human decision point. A refund that won the
  -- row lock first must not be regressed back to processing.
  if v_payment.state in ('processing', 'refunded', 'partially_refunded', 'failed') then
    return jsonb_build_object('result', 'IGNORED', 'state', v_payment.state);
  end if;
  if v_payment.state not in ('requires_payment', 'succeeded') then
    return jsonb_build_object('result', 'IGNORED', 'state', v_payment.state);
  end if;

  insert into public.payment_reviews(
    payment_id, tenant_id, booking_id, reason, provider, provider_intent_id,
    expected_amount, observed_amount, currency
  )
  values(
    v_payment.id, v_payment.tenant_id, v_payment.booking_id, p_reason,
    v_payment.provider, v_payment.provider_intent_id, v_payment.amount,
    p_observed_amount, v_payment.currency
  )
  on conflict (payment_id) do nothing;

  update public.payments set state = 'processing' where id = v_payment.id;
  perform lumin.release_hold(v_payment.booking_id);
  return jsonb_build_object('result', 'PARKED', 'payment_id', v_payment.id);
end
$fn$;

create or replace function public.record_refund_webhook(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_refunded_total bigint,
  p_is_fully_refunded boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_payment public.payments%rowtype;
  v_booking public.bookings%rowtype;
  v_recorded_total bigint;
  v_delta bigint;
  v_full boolean;
begin
  if p_provider_refund_id is null or length(p_provider_refund_id) < 1
     or p_refunded_total is null or p_refunded_total <= 0 then
    raise exception 'REFUND_INVALID' using errcode = '22023';
  end if;

  -- confirm_succeeded_payment takes SHARE locks on service_resources/refunds
  -- before the payment row. Take a compatible table lock first so the two
  -- authorities cannot deadlock while contending on the same payment.
  lock table public.service_resources, public.refunds in row exclusive mode;

  -- Success confirmation then locks this exact payment before its booking.
  -- Using the same order here means one side wins the race and the other sees
  -- the resolved state instead of producing refunded+confirmed.
  select * into v_payment
    from public.payments
   where id = p_payment_id
   for update;
  if not found then
    return jsonb_build_object('result', 'NOT_FOUND');
  end if;
  select * into v_booking
    from public.bookings
   where id = v_payment.booking_id
   for update;
  if not found or v_booking.tenant_id <> v_payment.tenant_id then
    raise exception 'REFUND_MISMATCH' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.refunds
     where provider = v_payment.provider
       and provider_refund_id = p_provider_refund_id
  ) then
    return jsonb_build_object('result', 'IGNORED', 'reason', 'duplicate_refund');
  end if;

  -- Stripe reports a cumulative amount_refunded. Store only the monotonic
  -- delta so partial->full events sum to the payment amount rather than
  -- over-counting (30 + 100 must become 100, not 130).
  if p_refunded_total > v_payment.amount then
    raise exception 'REFUND_INVALID' using errcode = '22023';
  end if;
  select coalesce(sum(amount), 0)::bigint into v_recorded_total
    from public.refunds
   where payment_id = v_payment.id
     and provider = v_payment.provider;
  v_delta := p_refunded_total - v_recorded_total;
  v_full := p_refunded_total >= v_payment.amount;
  if p_is_fully_refunded is distinct from v_full then
    raise exception 'REFUND_INVALID' using errcode = '22023';
  end if;

  if v_delta <= 0 then
    -- An out-of-order older event carries no new money and must not regress a
    -- previously fully-refunded payment to partially_refunded.
    if v_full and v_payment.state <> 'refunded' then
      update public.payments set state = 'refunded' where id = v_payment.id;
      update public.bookings
         set state = 'refunded'
       where id = v_booking.id
         and state in ('confirmed', 'completed', 'cancelled');
    end if;
    return jsonb_build_object('result', 'IGNORED', 'reason', 'out_of_order_refund');
  end if;

  insert into public.refunds(
    tenant_id, booking_id, payment_id, amount, currency, reason,
    provider, provider_refund_id
  )
  values(
    v_payment.tenant_id, v_payment.booking_id, v_payment.id, v_delta,
    v_payment.currency, 'stripe_refund_webhook', v_payment.provider,
    p_provider_refund_id
  );

  update public.payments
     set state = case when v_full then 'refunded' else 'partially_refunded' end
   where id = v_payment.id;

  if v_full then
    update public.bookings
       set state = 'refunded'
     where id = v_booking.id
       and state in ('confirmed', 'completed', 'cancelled');
  end if;

  return jsonb_build_object(
    'result', 'RECORDED',
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'full', v_full
  );
end
$fn$;

revoke all on function public.park_payment_webhook(uuid, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.record_refund_webhook(uuid, text, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.park_payment_webhook(uuid, text, bigint) to service_role;
grant execute on function public.record_refund_webhook(uuid, text, bigint, boolean) to service_role;

comment on function public.park_payment_webhook(uuid, text, bigint) is
  'Atomic server-only park for a succeeded webhook whose amount or hold cannot be honored. Locks payment, records one review, moves to processing, and releases capacity without refunding.';
comment on function public.record_refund_webhook(uuid, text, bigint, boolean) is
  'Atomic server-only refund reconciliation. Locks payment then booking in the same order as confirmation, dedupes the provider refund, and prevents refunded+confirmed races.';

commit;
