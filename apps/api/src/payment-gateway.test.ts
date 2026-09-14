import { describe, it, expect } from "vitest";
import { createMockMerchantProviderA } from "@lumin/payments";
import { createMockPaymentGateway, createStripeTestPaymentGateway, PaymentDeclined } from "./payment-gateway";

// R2/R6: the gateway captures the SERVER amount server-side and never widens it;
// the mock needs zero credentials and the Stripe path keeps the secret off the
// wire except to Stripe.

describe("mock payment gateway (R2)", () => {
  it("captures exactly the server amount and reports the provider", async () => {
    const gw = createMockPaymentGateway();
    const res = await gw.charge({
      tenantId: "t",
      bookingId: "b",
      amount: { amount: 9350, currency: "USD" },
      idempotencyKey: "idem-key-abcdefgh",
    });
    expect(res.amount).toEqual({ amount: 9350, currency: "USD" });
    expect(res.provider).toBe("mock-merchant-a");
    expect(res.chargeId).toMatch(/^mock-merchant-a_chg_/);
  });

  it("is idempotent on the booking key — one capture per key", async () => {
    const gw = createMockPaymentGateway();
    const input = { tenantId: "t", bookingId: "b", amount: { amount: 100, currency: "USD" }, idempotencyKey: "k".repeat(20) };
    const a = await gw.charge(input);
    const b = await gw.charge(input);
    expect(a.chargeId).toBe(b.chargeId);
  });

  it("refunds a prior capture", async () => {
    const gw = createMockPaymentGateway();
    const cap = await gw.charge({
      tenantId: "t",
      bookingId: "b",
      amount: { amount: 500, currency: "USD" },
      idempotencyKey: "refundable-key-1234",
    });
    const refund = await gw.refund(cap.chargeId, { amount: 500, currency: "USD" }, "refundable-key-1234");
    expect(refund.refundId).toContain(cap.chargeId);
  });

  it("declines when the provider does not serve the currency", async () => {
    // Provider A settles USD/EUR only; a JPY charge is a decline, not a confirm.
    const gw = createMockPaymentGateway(createMockMerchantProviderA());
    await expect(
      gw.charge({ tenantId: "t", bookingId: "b", amount: { amount: 100, currency: "JPY" }, idempotencyKey: "jpy-key-abcdefgh12" }),
    ).rejects.toBeInstanceOf(PaymentDeclined);
  });
});

describe("stripe TEST gateway (R6 secret boundary)", () => {
  it("sends the amount + idempotency key and never the secret to the caller", async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetchImpl = (async (url: unknown, init: unknown) => {
      const i = init as { headers: Record<string, string>; body: string };
      calls.push({ url: String(url), headers: i.headers, body: i.body });
      return { ok: true, json: async () => ({ id: "pi_test_1", status: "succeeded", amount: 9350, currency: "usd" }) };
    }) as unknown as typeof fetch;
    const gw = createStripeTestPaymentGateway("sk_test_SECRET", { fetchImpl });
    const res = await gw.charge({
      tenantId: "t",
      bookingId: "b",
      amount: { amount: 9350, currency: "USD" },
      idempotencyKey: "stripe-key-abcdefgh",
    });
    expect(res).toEqual({ chargeId: "pi_test_1", provider: "stripe", amount: { amount: 9350, currency: "USD" } });
    // The secret is present only as the Authorization bearer to Stripe, and the
    // Idempotency-Key is the booking key (no double-charge on retry).
    expect(calls[0]!.headers.Authorization).toBe("Bearer sk_test_SECRET");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("stripe-key-abcdefgh");
    expect(calls[0]!.body).toContain("amount=9350");
    expect(JSON.stringify(res)).not.toContain("sk_test_SECRET");
  });

  it("treats a non-succeeded intent as a decline", async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ id: "pi_x", status: "requires_action", amount: 1, currency: "usd" }) })) as unknown as typeof fetch;
    const gw = createStripeTestPaymentGateway("sk_test_x", { fetchImpl });
    await expect(
      gw.charge({ tenantId: "t", bookingId: "b", amount: { amount: 1, currency: "USD" }, idempotencyKey: "k".repeat(20) }),
    ).rejects.toBeInstanceOf(PaymentDeclined);
  });
});
