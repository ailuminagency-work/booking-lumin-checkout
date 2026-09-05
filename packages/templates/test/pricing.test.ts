import { describe, expect, it } from "vitest";
import { Service } from "@lumin/contracts";
import { createPricingEngine } from "@lumin/core";
import { listTemplates } from "../src/registry";
import { DEMO_CURRENCY, DEMO_TENANT, DEMO_TIMEZONE, templateCases } from "./fixtures";

const pricing = createPricingEngine();

describe("templates produce valid, schema-checked services", () => {
  it("builds all eight templates into contracts-valid Services", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(8);
    for (const t of templates) {
      const service = t.build({ tenantId: DEMO_TENANT, currency: DEMO_CURRENCY, timezone: DEMO_TIMEZONE });
      // build() already runs Service.parse; parsing again must be a no-op.
      expect(() => Service.parse(service)).not.toThrow();
      expect(service.archetype).toBe(t.archetype);
      expect(service.currency).toBe(DEMO_CURRENCY);
      expect(service.tenantId).toBe(DEMO_TENANT);
    }
  });
});

describe("every template prices deterministically on the shared pricing engine", () => {
  for (const c of templateCases()) {
    it(`${c.key}: subtotal ${c.subtotal}, tax ${c.tax}, deposit ${c.deposit}, total ${c.total}`, () => {
      const bd = pricing.price(c.service, c.selection);
      expect(bd.subtotal.amount).toBe(c.subtotal);
      expect(bd.tax.amount).toBe(c.tax);
      expect(bd.deposit.amount).toBe(c.deposit);
      expect(bd.total.amount).toBe(c.total);
      // Currency flows through untouched — no engine-side currency assumptions.
      expect(bd.total.currency).toBe(DEMO_CURRENCY);
    });
  }
});

describe("housekeeping recurring frequency multiplier stacks on the depth multiplier", () => {
  it("applies weekly ×0.8 after deep ×1.5", () => {
    const [hk] = templateCases().filter((c) => c.key === "housekeeping");
    const service = hk!.service;
    // additive 23500 → deep ×1.5 = 35250 → weekly ×0.8 = round(35250×0.8)=28200
    const bd = pricing.price(service, {
      serviceId: service.id,
      itemQuantities: {},
      addonIds: ["inside-fridge"],
      answers: {
        bedrooms: { choiceIds: [], quantity: 3 },
        bathrooms: { choiceIds: [], quantity: 2 },
        depth: { choiceIds: ["deep"] },
        frequency: { choiceIds: ["weekly"] },
      },
    });
    expect(bd.subtotal.amount).toBe(28_200);
    expect(bd.total.amount).toBe(28_200);
  });
});

describe("malformed template configuration fails loudly at build time", () => {
  it("Service.parse rejects an out-of-range multiplier via the template validator", () => {
    // Bypass the well-formed builders: a hand-rolled bad config must be rejected
    // by the same Service schema the templates validate against.
    expect(() =>
      Service.parse({
        id: "00000000-0000-4000-8000-000000000999",
        tenantId: DEMO_TENANT,
        archetype: "configurable",
        name: "Bad",
        currency: DEMO_CURRENCY,
        questions: [
          {
            id: "q",
            prompt: "q",
            kind: "single_choice",
            choices: [{ id: "c", label: "c", priceMultiplierBp: -1 }],
          },
        ],
      }),
    ).toThrow();
  });
});
