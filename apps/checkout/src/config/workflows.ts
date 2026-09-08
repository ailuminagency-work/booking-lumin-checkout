/**
 * Per-service @lumin/workflow configurations.
 *
 * A `WorkflowConfig` is pure, serializable DATA (a small boolean DSL — no code,
 * no eval). It turns a service's flat question list into a dynamic flow:
 * conditional visibility, warnings, recommendations, and CONDITIONAL PRICING
 * EFFECTS. Crucially it never computes a total — effects only shape the
 * `Selection` the server-authoritative @lumin/core PricingEngine then prices.
 *
 * Only services that declare a config here get flow behavior; every other
 * service renders its questions exactly as before, so this is purely additive.
 */
import type { WorkflowConfig } from "@lumin/workflow";
import { carDetailingService } from "./demoTenant";

/**
 * Car detailing flow (references the template's own question/choice ids):
 *  - `vehicle` stays HIDDEN until `package` is answered (conditional step).
 *  - choosing the "showroom" package raises a time WARNING.
 *  - an SUV/truck triggers a ceramic-sealant RECOMMENDATION.
 *  - a truck adds the engine-bay add-on via a CONDITIONAL PRICING EFFECT — the
 *    surcharge reaches pricing purely as a Selection input (the add-on's own
 *    price), never as a number this flow computed.
 */
const carDetailingFlow: WorkflowConfig = {
  key: "car-detailing-flow",
  steps: [
    { key: "step-package", questionKey: "package", required: true },
    {
      key: "step-vehicle",
      questionKey: "vehicle",
      required: true,
      visibleWhen: { field: "package", op: "answered" },
    },
    {
      key: "step-showroom-time",
      kind: "warning",
      warn: {
        when: { field: "package", op: "eq", value: "showroom" },
        message: "A showroom full detail takes 3+ hours — please allow extra time at your slot.",
      },
    },
    {
      key: "step-ceramic-reco",
      kind: "info",
      recommend: {
        when: { field: "vehicle", op: "in", value: ["suv", "truck"] },
        text: "Larger vehicles hold their finish longer with a ceramic sealant.",
        addonKey: "ceramic",
      },
    },
    {
      key: "step-truck-engine-bay",
      pricingEffect: {
        target: "addon",
        when: { field: "vehicle", op: "eq", value: "truck" },
        addonId: "engine-bay",
      },
    },
  ],
};

const WORKFLOW_CONFIGS: Readonly<Record<string, WorkflowConfig>> = Object.freeze({
  [carDetailingService.id]: carDetailingFlow,
});

/** The workflow config for a service, or null when it has no flow. */
export function getWorkflowConfig(serviceId: string | undefined | null): WorkflowConfig | null {
  if (!serviceId) return null;
  return WORKFLOW_CONFIGS[serviceId] ?? null;
}
