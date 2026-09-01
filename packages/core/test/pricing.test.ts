import { describe, expect, it } from "vitest";
import { PricingError, Selection, Service } from "@lumin/contracts";
import { createPricingEngine } from "../src/pricing";
import { makeService, uuid } from "./helpers";

const engine = createPricingEngine();

function sel(service: Service, extra: Partial<Selection> = {}): Selection {
  return { serviceId: service.id, itemQuantities: {}, addonIds: [], answers: {}, ...extra };
}

function expectInvalid(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable("expected INVALID_SELECTION");
  } catch (err) {
    expect(err).toBeInstanceOf(PricingError);
    expect((err as PricingError).code).toBe("INVALID_SELECTION");
  }
}

describe("pricing: simple archetype", () => {
  const service = makeService({
    id: uuid(10),
    archetype: "simple",
    basePrice: 10_000,
    addons: [{ id: "eco", name: "Eco products", price: 2_500 }],
    taxRateBp: 825,
  });

  it("prices base + addon + tax", () => {
    const bd = engine.price(service, sel(service, { addonIds: ["eco"] }));
    expect(bd.subtotal).toEqual({ amount: 12_500, currency: "USD" });
    expect(bd.tax).toEqual({ amount: 1_031, currency: "USD" }); // round(12500*825/10000)
    expect(bd.total).toEqual({ amount: 13_531, currency: "USD" });
    expect(bd.deposit.amount).toBe(0);
  });

  it("rejects unknown addon ids and rentalPeriods on a non-rental service", () => {
    expectInvalid(() => engine.price(service, sel(service, { addonIds: ["nope"] })));
    expectInvalid(() => engine.price(service, sel(service, { rentalPeriods: 2 })));
  });

  it("rejects a selection for a different service", () => {
    expectInvalid(() => engine.price(service, { ...sel(service), serviceId: uuid(99) }));
  });
});

describe("pricing: cart archetype", () => {
  const service = makeService({
    id: uuid(11),
    archetype: "cart",
    basePrice: 0,
    items: [
      { id: "sofa", name: "Sofa", unitPrice: 7_500, minQty: 0, maxQty: 5 },
      { id: "fridge", name: "Fridge", unitPrice: 9_000, minQty: 0, maxQty: 2 },
      { id: "labor", name: "Labor hour", unitPrice: 4_000, minQty: 1, maxQty: 8 },
    ],
  });

  it("prices unitPrice × qty and skips qty 0", () => {
    const bd = engine.price(service, sel(service, { itemQuantities: { sofa: 2, fridge: 0, labor: 1 } }));
    expect(bd.subtotal.amount).toBe(2 * 7_500 + 4_000); // 19000
    expect(bd.lines.map((l) => l.code)).toEqual(["item:sofa", "item:labor"]);
    expect(bd.lines.reduce((s, l) => s + l.amount.amount * l.quantity, 0)).toBe(bd.subtotal.amount);
  });

  it("rejects unknown item ids and quantities out of range", () => {
    expectInvalid(() => engine.price(service, sel(service, { itemQuantities: { ghost: 1, labor: 1 } })));
    expectInvalid(() => engine.price(service, sel(service, { itemQuantities: { sofa: 6, labor: 1 } })));
    // labor has minQty 1 — omitting it means qty 0, which is below minimum
    expectInvalid(() => engine.price(service, sel(service, { itemQuantities: { sofa: 1 } })));
  });
});

describe("pricing: configurable archetype", () => {
  const service = makeService({
    id: uuid(12),
    archetype: "configurable",
    basePrice: 10_000,
    questions: [
      {
        id: "package",
        prompt: "Package",
        kind: "single_choice",
        required: true,
        choices: [
          { id: "std", label: "Standard", priceDelta: 0, priceMultiplierBp: 10_000 },
          { id: "deep", label: "Deep", priceDelta: 2_000, priceMultiplierBp: 12_500 },
        ],
      },
      {
        id: "rooms",
        prompt: "Rooms",
        kind: "quantity",
        required: true,
        choices: [],
        unitPrice: 1_500,
        minQty: 1,
        maxQty: 10,
      },
    ],
  });

  it("applies additive lines first, then multipliers on the running subtotal", () => {
    const bd = engine.price(
      service,
      sel(service, { answers: { package: { choiceIds: ["deep"] }, rooms: { choiceIds: [], quantity: 2 } } }),
    );
    // additive: 10000 base + 2000 delta + 2*1500 = 15000; ×1.25 → 18750
    expect(bd.subtotal.amount).toBe(18_750);
    const mulLine = bd.lines.find((l) => l.code === "multiplier:package:deep");
    expect(mulLine?.amount.amount).toBe(3_750);
    expect(bd.lines.reduce((s, l) => s + l.amount.amount * l.quantity, 0)).toBe(bd.subtotal.amount);
  });

  it("rejects missing required answers, unknown choices, and out-of-range quantities", () => {
    expectInvalid(() => engine.price(service, sel(service)));
    expectInvalid(() =>
      engine.price(
        service,
        sel(service, { answers: { package: { choiceIds: ["gold"] }, rooms: { choiceIds: [], quantity: 2 } } }),
      ),
    );
    expectInvalid(() =>
      engine.price(
        service,
        sel(service, { answers: { package: { choiceIds: ["std"] }, rooms: { choiceIds: [], quantity: 11 } } }),
      ),
    );
    // two choices on a single_choice question
    expectInvalid(() =>
      engine.price(
        service,
        sel(service, { answers: { package: { choiceIds: ["std", "deep"] }, rooms: { choiceIds: [], quantity: 1 } } }),
      ),
    );
    // answer to a question that does not exist
    expectInvalid(() =>
      engine.price(
        service,
        sel(service, {
          answers: { package: { choiceIds: ["std"] }, rooms: { choiceIds: [], quantity: 1 }, ghost: { choiceIds: ["x"] } },
        }),
      ),
    );
  });
});

describe("pricing: rental archetype", () => {
  const service = makeService({
    id: uuid(13),
    archetype: "rental",
    basePrice: 0,
    rental: { periodMinutes: 60, pricePerPeriod: 5_000, minPeriods: 2, maxPeriods: 8, depositAmount: 10_000 },
    taxRateBp: 1_000,
  });

  it("prices per period and keeps the deposit untaxed and out of the subtotal", () => {
    const bd = engine.price(service, sel(service, { rentalPeriods: 3 }));
    expect(bd.subtotal.amount).toBe(15_000);
    expect(bd.tax.amount).toBe(1_500);
    expect(bd.total.amount).toBe(16_500); // deposit NOT included
    expect(bd.deposit).toEqual({ amount: 10_000, currency: "USD" });
  });

  it("rejects period counts outside min/max and a missing period count", () => {
    expectInvalid(() => engine.price(service, sel(service, { rentalPeriods: 1 })));
    expectInvalid(() => engine.price(service, sel(service, { rentalPeriods: 9 })));
    expectInvalid(() => engine.price(service, sel(service)));
  });
});

describe("pricing: zero-decimal currency", () => {
  it("prices JPY in whole minor units", () => {
    const service = makeService({ id: uuid(14), currency: "JPY", basePrice: 5_000, taxRateBp: 1_000 });
    const bd = engine.price(service, sel(service));
    expect(bd.total).toEqual({ amount: 5_500, currency: "JPY" });
  });
});
