// supabase/functions/stripe-webhook/index.ts
//
// POST endpoint that receives Stripe webhooks. Stripe calls this with NO user
// JWT, so this function MUST run with verify_jwt = FALSE (see README / config).
// Its authentication is the Stripe SIGNATURE ALONE (SI-10): the raw body is
// verified against STRIPE_WEBHOOK_SECRET before anything is processed. An
// unverifiable delivery is rejected 400 and NOTHING happens.
//
// Effects (all idempotent, all keyed on the SI-3 anchor payments.provider_intent_id):
//
//   payment_intent.succeeded
//     F3 (amount guard, FAIL-CLOSED): confirm ONLY when a POSITIVE Stripe amount
//        is present AND equals the server payments.amount. Missing/null/≤0 or a
//        mismatch ⇒ NEVER confirm — route through the compensation path.
//     F1 (hold re-verify + PARK): re-verify the capacity hold is still 'active'
//        (or already 'consumed' for this booking) before confirming, then confirm
//        + consume_hold. If the hold is MISSING / EXPIRED / RELEASED at confirm
//        time (oversold or lost), DO NOT confirm — and DO NOT refund. Park the
//        payment for a human: payments.state := 'processing', one row in
//        public.payment_reviews, release the hold, leave the booking in its
//        non-terminal state, return 200 (handled). See migration 0090.
//
//        POLICY REVERSAL (0090): this used to issue a Stripe refund automatically
//        ("deterministic refund-on-oversell"). Booking Lumin must NEVER refund
//        automatically — moving a customer's money with no person deciding is the
//        action that rule exists to prevent, and it fired on a RACE (a hold
//        expiring between capture and webhook delivery), not on fraud. Nothing in
//        this function may invoke the provider's refund API; scripts/
//        no-auto-refund-check.sh enforces that mechanically in CI, and since the
//        refund primitive itself was deleted from _shared/stripe.ts there is no
//        longer anything here to invoke.
//     A replayed succeeded event finds the booking already `confirmed` (or its
//        hold `consumed`) and is a no-op.
//
//   payment_intent.payment_failed / canceled → release_hold + booking failed,
//     unless a delayed failure arrives after a terminal succeeded/refunded
//     payment, in which case it is acknowledged without regressing state.
//
//   charge.refunded / refund.*  → F4 refund accounting: record the refund keyed
//        by the Stripe refund id (dedup — a replay is a no-op), set the payment
//        to refunded / partially_refunded using amount_refunded, and drive the
//        booking to `refunded` ONLY when fully refunded.
//
// Always returns 200 after successful processing (so Stripe stops retrying);
// 400 only on a bad signature.

import {
  createStripeClient,
  interpretRefundEvent,
  shouldIgnoreStalePaymentFailure,
  webhookIntentAmount,
} from "../_shared/stripe.ts";
import { errorResponse, jsonResponse, serviceRoleClient } from "../_shared/db.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse("INVALID_REQUEST", "POST only", 405);

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!webhookSecret || !stripeSecret) {
    return errorResponse("PROVIDER_UNAVAILABLE", "payment provider is not configured", 503);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("Stripe-Signature");
  const stripe = createStripeClient({ secretKey: stripeSecret, webhookSecret });

  let event;
  try {
    event = await stripe.parseWebhook(rawBody, signature);
  } catch {
    return errorResponse("WEBHOOK_UNVERIFIED", "signature verification failed", 400);
  }

  // Only verified financial event kinds need payment persistence. Do not turn
  // irrelevant signed deliveries into database work or retry noise.
  if (event.kind === "unrecognized") return jsonResponse({ received: true, ignored: event.kind });

  const db = serviceRoleClient();

  const intentId = event.intentId;
  if (!intentId) return jsonResponse({ received: true, note: "no intent id" });

  const { data: payment, error: paymentLookupError } = await db
    .from("payments")
    .select("id, tenant_id, booking_id, amount, currency, state")
    .eq("provider", "stripe_connect")
    .eq("provider_intent_id", intentId)
    .maybeSingle();
  // A database outage is not proof that this intent is unknown. Acknowledge only
  // a successful lookup; retry valid deliveries whose persistence is unavailable.
  if (paymentLookupError) return errorResponse("PROVIDER_UNAVAILABLE", "payment lookup failed", 500);
  // The event may have arrived before the create-intent writer committed, or
  // after that writer lost its persistence response. Do not discard it as handled.
  // Provider-managed retries are finite; this is not a durable inbox.
  if (!payment) return errorResponse("PROVIDER_UNAVAILABLE", "payment is not available yet", 503);

  try {
    if (event.kind === "payment_succeeded") {
      return await handleSucceeded(db, event, payment);
    }

    if (event.kind === "payment_failed") {
      // Stripe can deliver delayed/canceled events after a succeeded, parked, or
      // refund event. The migration 0094 RPC locks the payment row and performs
      // the compare-and-set, hold release, and booking transition atomically.
      if (shouldIgnoreStalePaymentFailure(payment.state)) {
        return jsonResponse({ received: true, failed: false, note: "ignored stale failure" });
      }
      const { data: failure, error: failureError } = await db.rpc("fail_payment_webhook", {
        p_payment_id: payment.id,
      });
      if (failureError) throw failureError;
      if (!failure || failure.result !== "FAILED") {
        return jsonResponse({ received: true, failed: false, note: "ignored stale failure" });
      }
      return jsonResponse({ received: true, failed: true });
    }

    if (event.kind === "refund_completed") {
      return await handleRefund(db, event, payment, intentId);
    }

    return jsonResponse({ received: true, ignored: event.kind });
  } catch {
    // A processing error (not a signature failure): 500 so Stripe retries later.
    return errorResponse("PROVIDER_UNAVAILABLE", "processing error", 500);
  }
});

type Db = ReturnType<typeof serviceRoleClient>;
interface PaymentRow {
  id: string;
  tenant_id: string;
  booking_id: string;
  amount: number;
  currency: string;
  state: string;
}

async function handleSucceeded(
  db: Db,
  event: { raw: unknown },
  payment: PaymentRow,
): Promise<Response> {
  // A parked, failed, or refunded payment is already resolved by another
  // authority. Check this before the confirmed-booking replay branch: a stale
  // succeeded event must never rewrite a refunded payment back to succeeded.
  if (payment.state === "processing" || payment.state === "failed" || payment.state === "refunded" || payment.state === "partially_refunded") {
    return jsonResponse({ received: true, confirmed: false, note: "already resolved payment" });
  }

  const { data: booking } = await db
    .from("bookings")
    .select("id, state")
    .eq("id", payment.booking_id)
    .maybeSingle();
  // Idempotent replay: only a payment that is already succeeded may replay a
  // confirmed booking. A contradictory requires_payment+confirmed pair is not
  // allowed to become financially true here.
  if (payment.state === "succeeded" && booking?.state === "confirmed") {
    return jsonResponse({ received: true, confirmed: true, note: "already confirmed (replay)" });
  }

  if (payment.state !== "requires_payment" && payment.state !== "succeeded") {
    return jsonResponse({ received: true, confirmed: false, note: "ignored unsupported payment state" });
  }

  // F3 — AMOUNT GUARD, FAIL-CLOSED. A positive amount must be present AND equal
  // the server amount. Anything else (missing / null / ≤0 / mismatch) is a
  // desync or tampering: NEVER confirm — park it for a human (0090).
  const stripeAmount = webhookIntentAmount(event.raw);
  const amountOk = stripeAmount !== null && stripeAmount > 0 && stripeAmount === payment.amount;

  // F1 — HOLD RE-VERIFY. The hold must still be this booking's (active, or
  // already consumed by a prior confirm of THIS booking).
  const { data: hold } = await db
    .from("capacity_holds")
    .select("status, expires_at")
    .eq("booking_id", payment.booking_id)
    .maybeSingle();
  const holdActive = !!hold && hold.status === "active" && new Date(hold.expires_at).getTime() > Date.now();
  const holdConsumed = !!hold && hold.status === "consumed";
  const holdHonored = holdActive || holdConsumed;

  if (!amountOk || !holdHonored) {
    // PARK for a human (0090). No refund is issued here, ever.
    return await park(
      db,
      payment,
      !amountOk ? "amount_mismatch" : "capacity_oversold",
      stripeAmount,
    );
  }

  // Compare-and-set the payment state before entering the existing atomic
  // confirmation RPC. A concurrent failure/refund either wins this row race
  // (and this delivery becomes a no-op) or observes succeeded and cannot
  // regress it. The RPC then locks payment + booking + hold together.
  if (payment.state === "requires_payment") {
    const { data: advanced, error: advanceError } = await db
      .from("payments")
      .update({ state: "succeeded" })
      .eq("id", payment.id)
      .eq("state", "requires_payment")
      .select("id")
      .maybeSingle();
    if (advanceError) throw advanceError;
    if (!advanced) {
      return jsonResponse({ received: true, confirmed: false, note: "payment state changed before confirmation" });
    }
  }

  const { data: confirmed, error: confirmationError } = await db.rpc("confirm_succeeded_payment", {
    p_payment_id: payment.id,
  });
  if (confirmationError) throw confirmationError;
  return jsonResponse({
    received: true,
    confirmed: confirmed?.state === "confirmed",
    replayed: confirmed?.replayed === true,
  });
}

/**
 * F1 PARK (migration 0090). A succeeded intent that cannot be confirmed is handed
 * to a person instead of being refunded automatically.
 *
 * Order matters. The review row is written FIRST: if anything after it fails, the
 * outer catch returns 500, Stripe retries, and the replay is a no-op because the
 * row is keyed on payment_id. Writing it last would risk releasing the hold and
 * moving the payment with no record of why.
 *
 * `processing` is the park state because confirm_succeeded_payment requires
 * `succeeded` — so a parked payment cannot be turned into a booking by any later
 * automatic path, only by a person setting it back deliberately.
 *
 * The booking is intentionally NOT transitioned. `failed` is terminal in the 0005
 * transition table, and with the money still captured a terminal booking would
 * strand it; left at `pending_payment`, both `-> confirmed` (honour) and
 * `-> failed` (refund by hand) stay legal for the reviewer.
 *
 * Returns 200 (handled) so Stripe stops retrying a decision that is now a human's.
 */
async function park(
  db: Db,
  payment: PaymentRow,
  reason: string,
  observedAmount: number | null,
): Promise<Response> {
  const { data: parked, error: parkError } = await db.rpc("park_payment_webhook", {
    p_payment_id: payment.id,
    p_reason: reason,
    p_observed_amount: observedAmount,
  });
  if (parkError) throw parkError;
  if (!parked || parked.result !== "PARKED") {
    return jsonResponse({ received: true, confirmed: false, note: "payment state changed before parking" });
  }
  return jsonResponse({ received: true, confirmed: false, parked: reason });
}

/**
 * F4 refund accounting. Charge events carry amount_refunded (cumulative), while
 * bare Refund events carry an individual amount. The server-side RPC receives
 * the event shape and derives the accumulated total under the payment lock.
 */
async function handleRefund(
  db: Db,
  event: { raw: unknown },
  payment: PaymentRow,
  intentId: string,
): Promise<Response> {
  const outcome = interpretRefundEvent(event.raw, payment.amount);
  // Never infer a full refund when Stripe omitted the amount. A missing amount
  // is an acknowledged, non-mutating event until a later event contains a
  // verifiable amount.
  const refundedTotal = outcome.refundedTotal;
  if (refundedTotal === null) {
    return jsonResponse({ received: true, refunded: false, full: false, note: "refund amount unavailable" });
  }
  // Stable dedupe key: prefer the Stripe refund id; fall back to a synthetic
  // (intent + event shape + amount) so a replay of an id-less event still
  // dedupes without conflating cumulative Charge and individual Refund events.
  const dedupeKey = outcome.refundId ?? `${intentId}:${outcome.isCumulative ? "cumulative" : "individual"}:${refundedTotal}`;

  if (refundedTotal > 0) {
    const { data: recorded, error: refundError } = await db.rpc("record_refund_webhook", {
      p_payment_id: payment.id,
      p_provider_refund_id: dedupeKey,
      p_refunded_total: refundedTotal,
      p_is_fully_refunded: outcome.isFullyRefunded,
      p_is_cumulative: outcome.isCumulative,
    });
    if (refundError) throw refundError;
    return jsonResponse({
      received: true,
      refunded: recorded?.result === "RECORDED" || recorded?.result === "IGNORED",
      full: recorded?.full === true || outcome.isFullyRefunded,
    });
  }

  return jsonResponse({ received: true, refunded: false, full: outcome.isFullyRefunded });
}
