/**
 * amountMismatch.test.ts — F6 (defense-in-depth): confirmFromPayment must assert
 * the provider-verified intent amount equals the booking's AUTHORITATIVE charge
 * (server total + deposit) before confirming. A succeeded intent whose amount
 * does not match must throw PAYMENT_AMOUNT_MISMATCH and NEVER confirm.
 */

import { describe, expect, it } from "vitest";
import {
  CreateBookingRequest,
  CustomerDetails,
  Money,
  PaymentError,
  PaymentIntentRef,
  PaymentProvider,
} from "@lumin/contracts";
import { createBookingEngine } from "../src/booking";
import { makeService, policy, rule, TENANT, uuid } from "./helpers";

const SERVICE = uuid(30);
const SLOT = "2026-01-05T16:00:00.000Z"; // Mon 10:00 CST
const NOW = "2026-01-04T00:00:00.000Z";

const customer: CustomerDetails = { name: "Ada Lovelace", email: "ada@example.com" };

/**
 * A stub PaymentProvider whose getIntent reports `succeeded` but at a tamperable
 * amount, so we can drive the F6 assertion directly. createIntent records the
 * intent at the amount the engine computed (booking reaches pending_payment).
 */
function stubProvider(overrideGetAmount: (real: Money) => Money): {
  provider: PaymentProvider;
  intentIdFor: (bookingId: string) => string | undefined;
} {
  const byBooking = new Map<string, { intentId: string; amount: Money }>();
  const provider: PaymentProvider = {
    providerName: "stub",
    async createIntent(input) {
      const intentId = `pi_stub_${byBooking.size + 1}`;
      byBooking.set(input.bookingId, { intentId, amount: input.amount });
      const ref: PaymentIntentRef = {
        intentId,
        clientToken: `${intentId}_secret`,
        state: "requires_payment",
        amount: input.amount,
      };
      return ref;
    },
    async getIntent(intentId) {
      for (const { intentId: id, amount } of byBooking.values()) {
        if (id === intentId) {
          return { intentId, clientToken: `${intentId}_secret`, state: "succeeded", amount: overrideGetAmount(amount) };
        }
      }
      return null;
    },
    async cancelIntent() {},
    async refund() {
      return { refundId: "re_stub" };
    },
    async parseWebhook() {
      return { kind: "unrecognized", intentId: null, raw: null };
    },
  };
  return { provider, intentIdFor: (b) => byBooking.get(b)?.intentId };
}

function makeEngine(provider: PaymentProvider) {
  return createBookingEngine({
    services: [makeService({ id: SERVICE, basePrice: 12_000, taxRateBp: 500 })], // total 12600, deposit 0
    rules: [1, 2, 3, 4, 5].map((weekday) => rule({ weekday, startMinute: 540, endMinute: 1020, capacity: 1 })),
    overrides: [],
    policy: policy(),
    tenantTimezone: "America/Chicago",
    payments: provider,
    now: () => NOW,
  });
}

function request(): CreateBookingRequest {
  return {
    tenantId: TENANT,
    idempotencyKey: "checkout-key-0000000001",
    selection: { serviceId: SERVICE, itemQuantities: {}, addonIds: [], answers: {} },
    slotStart: SLOT,
    customer,
  };
}

describe("F6: confirmFromPayment amount assertion", () => {
  it("throws PAYMENT_AMOUNT_MISMATCH and does NOT confirm when the intent amount is short by one minor unit", async () => {
    const { provider, intentIdFor } = stubProvider((real) => ({ amount: real.amount - 1, currency: real.currency }));
    const engine = makeEngine(provider);
    const record = await engine.createBooking(request());
    expect(record.state).toBe("pending_payment");
    const intentId = intentIdFor(record.id)!;

    await expect(engine.confirmFromPayment(intentId)).rejects.toMatchObject({
      code: "PAYMENT_AMOUNT_MISMATCH",
    });
    expect(engine.getBooking(record.id)?.state).toBe("pending_payment"); // never confirmed
  });

  it("throws PAYMENT_AMOUNT_MISMATCH on a currency mismatch", async () => {
    const { provider, intentIdFor } = stubProvider((real) => ({ amount: real.amount, currency: "EUR" }));
    const engine = makeEngine(provider);
    const record = await engine.createBooking(request());
    const intentId = intentIdFor(record.id)!;
    await expect(engine.confirmFromPayment(intentId)).rejects.toBeInstanceOf(PaymentError);
    expect(engine.getBooking(record.id)?.state).toBe("pending_payment");
  });

  it("confirms normally when the intent amount matches the authoritative charge (total + deposit)", async () => {
    const { provider, intentIdFor } = stubProvider((real) => real); // exact match
    const engine = makeEngine(provider);
    const record = await engine.createBooking(request());
    const intentId = intentIdFor(record.id)!;
    const confirmed = await engine.confirmFromPayment(intentId);
    expect(confirmed.state).toBe("confirmed");
  });
});
