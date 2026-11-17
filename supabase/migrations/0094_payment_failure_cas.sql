-- 0094 payment failure compare-and-set
--
-- A delayed payment_intent.payment_failed/canceled webhook must never regress
-- a payment that was already succeeded, parked for review, or refunded. The
-- webhook needs one database-authoritative decision that locks the payment row,
-- changes only an unresolved requires_payment state, releases its hold, and
-- fails the still-open booking. Keeping the sequence in one function closes
-- the race between a failure delivery and a concurrent succeeded delivery.
begin;

create or replace function public.fail_payment_webhook(p_payment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_payment public.payments%rowtype;
  v_booking_state text;
  v_changed integer;
begin
  select * into v_payment
    from public.payments
   where id = p_payment_id
   for update;

  if not found then
    return jsonb_build_object('result', 'NOT_FOUND');
  end if;

  -- processing is also the durable park state from 0090. It must remain open
  -- for a human decision, just like all terminal financial outcomes.
  if v_payment.state in ('processing', 'succeeded', 'refunded', 'partially_refunded', 'failed') then
    return jsonb_build_object('result', 'IGNORED', 'state', v_payment.state);
  end if;

  -- Only an unresolved intent may be failed by this event. The predicate is
  -- deliberately repeated on the update as a compare-and-set guard.
  update public.payments
     set state = 'failed'
   where id = v_payment.id
     and state = 'requires_payment';
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    return jsonb_build_object('result', 'IGNORED', 'state', v_payment.state);
  end if;

  perform lumin.release_hold(v_payment.booking_id);

  update public.bookings
     set state = 'failed'
   where id = v_payment.booking_id
     and state in ('draft', 'pending_payment');
  get diagnostics v_changed = row_count;
  select state into v_booking_state from public.bookings where id = v_payment.booking_id;

  return jsonb_build_object(
    'result', 'FAILED',
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'booking_state', v_booking_state
  );
end
$fn$;

revoke all on function public.fail_payment_webhook(uuid) from public, anon, authenticated, service_role;
grant execute on function public.fail_payment_webhook(uuid) to service_role;

comment on function public.fail_payment_webhook(uuid) is
  'Atomic server-only compare-and-set for payment failure webhooks. Locks the payment row, ignores processing/terminal/replayed states, and only then releases the hold and fails an open booking. Never callable by client roles.';

commit;
