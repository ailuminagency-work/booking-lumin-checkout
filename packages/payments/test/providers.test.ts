import { describe, expect, it } from "vitest";
import {
  CreateChargeInput,
  MerchantPaymentProvider,
  createMockMerchantProviderA,
  createMockMerchantProviderB,
  selectProvider,
} from "../src/index";

const TENANT = "00000000-0000-4000-8000-000000000001";

function charge(
  amount: number,
  currency: string,
  country: string,
  method: CreateChargeInput["method"],
  key: string,
): CreateChargeInput {
  return {
    tenantId: TENANT,
    reference: "booking-1",
    amount: { amount, currency },
    country: country as CreateChargeInput["country"],
    method,
    idempotencyKey: key,
  };
}

describe("provider A (mock-merchant-a): declared capabilities honored", () => {
  it("declares card+wallet, auth/capture, saved methods; US/EU, USD/EUR", () => {
    const a = createMockMerchantProviderA();
    expect(a.capability.methods).toEqual(["card", "wallet"]);
    expect(a.capability.supportsAuthCapture).toBe(true);
    expect(a.capability.supportsPartialRefund).toBe(false);
    expect(a.capability.supportsMarketplace).toBe(false);
  });

  it("creates and captures a direct charge (US/USD/card)", async () => {
    const a = createMockMerchantProviderA();
    const c = await a.createCharge(charge(10_000, "USD", "US", "card", "k1"));
    expect(c.state).toBe("captured");
    expect(c.captured.amount).toBe(10_000);
    expect(c.provider).toBe("mock-merchant-a");
    expect(a.listCharges()).toHaveLength(1);
  });

  it("is idempotent on idempotencyKey", async () => {
    const a = createMockMerchantProviderA();
    const first = await a.createCharge(charge(5_000, "USD", "US", "card", "same"));
    const second = await a.createCharge(charge(5_000, "USD", "US", "card", "same"));
    expect(second.chargeId).toBe(first.chargeId);
    expect(a.listCharges()).toHaveLength(1);
  });

  it("rejects an unsupported currency (JPY) with PROVIDER_UNAVAILABLE", async () => {
    const a = createMockMerchantProviderA();
    await expect(a.createCharge(charge(1000, "JPY", "US", "card", "k2"))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects an unsupported method (bank_transfer) with PROVIDER_UNAVAILABLE", async () => {
    const a = createMockMerchantProviderA();
    await expect(
      a.createCharge(charge(1000, "USD", "US", "bank_transfer", "k3")),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("rejects a marketplace op it does not support", async () => {
    const a = createMockMerchantProviderA();
    await expect(
      a.onboardMarketplaceAccount({ tenantId: TENANT, sellerRef: "s1", country: "US", currency: "USD" }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(a.listMarketplaceAccounts()).toHaveLength(0);
  });

  it("rejects a partial refund it does not support", async () => {
    const a = createMockMerchantProviderA();
    const c = await a.createCharge(charge(10_000, "USD", "US", "card", "k4"));
    await expect(a.partialRefund(c.chargeId, { amount: 2_000, currency: "USD" })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("supports the auth/capture flow", async () => {
    const a = createMockMerchantProviderA();
    const auth = await a.authorize(charge(8_000, "USD", "US", "card", "auth1"));
    expect(auth.state).toBe("authorized");
    expect(auth.captured.amount).toBe(0);

    const captured = await a.capture(auth.chargeId);
    expect(captured.state).toBe("captured");
    expect(captured.captured.amount).toBe(8_000);
  });

  it("supports partial capture (capture less than authorized)", async () => {
    const a = createMockMerchantProviderA();
    const auth = await a.authorize(charge(8_000, "USD", "US", "card", "auth2"));
    const captured = await a.capture(auth.chargeId, { amount: 5_000, currency: "USD" });
    expect(captured.state).toBe("captured");
    expect(captured.captured.amount).toBe(5_000);
  });

  it("supports a full refund", async () => {
    const a = createMockMerchantProviderA();
    const c = await a.createCharge(charge(10_000, "USD", "US", "card", "k5"));
    const refunded = await a.refund(c.chargeId);
    expect(refunded.state).toBe("refunded");
    expect(refunded.refunded.amount).toBe(10_000);
  });

  it("supports the saved-method flow", async () => {
    const a = createMockMerchantProviderA();
    const saved = await a.saveMethod({
      tenantId: TENANT,
      customerRef: "cust-1",
      method: "card",
      country: "US",
      currency: "USD",
    });
    expect(saved.provider).toBe("mock-merchant-a");
    expect(a.listSavedMethods()).toHaveLength(1);

    const c = await a.chargeSavedMethod(saved.savedMethodId, charge(3_000, "USD", "US", "card", "saved-k1"));
    expect(c.state).toBe("captured");
    expect(c.method).toBe("card");
  });
});

describe("provider B (mock-merchant-b): declared capabilities honored", () => {
  it("declares card+bank_transfer+local_scheme, partial refunds, marketplace; MX/BR, MXN/BRL", () => {
    const b = createMockMerchantProviderB();
    expect(b.capability.methods).toEqual(["card", "bank_transfer", "local_scheme"]);
    expect(b.capability.supportsPartialRefund).toBe(true);
    expect(b.capability.supportsMarketplace).toBe(true);
    expect(b.capability.supportsAuthCapture).toBe(false);
  });

  it("rejects auth/capture it does not support", async () => {
    const b = createMockMerchantProviderB();
    await expect(b.authorize(charge(1000, "MXN", "MX", "card", "b-auth"))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects a wallet method it does not present", async () => {
    const b = createMockMerchantProviderB();
    await expect(b.createCharge(charge(1000, "MXN", "MX", "wallet", "b-wallet"))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects an unsupported currency (USD) with PROVIDER_UNAVAILABLE", async () => {
    const b = createMockMerchantProviderB();
    await expect(b.createCharge(charge(1000, "USD", "MX", "card", "b-usd"))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("supports a partial refund, tracking state and remaining refundable", async () => {
    const b = createMockMerchantProviderB();
    const c = await b.createCharge(charge(10_000, "MXN", "MX", "local_scheme", "b-k1"));
    expect(c.state).toBe("captured");

    const r1 = await b.partialRefund(c.chargeId, { amount: 3_000, currency: "MXN" });
    expect(r1.state).toBe("partially_refunded");
    expect(r1.refunded.amount).toBe(3_000);

    const r2 = await b.partialRefund(c.chargeId, { amount: 7_000, currency: "MXN" });
    expect(r2.state).toBe("refunded");
    expect(r2.refunded.amount).toBe(10_000);
  });

  it("rejects a partial refund exceeding the captured amount", async () => {
    const b = createMockMerchantProviderB();
    const c = await b.createCharge(charge(5_000, "MXN", "MX", "card", "b-k2"));
    await expect(b.partialRefund(c.chargeId, { amount: 9_999, currency: "MXN" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("supports marketplace onboarding", async () => {
    const b = createMockMerchantProviderB();
    const acct = await b.onboardMarketplaceAccount({
      tenantId: TENANT,
      sellerRef: "seller-1",
      country: "MX",
      currency: "MXN",
    });
    expect(acct.provider).toBe("mock-merchant-b");
    expect(acct.onboardingComplete).toBe(true);
    expect(b.listMarketplaceAccounts()).toHaveLength(1);
  });

  it("supports the saved-method flow", async () => {
    const b = createMockMerchantProviderB();
    const saved = await b.saveMethod({
      tenantId: TENANT,
      customerRef: "cust-b",
      method: "bank_transfer",
      country: "MX",
      currency: "MXN",
    });
    const c = await b.chargeSavedMethod(saved.savedMethodId, charge(2_000, "MXN", "MX", "card", "b-saved"));
    // Charges the STORED method (bank_transfer), not the requested one.
    expect(c.method).toBe("bank_transfer");
    expect(c.state).toBe("captured");
  });
});

describe("the SAME routing + contract code drives both providers (abstraction proof)", () => {
  const providers: Record<string, MerchantPaymentProvider> = {
    "mock-merchant-a": createMockMerchantProviderA(),
    "mock-merchant-b": createMockMerchantProviderB(),
  };

  it("routes a US card charge to A and a MX local_scheme charge to B, via one code path", async () => {
    const cases = [
      { country: "US", currency: "USD", method: "card", expect: "mock-merchant-a" },
      { country: "MX", currency: "MXN", method: "local_scheme", expect: "mock-merchant-b" },
    ] as const;

    for (const [i, tc] of cases.entries()) {
      const decision = selectProvider({
        country: tc.country,
        currency: tc.currency,
        methodPreference: tc.method,
      });
      expect(decision.outcome).toBe("matched");
      if (decision.outcome !== "matched") continue;
      expect(decision.provider).toBe(tc.expect);

      // Identical downstream call against whichever provider routing chose.
      const provider = providers[decision.provider]!;
      const result = await provider.createCharge(
        charge(4_200, tc.currency, tc.country, tc.method, `abstraction-${i}`),
      );
      expect(result.state).toBe("captured");
      expect(result.provider).toBe(tc.expect);
    }
  });

  it("listSupportedMethods reflects each provider's distinct capability", () => {
    expect(providers["mock-merchant-a"]!.listSupportedMethods("US", "USD")).toEqual(["card", "wallet"]);
    expect(providers["mock-merchant-a"]!.listSupportedMethods("MX", "MXN")).toEqual([]);
    expect(providers["mock-merchant-b"]!.listSupportedMethods("MX", "MXN")).toEqual([
      "card",
      "bank_transfer",
      "local_scheme",
    ]);
  });
});
