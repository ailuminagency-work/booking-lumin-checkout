import { describe, expect, it } from "vitest";
import { Selection, Service } from "@lumin/contracts";
import { createMockPaymentProvider } from "@lumin/adapters";
import { createBookingEngine } from "../src/booking";
import { createPricingEngine } from "../src/pricing";
import { makeService, policy, rule, TENANT, uuid } from "./helpers";

/**
 * Generalization proof: three unrelated verticals run on the SAME engines
 * with zero vertical-specific branches — each vertical is pure data.
 */

const pricing = createPricingEngine();

const junkRemoval: Service = makeService({
  id: uuid(40),
  archetype: "cart",
  name: "Junk Removal",
  items: [
    { id: "sofa", name: "Sofa", unitPrice: 7_500, minQty: 0, maxQty: 10 },
    { id: "mattress", name: "Mattress", unitPrice: 6_000, minQty: 0, maxQty: 10 },
    { id: "fridge", name: "Refrigerator", unitPrice: 9_000, minQty: 0, maxQty: 5 },
  ],
  addons: [
    { id: "zone-north", name: "North service area", price: 2_000 },
    { id: "stairs", name: "Stairs fee", price: 1_500 },
  ],
  taxRateBp: 825,
});
const junkSelection: Selection = {
  serviceId: junkRemoval.id,
  itemQuantities: { sofa: 2, fridge: 1 },
  addonIds: ["zone-north"],
  answers: {},
};

const carDetailing: Service = makeService({
  id: uuid(41),
  archetype: "configurable",
  name: "Car Detailing",
  questions: [
    {
      id: "package",
      prompt: "Detail package",
      kind: "single_choice",
      required: true,
      choices: [
        { id: "basic", label: "Basic", priceDelta: 8_000, priceMultiplierBp: 10_000 },
        { id: "deluxe", label: "Deluxe", priceDelta: 15_000, priceMultiplierBp: 10_000 },
      ],
    },
    {
      id: "vehicle",
      prompt: "Vehicle type",
      kind: "single_choice",
      required: true,
      choices: [
        { id: "sedan", label: "Sedan", priceDelta: 0, priceMultiplierBp: 10_000 },
        { id: "suv", label: "SUV", priceDelta: 0, priceMultiplierBp: 12_500 },
        { id: "truck", label: "Truck", priceDelta: 0, priceMultiplierBp: 15_000 },
      ],
    },
  ],
  addons: [{ id: "pet-hair", name: "Pet hair removal", price: 3_000 }],
  taxRateBp: 825,
});
const carSelection: Selection = {
  serviceId: carDetailing.id,
  itemQuantities: {},
  addonIds: ["pet-hair"],
  answers: { package: { choiceIds: ["deluxe"] }, vehicle: { choiceIds: ["suv"] } },
};

const houseCleaning: Service = makeService({
  id: uuid(42),
  archetype: "configurable",
  name: "House Cleaning",
  basePrice: 8_000,
  questions: [
    { id: "bedrooms", prompt: "Bedrooms", kind: "quantity", required: true, choices: [], unitPrice: 2_500, minQty: 0, maxQty: 10 },
    { id: "bathrooms", prompt: "Bathrooms", kind: "quantity", required: true, choices: [], unitPrice: 3_000, minQty: 1, maxQty: 8 },
    {
      id: "package",
      prompt: "Cleaning type",
      kind: "single_choice",
      required: true,
      choices: [
        { id: "standard", label: "Standard", priceDelta: 0, priceMultiplierBp: 10_000 },
        { id: "deep", label: "Deep clean", priceDelta: 0, priceMultiplierBp: 15_000 },
      ],
    },
  ],
  addons: [{ id: "fridge-interior", name: "Inside fridge", price: 2_000 }],
});
const cleaningSelection: Selection = {
  serviceId: houseCleaning.id,
  itemQuantities: {},
  addonIds: ["fridge-interior"],
  answers: {
    bedrooms: { choiceIds: [], quantity: 3 },
    bathrooms: { choiceIds: [], quantity: 2 },
    package: { choiceIds: ["deep"] },
  },
};

describe("generalization: one pricing engine, three verticals", () => {
  it("prices junk removal (cart) deterministically", () => {
    const bd = pricing.price(junkRemoval, junkSelection);
    // 2×7500 + 9000 + 2000 = 26000; tax round(26000×825/10000) = 2145
    expect(bd.subtotal.amount).toBe(26_000);
    expect(bd.total.amount).toBe(28_145);
  });

  it("prices car detailing (configurable with multipliers) deterministically", () => {
    const bd = pricing.price(carDetailing, carSelection);
    // (15000 + 3000) × 1.25 = 22500; tax round(22500×825/10000) = 1856
    expect(bd.subtotal.amount).toBe(22_500);
    expect(bd.total.amount).toBe(24_356);
  });

  it("prices house cleaning (configurable with quantities) deterministically", () => {
    const bd = pricing.price(houseCleaning, cleaningSelection);
    // (8000 + 3×2500 + 2×3000 + 2000) × 1.5 = 23500 × 1.5 = 35250; no tax
    expect(bd.subtotal.amount).toBe(35_250);
    expect(bd.total.amount).toBe(35_250);
  });
});

describe("generalization: one booking engine, three verticals end-to-end", () => {
  const cases: { name: string; service: Service; selection: Selection; expectedCharge: number }[] = [
    { name: "junk removal", service: junkRemoval, selection: junkSelection, expectedCharge: 28_145 },
    { name: "car detailing", service: carDetailing, selection: carSelection, expectedCharge: 24_356 },
    { name: "house cleaning", service: houseCleaning, selection: cleaningSelection, expectedCharge: 35_250 },
  ];

  for (const c of cases) {
    it(`books ${c.name} to confirmed on the shared engines`, async () => {
      const payments = createMockPaymentProvider();
      const engine = createBookingEngine({
        services: [c.service],
        rules: [1, 2, 3, 4, 5].map((weekday) => rule({ weekday, startMinute: 540, endMinute: 1020, capacity: 2 })),
        overrides: [],
        policy: policy(),
        tenantTimezone: "America/Chicago",
        payments,
        now: () => "2026-01-04T00:00:00.000Z",
      });
      const record = await engine.createBooking({
        tenantId: TENANT,
        idempotencyKey: `key-${c.service.id}-0001`,
        selection: c.selection,
        slotStart: "2026-01-05T16:00:00.000Z",
        customer: { name: "Casey Customer", email: "casey@example.com" },
      });
      expect(record.state).toBe("pending_payment");
      const intent = payments.listIntents()[0]!;
      expect(intent.amount.amount).toBe(c.expectedCharge);
      payments.completePayment(intent.intentId, "succeeded");
      expect(engine.confirmFromPayment(intent.intentId).state).toBe("confirmed");
    });
  }
});
