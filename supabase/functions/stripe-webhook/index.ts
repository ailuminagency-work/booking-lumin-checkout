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
//        no-auto-refund-check.sh enforces that mechanically in CI.
//     A replayed succeeded event finds the booking already `confirmed` (or its
//        hold `consumed`) and is a no-op.
//
//   payment_intent.payment_failed / canceled → release_hold + booking failed.
//
//   charge.refunded / refund.*  → F4 refund accounting: record the refund keyed
//        by the Stripe refund id (dedup — a replay is a no-op), set the payment
//        to refunded / partially_refunded using amount_refunded, and drive the
//        booking to `refunded` ONLY when fully refunded.
//
// Always returns 200 after successful processing (so Stripe stops retrying);
// 400 only on a bad signature.

import { createStripeClient, interpretRefundEvent, webhookIntentAmount } from "../_shared/stripe.ts";
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

  const db = serviceRoleClient();

  const intentId = event.intentId;
  if (!intentId) return jsonResponse({ received: true, note: "no intent id" });

  const { data: payment } = await db
    .from("payments")
    .select("id, tenant_id, booking_id, amount, currency, state")
    .eq("provider", "stripe")
    .eq("provider_intent_id", intentId)
    .maybeSingle();
  if (!payment) return jsonResponse({ received: true, note: "unknown intent" });

  try {
    if (event.kind === "payment_succeeded") {
      return await handleSucceeded(db, event, payment, intentId);
    }

    if (event.kind === "payment_failed") {
      await db.from("payments").update({ state: "failed" }).eq("id", payment.id);
      // Return the slot to the pool immediately (F1) and fail the booking.
      await db.rpc("release_hold", { p_booking_id: payment.booking_id });
      await db
        .from("bookings")
        .update({ state: "failed" })
        .eq("id", payment.booking_id)
        .in("state", ["draft", "pending_payment"]);
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
  intentId: string,
): Promise<Response> {
  // Idempotent replay: the booking is already confirmed — nothing to do.
  const { data: booking } = await db
    .from("bookings")
    .select("id, state")
    .eq("id", payment.booking_id)
    .maybeSingle();
  if (booking?.state === "confirmed") {
    await db.from("payments").update({ state: "succeeded" }).eq("id", payment.id);
    return jsonResponse({ received: true, confirmed: true, note: "already confirmed (replay)" });
  }

  // Idempotent: a prior delivery already resolved this intent. `processing` means
  // it is parked awaiting a human (below); `refunded` means a person has already
  // refunded it by hand. Either way a replay must not re-decide it, and must not
  // confirm it.
  if (payment.state === "processing" || payment.state === "refunded") {
    return jsonResponse({ received: true, confirmed: false, note: `already resolved (${payment.state})` });
  }

  // F3 — AMOUNT GUARD, FAIL-CLOSED. A positive amount must be present AND equal
  // the server amount. Anything else (missing / null / ≤0 / mismatch) is a
  // desync or tampering: NEVER confirm — compensate.
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
      intentId,
      !amountOk ? "amount_mismatch" : "capacity_oversold",
      stripeAmount,
    );
  }

  // Confirm. Ensure the booking is in pending_payment first (defense against a
  // draft left behind by a failed state advance), then pending_payment→confirmed.
  await db.from("payments").update({ state: "succeeded" }).eq("id", payment.id);
  if (booking?.state === "draft") {
    await db.from("bookings").update({ state: "pending_payment" }).eq("id", payment.booking_id).eq("state", "draft");
  }
  if (holdActive) {
    await db.rpc("consume_hold", { p_booking_id: payment.booking_id });
  }
  await db.from("bookings").update({ payment_id: payment.id }).eq("id", payment.booking_id).is("payment_id", null);
  const { data: confirmed } = await db
    .from("bookings")
    .update({ state: "confirmed" })
    .eq("id", payment.booking_id)
    .eq("state", "pending_payment")
    .select("id, state")
    .maybeSingle();

  return jsonResponse({ received: true, confirmed: confirmed?.state === "confirmed" });
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
  intentId: string,
  reason: string,
  observedAmount: number | null,
): Promise<Response> {
  await db.from("payment_reviews").upsert(
    {
      payment_id: payment.id,
      tenant_id: payment.tenant_id,
      booking_id: payment.booking_id,
      reason,
      provider: "stripe",
      provider_intent_id: intentId,
      expected_amount: payment.amount,
      observed_amount: observedAmount,
      currency: payment.currency,
    },
    { onConflict: "payment_id", ignoreDuplicates: true },
  );
  await db.from("payments").update({ state: "processing" }).eq("id", payment.id);
  // A slot must not stay held for a payment nobody has resolved.
  await db.rpc("release_hold", { p_booking_id: payment.booking_id });
  return jsonResponse({ received: true, confirmed: false, parked: reason });
}

/**
 * F4 refund accounting. Uses amount_refunded (cumulative) — NOT the full amount
 * — to decide full vs partial, dedupes on the Stripe refund id, and drives the
 * booking to `refunded` ONLY when fully refunded (a partial refund records the
 * refund + marks the payment partially_refunded but leaves the booking state).
 */
async function handleRefund(
  db: Db,
  event: { raw: unknown },
  payment: PaymentRow,
  intentId: string,
): Promise<Response> {
  const outcome = interpretRefundEvent(event.raw, payment.amount);
  const refundedTotal = outcome.refundedTotal ?? payment.amount;
  // Stable dedupe key: prefer the Stripe refund id; fall back to a synthetic
  // (intent + cumulative total) so a replay of an id-less event still dedupes.
  const dedupeKey = outcome.refundId ?? `${intentId}:${refundedTotal}`;

  if (refundedTotal > 0) {
    await db.from("refunds").upsert(
      {
        tenant_id: payment.tenant_id,
        booking_id: payment.booking_id,
        payment_id: payment.id,
        amount: refundedTotal,
        currency: payment.currency,
        reason: "stripe_refund_webhook",
        provider: "stripe",
        provider_refund_id: dedupeKey,
      },
      { onConflict: "provider,provider_refund_id", ignoreDuplicates: true },
    );
  }

  await db
    .from("payments")
    .update({ state: outcome.isFullyRefunded ? "refunded" : "partially_refunded" })
    .eq("id", payment.id);

  if (outcome.isFullyRefunded) {
    await db
      .from("bookings")
      .update({ state: "refunded" })
      .eq("id", payment.booking_id)
      .in("state", ["confirmed", "completed", "cancelled"]);
  }

  return jsonResponse({ received: true, refunded: true, full: outcome.isFullyRefunded });
}
