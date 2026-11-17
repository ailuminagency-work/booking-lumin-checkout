-- 0098 refund event-shape authority
--
-- Stripe charge.refunded events report a cumulative amount_refunded, while
-- standalone Refund objects report only their individual amount. The previous
-- RPC treated both shapes as cumulative, so two bare refunds (30 then 70)
-- recorded 30 and 40 and could leave the payment partially_refunded. Keep the
-- same lock order as confirmation/refund authority, but make the event shape an
-- explicit input and derive terminal state from the accumulated rows.
begin;

drop function if exists public.record_refund_webhook(uuid, text, bigint, boolean);

create function public.record_refund_webhook(
  p_payment_id uuid,
  p_provider_refund_id text,
  p_refunded_total bigint,
  p_is_fully_refunded boolean,
  p_is_cumulative boolean
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
  v_reported_total bigint;
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
    return jsonb_build_object(
      'result', 'IGNORED',
      'reason', 'duplicate_refund',
      'full', v_payment.state = 'refunded'
    );
  end if;

  select coalesce(sum(amount), 0)::bigint into v_recorded_total
    from public.refunds
   where payment_id = v_payment.id
     and provider = v_payment.provider;

  -- Charge events are cumulative; bare Refund events are individual deltas.
  -- Always derive `v_full` from the accumulated amount, never from the bare
  -- event's local amount or a client-controlled state label.
  if p_is_cumulative then
    v_reported_total := p_refunded_total;
  else
    v_reported_total := v_recorded_total + p_refunded_total;
  end if;

  if v_reported_total > v_payment.amount then
    raise exception 'REFUND_INVALID' using errcode = '22023';
  end if;
  v_delta := v_reported_total - v_recorded_total;
  v_full := v_reported_total >= v_payment.amount;

  -- Stripe's cumulative Charge flag can be checked directly. For a bare
  -- Refund, the event's amount is not the accumulated total, so the database
  -- calculation above is authoritative and the flag is intentionally ignored.
  if p_is_cumulative and p_is_fully_refunded is distinct from v_full then
    raise exception 'REFUND_INVALID' using errcode = '22023';
  end if;

  if v_delta <= 0 then
    -- An out-of-order older cumulative event carries no new money and must not
    -- regress a previously fully-refunded payment to partially_refunded.
    if v_full and v_payment.state <> 'refunded' then
      update public.payments set state = 'refunded' where id = v_payment.id;
      update public.bookings
         set state = 'refunded'
       where id = v_booking.id
         and state in ('confirmed', 'completed', 'cancelled');
    end if;
    return jsonb_build_object(
      'result', 'IGNORED',
      'reason', 'out_of_order_refund',
      'full', v_full
    );
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

revoke all on function public.record_refund_webhook(uuid, text, bigint, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_refund_webhook(uuid, text, bigint, boolean, boolean) to service_role;

comment on function public.record_refund_webhook(uuid, text, bigint, boolean, boolean) is
  'Atomic server-only refund reconciliation. Charge totals are cumulative; bare Refund amounts are accumulated as deltas under the payment lock, with provider-ID dedupe and monotonic state.';

commit;

