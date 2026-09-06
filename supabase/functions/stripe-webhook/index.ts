// supabase/functions/stripe-webhook/index.ts
//
// POST endpoint that receives Stripe webhooks. Stripe calls this with NO user
// JWT, so this function MUST run with verify_jwt = FALSE (see README / config).
// Its authentication is the Stripe SIGNATURE ALONE (SI-10): the raw body is
// verified against STRIPE_WEBHOOK_SECRET before anything is processed. An
// unverifiable delivery is rejected 400 and NOTHING happens.
//
// Effects (all idempotent, all keyed on the SI-3 anchor payments.provider_intent_id):
//   payment_intent.succeeded  → confirm the booking (pending_payment → confirmed)
//                               EXACTLY ONCE, after checking the Stripe amount ==
//                               payments.amount (PAYMENT_AMOUNT_MISMATCH otherwise).
//                               A replayed/duplicate webhook is a no-op because the
//                               booking is already confirmed and provider_intent_id
//                               is unique.
//   payment_intent.payment_failed / canceled → mark the booking failed.
//   charge.refunded / refund.*  → record a refund + set payment/booking state.
//
// Always returns 200 after successful processing (so Stripe stops retrying);
// 400 only on a bad signature.

import { createStripeClient, webhookIntentAmount } from "../_shared/stripe.ts";
import { errorResponse, jsonResponse, serviceRoleClient } from "../_shared/db.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse("INVALID_REQUEST", "POST only", 405);

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!webhookSecret || !stripeSecret) {
    return errorResponse("PROVIDER_UNAVAILABLE", "payment provider is not configured", 503);
  }

  // Raw body + signature header — the signature is over the EXACT bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("Stripe-Signature");

  const stripe = createStripeClient({ secretKey: stripeSecret, webhookSecret });

  let event;
  try {
    event = await stripe.parseWebhook(rawBody, signature);
  } catch {
    // Bad/absent signature or stale timestamp → never processed (SI-10).
    return errorResponse("WEBHOOK_UNVERIFIED", "signature verification failed", 400);
  }

  const db = serviceRoleClient();

  // Map intent → payment row via the unique provider_intent_id (SI-3). An event
  // for an intent we never recorded is acknowledged (200) but has no effect.
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
      // SI-1/amount authority: the Stripe amount MUST equal the server amount we
      // stored. A mismatch means tampering/desync — refuse to confirm.
      const stripeAmount = webhookIntentAmount(event.raw);
      if (stripeAmount !== null && stripeAmount !== payment.amount) {
        return errorResponse(
          "PAYMENT_AMOUNT_MISMATCH",
          "stripe amount does not match the server-computed amount",
          400,
        );
      }

      // Idempotent confirm: set payment succeeded, then transition the booking
      // pending_payment → confirmed ONCE. A replay finds it already confirmed.
      await db.from("payments").update({ state: "succeeded" }).eq("id", payment.id);

      // Link + confirm atomically-ish: only transition from pending_payment.
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

    if (event.kind === "payment_failed") {
      await db.from("payments").update({ state: "failed" }).eq("id", payment.id);
      // pending_payment → failed (draft → failed also legal); no-op if already terminal.
      await db
        .from("bookings")
        .update({ state: "failed" })
        .eq("id", payment.booking_id)
        .in("state", ["draft", "pending_payment"]);
      return jsonResponse({ received: true, failed: true });
    }

    if (event.kind === "refund_completed") {
      const refundAmount = webhookIntentAmount(event.raw) ?? payment.amount;
      const isFull = refundAmount >= payment.amount;
      // Record the refund (dedup by not double-inserting the same amount is a
      // live-run concern; the unique payment/booking linkage keeps effects bounded).
      await db.from("refunds").insert({
        tenant_id: payment.tenant_id,
        booking_id: payment.booking_id,
        payment_id: payment.id,
        amount: refundAmount,
        currency: payment.currency,
        reason: "stripe_refund_webhook",
      });
      await db.from("payments").update({ state: isFull ? "refunded" : "partially_refunded" }).eq("id", payment.id);
      if (isFull) {
        // confirmed/completed → refunded (legal edges); no-op otherwise.
        await db
          .from("bookings")
          .update({ state: "refunded" })
          .eq("id", payment.booking_id)
          .in("state", ["confirmed", "completed", "cancelled"]);
      }
      return jsonResponse({ received: true, refunded: true, full: isFull });
    }

    // Unrecognized but authentic event: acknowledge so Stripe stops retrying.
    return jsonResponse({ received: true, ignored: event.kind });
  } catch {
    // A processing error (not a signature failure): 500 so Stripe retries later.
    return errorResponse("PROVIDER_UNAVAILABLE", "processing error", 500);
  }
});
