import { describe, expect, it } from "vitest";
import { AddOn, Plan, getAddOn, getPlan, makePlanCatalog, sampleCatalog } from "../src/index";

describe("plan catalog is valid and internally consistent", () => {
  it("sample catalog parses, has unique keys and one currency", () => {
    const catalog = sampleCatalog();
    expect(catalog.plans.length).toBe(4);
    expect(catalog.addons.length).toBe(3);

    const planKeys = catalog.plans.map((p) => p.key);
    expect(new Set(planKeys).size).toBe(planKeys.length);

    for (const p of catalog.plans) {
      expect(() => Plan.parse(p)).not.toThrow();
      expect(p.currency).toBe("USD");
      expect(Number.isInteger(p.amount)).toBe(true); // integer minor units
    }
    for (const a of catalog.addons) {
      expect(() => AddOn.parse(a)).not.toThrow();
      expect(a.currency).toBe("USD");
    }
  });

  it("every plan.addonKeys entry resolves to a defined add-on", () => {
    const catalog = sampleCatalog();
    const defined = new Set(catalog.addons.map((a) => a.key));
    for (const p of catalog.plans) {
      for (const k of p.addonKeys) expect(defined.has(k)).toBe(true);
    }
  });

  it("getPlan / getAddOn resolve known keys and throw on unknown", () => {
    const catalog = sampleCatalog();
    expect(getPlan(catalog, "pro").name).toBe("Pro");
    expect(getAddOn(catalog, "sms").amount).toBe(1500);
    expect(() => getPlan(catalog, "nope")).toThrow(/unknown plan/);
    expect(() => getAddOn(catalog, "nope")).toThrow(/unknown add-on/);
  });

  it("rejects duplicate plan keys", () => {
    expect(() =>
      makePlanCatalog({
        currency: "USD",
        plans: [
          { key: "dup", name: "A", interval: "monthly", amount: 100, currency: "USD", trialDays: 0, features: [], addonKeys: [] },
          { key: "dup", name: "B", interval: "monthly", amount: 200, currency: "USD", trialDays: 0, features: [], addonKeys: [] },
        ],
        addons: [],
      }),
    ).toThrow(/duplicate plan key/);
  });

  it("rejects a currency that disagrees with the catalog currency", () => {
    expect(() =>
      makePlanCatalog({
        currency: "USD",
        plans: [
          { key: "eur", name: "Euro", interval: "monthly", amount: 100, currency: "EUR", trialDays: 0, features: [], addonKeys: [] },
        ],
        addons: [],
      }),
    ).toThrow(/currency/);
  });

  it("rejects a plan referencing an undefined add-on", () => {
    expect(() =>
      makePlanCatalog({
        currency: "USD",
        plans: [
          { key: "p", name: "P", interval: "monthly", amount: 100, currency: "USD", trialDays: 0, features: [], addonKeys: ["ghost"] },
        ],
        addons: [],
      }),
    ).toThrow(/unknown add-on/);
  });
});
