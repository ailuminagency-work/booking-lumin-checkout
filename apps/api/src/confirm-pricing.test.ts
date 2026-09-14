import { describe, it, expect } from "vitest";
import { price, chargeAmount, PricingError, type Service, type Selection } from "./confirm-pricing";

// R3 (server-authoritative amount): the charge is derived ONLY from the server's
// service configuration + the stored selection. A Selection carries NO price
// field, so a client can never assert an amount — these tests pin the numbers
// the confirm route charges.

const service: Service = {
  id: "svc",
  archetype: "simple",
  name: "Deep clean",
  currency: "USD",
  basePrice: 5000,
  items: [],
  addons: [{ id: "wax", name: "Wax", price: 1500 }],
  questions: [
    {
      id: "size",
      prompt: "Size",
      kind: "single_choice",
      required: true,
      choices: [
        { id: "s", label: "Small", priceDelta: 0, priceMultiplierBp: 10000 },
        { id: "l", label: "Large", priceDelta: 2000, priceMultiplierBp: 10000 },
      ],
    },
  ],
  taxRateBp: 1000, // 10%
};

describe("confirm reprice (R3)", () => {
  it("charges base + addon + choice delta + tax, server-computed", () => {
    const selection: Selection = { serviceId: "svc", addonIds: ["wax"], answers: { size: { choiceIds: ["l"] } } };
    const breakdown = price(service, selection);
    // subtotal = 5000 + 1500 + 2000 = 8500; tax 10% = 850; total = 9350
    expect(breakdown.subtotal.amount).toBe(8500);
    expect(breakdown.tax.amount).toBe(850);
    expect(breakdown.total.amount).toBe(9350);
    expect(chargeAmount(breakdown)).toEqual({ amount: 9350, currency: "USD" });
  });

  it("prices from config, not from any client-supplied total", () => {
    // The same service + selection ALWAYS yields the same server amount; there is
    // no channel for a client 'amount' to influence it.
    const selection: Selection = { serviceId: "svc", answers: { size: { choiceIds: ["s"] } } };
    expect(chargeAmount(price(service, selection)).amount).toBe(5500); // 5000 + 10% tax
  });

  it("rejects a selection that cannot be priced", () => {
    const bad: Selection = { serviceId: "svc", answers: { size: { choiceIds: ["nope"] } } };
    expect(() => price(service, bad)).toThrow(PricingError);
  });

  it("rejects a non-positive charge amount", () => {
    const free: Service = { ...service, basePrice: 0, addons: [], questions: [], taxRateBp: 0 };
    expect(() => chargeAmount(price(free, { serviceId: "svc" }))).toThrow(PricingError);
  });
});
