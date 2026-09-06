import { describe, expect, it } from "vitest";
import { Selection, Service } from "@lumin/contracts";
import { createPricingEngine } from "@lumin/core";
import { answersFromSelection } from "../src/engine";
import { applyToSelection, computePricingEffects } from "../src/pricingEffects";
import { WorkflowConfig } from "../src/types";

const SERVICE_ID = "00000000-0000-4000-8000-0000000000aa";

/**
 * A configurable service. The workflow will map two flow outcomes onto pricing
 * inputs this service already prices:
 *   - accept the eco addon (priced by addon.price)
 *   - inject the "stairs" access choice (priced by choice.priceDelta)
 * plus the customer's own home_size='large' choice (a 1.5x multiplier).
 */
const service: Service = {
  id: SERVICE_ID,
  tenantId: "00000000-0000-4000-8000-000000000001",
  archetype: "configurable",
  name: "House cleaning",
  description: "",
  currency: "USD",
  basePrice: 10_000,
  durationMinutes: 60,
  items: [],
  addons: [{ id: "eco", name: "Eco products", price: 2_500 }],
  questions: [
    {
      id: "home_size",
      prompt: "Home size",
      kind: "single_choice",
      required: true,
      choices: [
        { id: "small", label: "Small", priceDelta: 0, priceMultiplierBp: 10_000 },
        { id: "large", label: "Large", priceDelta: 0, priceMultiplierBp: 15_000 }, // ×1.5
      ],
    },
    {
      id: "eco_optin",
      prompt: "Add eco cleaning?",
      kind: "single_choice",
      required: false,
      choices: [
        { id: "yes", label: "Yes", priceDelta: 0, priceMultiplierBp: 10_000 },
        { id: "no", label: "No", priceDelta: 0, priceMultiplierBp: 10_000 },
      ],
    },
    {
      id: "access",
      prompt: "Access",
      kind: "single_choice",
      required: false,
      choices: [
        { id: "stairs", label: "Stairs", priceDelta: 2_000, priceMultiplierBp: 10_000 },
        { id: "ground", label: "Ground floor", priceDelta: 0, priceMultiplierBp: 10_000 },
      ],
    },
  ],
  taxRateBp: 1_000, // 10%
  active: true,
};

const config: WorkflowConfig = {
  key: "cleaning-flow",
  steps: [
    { key: "size", questionKey: "home_size", required: true },
    {
      key: "eco",
      questionKey: "eco_optin",
      // accepting eco → add the eco ADDON to the selection
      pricingEffect: { target: "addon", when: { field: "eco_optin", op: "eq", value: "yes" }, addonId: "eco" },
      recommend: { when: { field: "home_size", op: "eq", value: "large" }, text: "Add eco cleaning", addonKey: "eco" },
    },
    {
      key: "stairs",
      kind: "info",
      // large homes imply a stairs surcharge → inject the 'stairs' CHOICE
      pricingEffect: {
        target: "choice",
        when: { field: "home_size", op: "eq", value: "large" },
        questionKey: "access",
        choiceIds: ["stairs"],
      },
    },
  ],
};

// The customer's raw selection: large home, opted into eco. Note it carries
// NEITHER the eco addon NOR the stairs choice — the workflow adds those.
const base: Selection = {
  serviceId: SERVICE_ID,
  itemQuantities: {},
  addonIds: [],
  answers: {
    home_size: { choiceIds: ["large"] },
    eco_optin: { choiceIds: ["yes"] },
  },
};

describe("pricingEffects: flow outcomes map to pricing inputs", () => {
  const answers = answersFromSelection(base);
  const effects = computePricingEffects(config, answers);

  it("computes the correct addon + choice patch (no money, only inputs)", () => {
    expect(effects.addonIds).toEqual(["eco"]);
    expect(effects.answers).toEqual({ access: { choiceIds: ["stairs"] } });
    expect(effects.itemQuantities).toEqual({});
    expect(effects.effects).toEqual([
      { stepKey: "eco", target: "addon", addonId: "eco" },
      { stepKey: "stairs", target: "choice", questionKey: "access", choiceIds: ["stairs"] },
    ]);
  });

  it("merges into the selection without mutating the base", () => {
    const merged = applyToSelection(base, effects);
    expect(merged.addonIds).toEqual(["eco"]);
    expect(merged.answers).toEqual({
      home_size: { choiceIds: ["large"] },
      eco_optin: { choiceIds: ["yes"] },
      access: { choiceIds: ["stairs"] },
    });
    // base untouched
    expect(base.addonIds).toEqual([]);
    expect(base.answers.access).toBeUndefined();
  });

  it("the REAL core PricingEngine prices the shaped selection to the hand-computed total", () => {
    const engine = createPricingEngine();
    const merged = applyToSelection(base, effects);
    const bd = engine.price(service, merged);

    // Hand computation (authoritative pricing lives in core):
    //   additive: base 10000 + eco addon 2500 + stairs delta 2000 = 14500
    //   ×1.5 (home_size=large, 15000bp): round(14500 * 1.5) = 21750
    //   tax 10%: round(21750 * 0.10) = 2175
    //   total: 21750 + 2175 = 23925
    expect(bd.subtotal).toEqual({ amount: 21_750, currency: "USD" });
    expect(bd.tax).toEqual({ amount: 2_175, currency: "USD" });
    expect(bd.total).toEqual({ amount: 23_925, currency: "USD" });
    expect(bd.deposit.amount).toBe(0);

    // Σ(amount × quantity) over lines equals the subtotal (multiplier materialized as a line).
    expect(bd.lines.reduce((s, l) => s + l.amount.amount * l.quantity, 0)).toBe(bd.subtotal.amount);
  });

  it("without the eco opt-in, the flow adds no addon and the price drops accordingly", () => {
    const noEco: Selection = { ...base, answers: { home_size: { choiceIds: ["large"] } } };
    const patch = computePricingEffects(config, answersFromSelection(noEco));
    expect(patch.addonIds).toEqual([]); // eco effect did not fire
    const bd = createPricingEngine().price(service, applyToSelection(noEco, patch));
    // additive: base 10000 + stairs 2000 = 12000; ×1.5 = 18000; +10% = 1800; total 19800
    expect(bd.subtotal.amount).toBe(18_000);
    expect(bd.total.amount).toBe(19_800);
  });
});
