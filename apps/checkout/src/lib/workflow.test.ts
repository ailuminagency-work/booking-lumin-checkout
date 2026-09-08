import { describe, expect, it } from "vitest";
import { createPricingEngine } from "@lumin/core";
import { createWorkflowEngine } from "@lumin/workflow";
import { carDetailingService } from "../config/demoTenant";
import { getWorkflowConfig } from "../config/workflows";
import { emptySelection } from "../state/checkout";
import { workflowView } from "./workflow";

/**
 * workflow wiring: conditional question visibility + a conditional pricing
 * effect that reaches the SAME @lumin/core PricingEngine as a Selection input.
 */
describe("checkout workflow integration (car detailing)", () => {
  const config = getWorkflowConfig(carDetailingService.id);

  it("ships a structurally valid workflow config", () => {
    expect(config).not.toBeNull();
    expect(createWorkflowEngine().validate(config!)).toEqual([]);
  });

  it("hides the vehicle question until a package is chosen", () => {
    const base = emptySelection(carDetailingService.id);
    expect(workflowView(carDetailingService, base).hiddenQuestionIds.has("vehicle")).toBe(true);

    const withPackage = { ...base, answers: { package: { choiceIds: ["showroom"] } } };
    const view = workflowView(carDetailingService, withPackage);
    expect(view.hiddenQuestionIds.has("vehicle")).toBe(false);
    // showroom package raises the time warning.
    expect(view.warnings.some((w) => /showroom/i.test(w.message))).toBe(true);
  });

  it("recommends ceramic sealant for larger vehicles", () => {
    const sel = {
      ...emptySelection(carDetailingService.id),
      answers: { package: { choiceIds: ["deluxe"] }, vehicle: { choiceIds: ["suv"] } },
    };
    const view = workflowView(carDetailingService, sel);
    expect(view.recommendations.some((r) => r.addonKey === "ceramic")).toBe(true);
  });

  it("a truck adds the engine-bay add-on as a pricing effect, raising the priced total", () => {
    const truck = {
      ...emptySelection(carDetailingService.id),
      answers: { package: { choiceIds: ["basic"] }, vehicle: { choiceIds: ["truck"] } },
    };
    const view = workflowView(carDetailingService, truck);
    expect(view.appliedEffects.some((e) => e.addonId === "engine-bay")).toBe(true);
    expect(view.effectiveSelection.addonIds).toContain("engine-bay");

    const engine = createPricingEngine();
    const withoutEffect = engine.price(carDetailingService, truck);
    const withEffect = engine.price(carDetailingService, view.effectiveSelection);
    // Money stays integer minor units; the flow only added a priced add-on.
    expect(Number.isInteger(withEffect.total.amount)).toBe(true);
    expect(withEffect.total.amount).toBeGreaterThan(withoutEffect.total.amount);
  });

  it("passes a no-flow service through unchanged (additive)", () => {
    const sel = emptySelection("00000000-0000-4000-a000-000000000000");
    // A service with no config: reuse cart-like empty selection on car detailing
    // is covered above; here we assert the no-flow branch keeps the same object.
    const fakeService = { ...carDetailingService, id: "11111111-2222-4333-a444-555555555555" };
    const view = workflowView(fakeService, sel);
    expect(view.hasFlow).toBe(false);
    expect(view.effectiveSelection).toBe(sel);
  });
});
