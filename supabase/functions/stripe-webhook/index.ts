// supabase/functions/stripe-webhook/index.ts
//
// POST endpoint that receives Stripe webhooks. Stripe calls this with NO user
// JWT, so this function MUST run with verify_jwt = FALSE (see README / config).
// Its authentication is the Stripe SIGNATURE ALONE (SI-10): the raw body is
// verified against STRIPE_WEBHOOK_SECRET before anything is processed. An
// unverifiable delivery is rejected 400 and NOTHING happens.
//
// Effects use the legacy-only transactional boundary. Scoped rows are rejected.
// Existing provider/intent global uniqueness remains a required compatibility floor.
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
// Returns 200 only after handled processing. Bad signatures return 400;
// unavailable anchors and processing errors are retryable 5xx.

import {
  createStripeClient,
  interpretRefundEvent,
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

  // One legacy-only database transaction owns eligibility, locked amount and
  // financial action. Never route a scoped row by bare intent ID.
  if (!event.intentId) return errorResponse("PROVIDER_UNAVAILABLE", "payment is not available yet", 503);
  try {
    // The helper's full flag is deliberately ignored: only the locked database
    // payment amount can supply that comparison. No separate payment read.
    const refund = event.kind === "refund_completed" ? interpretRefundEvent(event.raw, 0) : null;
    const { data: outcome, error } = await serviceRoleClient().rpc("process_legacy_payment_webhook", {
      p_provider_intent_id: event.intentId,
      p_kind: event.kind,
      p_observed_amount: event.kind === "payment_succeeded" ? webhookIntentAmount(event.raw) : refund?.refundedTotal ?? null,
      p_refund_id: refund?.refundId ?? null,
      p_is_cumulative: refund?.isCumulative ?? false,
    });
    if (error) throw error;
    if (outcome?.result === "UNAVAILABLE") return errorResponse("PROVIDER_UNAVAILABLE", "payment is not available yet", 503);
    if (!outcome || outcome.received !== true) throw new Error("payment unavailable");
    return jsonResponse(outcome);
  } catch {
    return errorResponse("PROVIDER_UNAVAILABLE", "processing error", 500);
  }
});
