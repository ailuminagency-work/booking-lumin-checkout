/**
 * StripePaymentProvider threat-matrix tests — run entirely offline against the
 * deterministic fake Stripe (packages/adapters/test/fakeStripe.ts). No network.
 *
 * Each `it` is tagged with the threat-matrix item(s) it covers. Items that can
 * only be proven at the live edge-function / DB layer are listed at the bottom
 * of this file as explicit DEFERRED-TO-LIVE notes.
 */

import { describe, expect, it } from "vitest";
import { PaymentError } from "@lumin/contracts";
import { createStripePaymentProvider, signStripeTestWebhook } from "../src/stripePayment";
import { createFakeStripe } from "./fakeStripe";

const TENANT = "00000000-0000-4000-8000-000000000001";
const BOOKING = "00000000-0000-4000-8000-000000000002";
const WHSEC = "whsec_stripe_test_0001";
const NOW_SECONDS = 1_760_000_000;
const NOW_MS = NOW_SECONDS * 1000;

function makeProvider(nowMs = NOW_MS) {
  const fake = createFakeStripe({ webhookSecret: WHSEC, nowSeconds: Math.floor(nowMs / 1000) });
  const provider = createStripePaymentProvider({
    secretKey: "sk_test_dummy",
    webhookSecret: WHSEC,
    apiBase: "https://api.stripe.com",
    fetchImpl: fake.fetchImpl,
    now: () => nowMs,
  });
  return { fake, provider };
}

function intentInput(over: Partial<{ amount: number; currency: string; key: string }> = {}) {
  return {
    tenantId: TENANT,
    bookingId: BOOKING,
    amount: { amount: over.amount ?? 12_600, currency: over.currency ?? "USD" },
    idempotencyKey: over.key ?? "checkout-key-0000000001",
  };
}

describe("stripe createIntent — server amount authority (threat 1, 2)", () => {
  it("threat 1: createIntent charges the SERVER-computed amount in MINOR UNITS, currency lowercased", async () => {
    const { fake, provider } = makeProvider();
    // Hand-computed: 12000 base + 5% tax = 12600 minor units (USD cents = $126.00).
    const ref = await provider.createIntent(intentInput({ amount: 12_600 }));
    const stored = fake.getIntent(ref.intentId)!;
    expect(stored.amount).toBe(12_600); // exact minor units, no scaling
    expect(stored.currency).toBe("usd"); // lowercased for Stripe
    expect(stored.metadata).toMatchObject({ tenantId: TENANT, bookingId: BOOKING });
    // Returned ref carries the client token (Stripe client_secret), not a key.
    expect(ref.clientToken).toBe(stored.client_secret);
    expect(ref.clientToken).not.toContain("sk_test");
    expect(ref.amount).toEqual({ amount: 12_600, currency: "USD" });
    expect(ref.state).toBe("requires_payment");
  });

  it("threat 2: a non-positive amount is rejected BEFORE any Stripe call", async () => {
    const { fake, provider } = makeProvider();
    await expect(provider.createIntent(intentInput({ amount: 0 }))).rejects.toBeInstanceOf(PaymentError);
    await expect(provider.createIntent(intentInput({ amount: -500 }))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fake.createCalls()).toBe(0); // never reached the network
  });

  it("threat 2: a malformed (non-integer) amount is rejected", async () => {
    const { provider } = makeProvider();
    await expect(provider.createIntent(intentInput({ amount: 12.5 }))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(provider.createIntent(intentInput({ amount: Number.NaN }))).rejects.toBeInstanceOf(PaymentError);
  });

  it("the adapter API surface carries NO client-amount path (amount comes only from CreateIntentInput.amount)", async () => {
    const { fake, provider } = makeProvider();
    // Even if a caller tried to smuggle extra fields, only `.amount.amount` is read.
    const ref = await provider.createIntent({
      ...intentInput({ amount: 9_900 }),
      // @ts-expect-error — no such field exists on CreateIntentInput
      clientTotal: 1,
    });
    expect(fake.getIntent(ref.intentId)!.amount).toBe(9_900);
  });
});

describe("stripe getIntent — status mapping (threat 4, 5, 6, 7)", () => {
  it("maps every Stripe status to the contract PaymentState (fail-closed)", async () => {
    const cases: Array<[string, string]> = [
      ["requires_payment_method", "requires_payment"], // threat 5: incomplete
      ["requires_confirmation", "requires_payment"],
      ["requires_action", "requires_payment"],
      ["processing", "processing"],
      ["succeeded", "succeeded"], // threat 7
      ["canceled", "failed"], // threat 6
    ];
    for (const [stripeStatus, expected] of cases) {
      const { fake, provider } = makeProvider();
      const ref = await provider.createIntent(intentInput());
      fake.drive(ref.intentId, stripeStatus as never);
      const got = await provider.getIntent(ref.intentId);
      expect(got?.state, `${stripeStatus} → ${expected}`).toBe(expected);
    }
  });

  it("threat 4: a failed intent NEVER maps to succeeded", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    // Stripe expresses a hard payment failure as a return to requires_payment_method
    // (or canceled); neither is `succeeded`.
    fake.drive(ref.intentId, "canceled");
    expect((await provider.getIntent(ref.intentId))?.state).toBe("failed");
  });

  it("returns null for an unknown intent (404)", async () => {
    const { provider } = makeProvider();
    expect(await provider.getIntent("pi_test_does_not_exist")).toBeNull();
  });
});

describe("stripe idempotency — one charge (threat 8, 23)", () => {
  it("threat 8: same Idempotency-Key ⇒ ONE intent, never a second charge", async () => {
    const { fake, provider } = makeProvider();
    const a = await provider.createIntent(intentInput({ key: "dup-submit-key-00001" }));
    const b = await provider.createIntent(intentInput({ key: "dup-submit-key-00001" }));
    expect(b.intentId).toBe(a.intentId);
    expect(fake.intents()).toHaveLength(1);
  });

  it("threat 23: idempotency-key reuse with an ALTERED amount returns the ORIGINAL (altered amount ignored)", async () => {
    const { fake, provider } = makeProvider();
    const original = await provider.createIntent(intentInput({ amount: 12_600, key: "reuse-altered-000001" }));
    // Attacker retries the SAME key but with a tampered lower amount.
    const replayed = await provider.createIntent(intentInput({ amount: 1, key: "reuse-altered-000001" }));
    expect(replayed.intentId).toBe(original.intentId);
    expect(replayed.amount.amount).toBe(12_600); // NOT 1
    expect(fake.getIntent(original.intentId)!.amount).toBe(12_600);
    expect(fake.intents()).toHaveLength(1);
  });

  it("a DIFFERENT key mints a distinct intent (superseding retry after failure)", async () => {
    const { fake, provider } = makeProvider();
    await provider.createIntent(intentInput({ key: "first-attempt-000001" }));
    await provider.createIntent(intentInput({ key: "first-attempt-000001#retry1" }));
    expect(fake.intents()).toHaveLength(2);
  });
});

describe("stripe cancel + refund (threat 6; refund mapping)", () => {
  it("threat 6: cancelIntent drives an unpaid intent to canceled → state failed", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    await provider.cancelIntent(ref.intentId);
    expect(fake.getIntent(ref.intentId)!.status).toBe("canceled");
    expect((await provider.getIntent(ref.intentId))?.state).toBe("failed");
  });

  it("full and partial refunds map correctly; over-refund is rejected", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput({ amount: 10_000 }));
    fake.drive(ref.intentId, "succeeded");
    const partial = await provider.refund(ref.intentId, { amount: 4_000, currency: "USD" });
    expect(partial.refundId).toMatch(/^re_test_/);
    await provider.refund(ref.intentId, { amount: 6_000, currency: "USD" }); // completes to full
    expect(fake.refunds(ref.intentId)).toHaveLength(2);
    // Over-refund beyond captured total is rejected by Stripe.
    await expect(provider.refund(ref.intentId, { amount: 1, currency: "USD" })).rejects.toBeInstanceOf(PaymentError);
  });

  it("refund rejects a non-positive amount before any call", async () => {
    const { provider } = makeProvider();
    await expect(provider.refund("pi_test_1", { amount: 0, currency: "USD" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});

describe("stripe parseWebhook — real signature scheme (threat 10, 11, 12)", () => {
  it("threat 7: verifies a correctly-signed payment_intent.succeeded and normalizes it", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    fake.drive(ref.intentId, "succeeded");
    const { payload, header } = fake.webhook("payment_intent.succeeded", ref.intentId);
    const event = await provider.parseWebhook(payload, header);
    expect(event).toMatchObject({ kind: "payment_succeeded", intentId: ref.intentId });
  });

  it("normalizes payment_failed and refund_completed (with intent from payment_intent field)", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    const failed = fake.webhook("payment_intent.payment_failed", ref.intentId);
    expect(await provider.parseWebhook(failed.payload, failed.header)).toMatchObject({
      kind: "payment_failed",
      intentId: ref.intentId,
    });
    fake.drive(ref.intentId, "succeeded");
    const refunded = fake.webhook("charge.refunded", ref.intentId);
    expect(await provider.parseWebhook(refunded.payload, refunded.header)).toMatchObject({
      kind: "refund_completed",
      intentId: ref.intentId, // resolved from data.object.payment_intent
    });
  });

  it("threat 12: a FORGED signature (wrong secret) → WEBHOOK_UNVERIFIED", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    const { payload } = fake.webhook("payment_intent.succeeded", ref.intentId);
    const forged = signStripeTestWebhook(payload, "whsec_attacker_guess", NOW_SECONDS);
    await expect(provider.parseWebhook(payload, forged)).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
  });

  it("threat 12: a missing/malformed signature header → WEBHOOK_UNVERIFIED", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    const { payload } = fake.webhook("payment_intent.succeeded", ref.intentId);
    await expect(provider.parseWebhook(payload, null)).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
    await expect(provider.parseWebhook(payload, "")).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
    await expect(provider.parseWebhook(payload, "garbage")).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
    await expect(provider.parseWebhook(payload, "t=abc,v1=zz")).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
  });

  it("threat 12: a tampered PAYLOAD with an otherwise-valid-looking header → WEBHOOK_UNVERIFIED", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    const { payload, header } = fake.webhook("payment_intent.succeeded", ref.intentId);
    const tampered = payload.replace(ref.intentId, "pi_attacker_swapped");
    await expect(provider.parseWebhook(tampered, header)).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
  });

  it("threat 11: a stale timestamp (> 5 min skew) is rejected even with a valid HMAC", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    const { payload } = fake.webhook("payment_intent.succeeded", ref.intentId);
    // Correctly signed, but 6 minutes in the past → outside tolerance.
    const staleTs = NOW_SECONDS - 6 * 60;
    const staleHeader = signStripeTestWebhook(payload, WHSEC, staleTs);
    await expect(provider.parseWebhook(payload, staleHeader)).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
    // A future timestamp beyond tolerance is likewise rejected.
    const futureHeader = signStripeTestWebhook(payload, WHSEC, NOW_SECONDS + 6 * 60);
    await expect(provider.parseWebhook(payload, futureHeader)).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
  });

  it("threat 11: a replayed byte-identical delivery still VERIFIES at the adapter (dedup is the booking layer's job)", async () => {
    // The adapter is intentionally stateless: it re-verifies the same signed
    // bytes as authentic. Deduplication (no double effect) is proven at the
    // engine layer in paymentConsistency.test.ts and enforced in the DB by the
    // unique (provider, provider_intent_id) constraint (SI-3).
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    fake.drive(ref.intentId, "succeeded");
    const { payload, header } = fake.webhook("payment_intent.succeeded", ref.intentId);
    const first = await provider.parseWebhook(payload, header);
    const second = await provider.parseWebhook(payload, header);
    expect(first).toMatchObject({ kind: "payment_succeeded", intentId: ref.intentId });
    expect(second).toMatchObject({ kind: "payment_succeeded", intentId: ref.intentId });
  });

  it("an unrecognized event type verifies but normalizes to `unrecognized`", async () => {
    const { fake, provider } = makeProvider();
    const ref = await provider.createIntent(intentInput());
    const { payload, header } = fake.webhook("payment_intent.created", ref.intentId);
    expect(await provider.parseWebhook(payload, header)).toMatchObject({ kind: "unrecognized" });
  });
});

/**
 * ───────────────────────── DEFERRED TO LIVE RUN ─────────────────────────
 * The following threat-matrix items require the live Supabase edge-function +
 * Postgres runtime (RLS, unique constraints, service_role) and are exercised by
 * the orchestrator against a real test-mode Stripe, not here:
 *   - threat 3  (cross-tenant intent access) — RLS on payments (SI-4).
 *   - threat 13 (wrong PaymentIntent for booking) — enforced by the DB mapping
 *     payments.provider_intent_id → booking_id; the adapter cannot know booking
 *     linkage. Engine-level analogue (unknown intent cannot confirm) is proven
 *     in paymentConsistency.test.ts.
 *   - threats 9, 10, 29, 30 have engine-level proofs in paymentConsistency.test.ts;
 *     their DB-constraint backing (unique payment_id / provider_intent_id) is a
 *     live-run assertion.
 */
