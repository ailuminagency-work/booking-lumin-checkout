/**
 * paymentConsistency.test.ts — engine-level payment consistency proofs using
 * the REAL StripePaymentProvider (packages/adapters/src/stripePayment.ts)
 * injected into the booking engine, driven by the deterministic fake Stripe
 * (packages/adapters/test/fakeStripe.ts). No network, no live DB.
 *
 * This proves the ENGINE upholds the same invariants with the Stripe adapter as
 * with the mock: confirmation still requires a provider-verified `succeeded`
 * intent, one payment maps to one booking, and duplicate finalize / duplicate
 * webhook produce no double effect. Each `it` cites its threat-matrix item(s).
 */

import { describe, expect, it } from "vitest";
import { BookingError, CreateBookingRequest, CustomerDetails, PaymentError } from "@lumin/contracts";
import { createStripePaymentProvider } from "@lumin/adapters";
import { createBookingEngine } from "../src/booking";
import { createFakeStripe } from "../../adapters/test/fakeStripe";
import { makeService, policy, rule, TENANT, uuid } from "./helpers";

const SERVICE = uuid(30);
const SLOT = "2026-01-05T16:00:00.000Z"; // Mon 10:00 CST
const NOW = "2026-01-04T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const WHSEC = "whsec_core_consistency_0001";

const customer: CustomerDetails = { name: "Ada Lovelace", email: "ada@example.com" };

function makeEngine() {
  const fake = createFakeStripe({ webhookSecret: WHSEC, nowSeconds: Math.floor(NOW_MS / 1000) });
  const payments = createStripePaymentProvider({
    secretKey: "sk_test_dummy",
    webhookSecret: WHSEC,
    fetchImpl: fake.fetchImpl,
    now: () => NOW_MS,
  });
  const engine = createBookingEngine({
    // 12000 base + 5% tax = 12600 minor units (hand-computed).
    services: [makeService({ id: SERVICE, basePrice: 12_000, taxRateBp: 500 })],
    rules: [1, 2, 3, 4, 5].map((weekday) => rule({ weekday, startMinute: 540, endMinute: 1020, capacity: 1 })),
    overrides: [],
    policy: policy(),
    tenantTimezone: "America/Chicago",
    payments,
    now: () => NOW,
  });
  return { engine, payments, fake };
}

function request(over: Partial<CreateBookingRequest> = {}): CreateBookingRequest {
  return {
    tenantId: TENANT,
    idempotencyKey: "checkout-key-0000000001",
    selection: { serviceId: SERVICE, itemQuantities: {}, addonIds: [], answers: {} },
    slotStart: SLOT,
    customer,
    ...over,
  };
}

async function expectPaymentCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable(`expected PaymentError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).code).toBe(code);
  }
}

describe("engine + stripe: server-priced intent (threat 1)", () => {
  it("opens the Stripe intent for the SERVER-computed total in minor units, never a client number", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    expect(record.state).toBe("pending_payment");
    expect(record.pricing.total).toEqual({ amount: 12_600, currency: "USD" });
    const intentId = engine.intentIdForBooking(record.id)!;
    const stored = fake.getIntent(intentId)!;
    expect(stored.amount).toBe(12_600); // exact server total, minor units
    expect(stored.currency).toBe("usd");
    expect(stored.metadata).toMatchObject({ tenantId: TENANT, bookingId: record.id });
  });
});

describe("engine + stripe: confirmation requires verified success (threat 4, 5, 6, 7)", () => {
  it("threat 7: confirms only after the provider reports succeeded", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "succeeded");
    const confirmed = await engine.confirmFromPayment(intentId);
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.paymentId).not.toBeNull();
    expect(engine.getHistory(record.id).map((h) => `${h.from}>${h.to}`)).toEqual([
      "draft>pending_payment",
      "pending_payment>confirmed",
    ]);
  });

  it("threat 5: an incomplete intent (still requires_payment) does NOT confirm", async () => {
    const { engine } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    // Never driven: fake reports requires_payment_method → mapped requires_payment.
    await expectPaymentCode(engine.confirmFromPayment(intentId), "PAYMENT_FAILED");
    expect(engine.getBooking(record.id)?.state).toBe("pending_payment");
  });

  it("threat 6: a canceled intent maps to failed and does NOT confirm", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "canceled");
    await expectPaymentCode(engine.confirmFromPayment(intentId), "PAYMENT_FAILED");
    expect(engine.getBooking(record.id)?.state).toBe("failed");
    expect(engine.getHistory(record.id).some((h) => h.to === "confirmed")).toBe(false);
  });

  it("threat 4: a processing (not-yet-succeeded) intent does NOT confirm", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "processing");
    await expectPaymentCode(engine.confirmFromPayment(intentId), "PAYMENT_FAILED");
    expect(engine.getBooking(record.id)?.state).toBe("pending_payment");
  });
});

describe("engine + stripe: one payment ⇒ one booking (threat 8, 29)", () => {
  it("threat 29/8: idempotent create ⇒ exactly one Stripe intent and one booking", async () => {
    const { engine, fake } = makeEngine();
    const a = await engine.createBooking(request());
    const b = await engine.createBooking(request());
    expect(b.id).toBe(a.id);
    expect(fake.intents()).toHaveLength(1); // Idempotency-Key collapsed the retry
    expect(engine.listBookings(TENANT)).toHaveLength(1);
  });

  it("threat 29: a concurrent duplicate submit still yields one intent and one booking", async () => {
    const { engine, fake } = makeEngine();
    const [a, b] = await Promise.all([engine.createBooking(request()), engine.createBooking(request())]);
    expect(a.id).toBe(b.id);
    expect(fake.intents()).toHaveLength(1);
    expect(engine.listBookings(TENANT)).toHaveLength(1);
  });
});

describe("engine + stripe: duplicate finalize / webhook (threat 9, 10)", () => {
  it("threat 9: a duplicate finalize (confirmFromPayment called twice) confirms exactly once", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "succeeded");
    const first = await engine.confirmFromPayment(intentId);
    const second = await engine.confirmFromPayment(intentId);
    expect(second.id).toBe(first.id);
    expect(second.paymentId).toBe(first.paymentId); // same single payment linkage
    expect(engine.getHistory(record.id).filter((h) => h.to === "confirmed")).toHaveLength(1);
  });

  it("threat 10/11: a replayed verified webhook drives the SAME confirm — no double effect", async () => {
    const { engine, fake, payments } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "succeeded");

    // First webhook delivery: verify + confirm.
    const first = fake.webhook("payment_intent.succeeded", intentId);
    const ev1 = await payments.parseWebhook(first.payload, first.header);
    expect(ev1.kind).toBe("payment_succeeded");
    await engine.confirmFromPayment(ev1.intentId!);

    // Byte-identical REPLAY of the same signed event: still authentic at the
    // adapter, but confirmation is idempotent so it is a no-op (SI-3).
    const ev2 = await payments.parseWebhook(first.payload, first.header);
    await engine.confirmFromPayment(ev2.intentId!);

    expect(engine.getBooking(record.id)?.state).toBe("confirmed");
    expect(engine.getHistory(record.id).filter((h) => h.to === "confirmed")).toHaveLength(1);
  });
});

describe("engine + stripe: intent↔booking binding (threat 13, 30)", () => {
  it("threat 13: an intent the engine never minted can confirm NOTHING", async () => {
    const { engine } = makeEngine();
    const record = await engine.createBooking(request());
    await expectPaymentCode(engine.confirmFromPayment("pi_test_foreign_999"), "INVALID_REQUEST");
    expect(engine.getBooking(record.id)?.state).toBe("pending_payment");
  });

  it("threat 13: booking A's intent confirms ONLY booking A, never booking B", async () => {
    const { engine, fake } = makeEngine();
    const a = await engine.createBooking(request({ idempotencyKey: "cust-a-key-00000001", slotStart: SLOT }));
    const b = await engine.createBooking(
      request({
        idempotencyKey: "cust-b-key-00000001",
        slotStart: "2026-01-06T16:00:00.000Z", // Tue — a different open slot
        customer: { name: "Bob", email: "bob@example.com" },
      }),
    );
    const intentA = engine.intentIdForBooking(a.id)!;
    fake.drive(intentA, "succeeded");
    const confirmed = await engine.confirmFromPayment(intentA);
    expect(confirmed.id).toBe(a.id);
    expect(engine.getBooking(a.id)?.state).toBe("confirmed");
    expect(engine.getBooking(b.id)?.state).toBe("pending_payment"); // untouched
  });

  it("threat 30: a booking carries exactly one payment linkage; a replay adds no second", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "succeeded");
    const confirmed = await engine.confirmFromPayment(intentId);
    const paymentId = confirmed.paymentId;
    expect(paymentId).not.toBeNull();
    // Re-confirming with the same (only) intent is idempotent — paymentId is stable.
    const again = await engine.confirmFromPayment(intentId);
    expect(again.paymentId).toBe(paymentId);
    // The engine maps this booking to exactly one intent.
    expect(engine.intentIdForBooking(record.id)).toBe(intentId);
  });
});

describe("engine + stripe: payment failure ends the booking (threat 4)", () => {
  it("a failed intent (canceled at Stripe) moves the booking to terminal failed", async () => {
    const { engine, fake } = makeEngine();
    const record = await engine.createBooking(request());
    const intentId = engine.intentIdForBooking(record.id)!;
    fake.drive(intentId, "canceled");
    await expectPaymentCode(engine.confirmFromPayment(intentId), "PAYMENT_FAILED");
    expect(engine.getBooking(record.id)?.state).toBe("failed");
    // Recovery: a same-key retry supersedes the dead booking (D5) and can succeed.
    const retry = await engine.createBooking(request());
    expect(retry.id).not.toBe(record.id);
    const retryIntent = engine.intentIdForBooking(retry.id)!;
    expect(retryIntent).not.toBe(intentId);
    fake.drive(retryIntent, "succeeded");
    const confirmed = await engine.confirmFromPayment(retryIntent);
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed).toBeDefined();
  });
});

// Guard against accidental engine coupling to Stripe: this suite only reaches
// Stripe through the PaymentProvider contract. (Static grep enforced separately.)
void BookingError;
