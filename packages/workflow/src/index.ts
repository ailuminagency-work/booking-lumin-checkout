/**
 * @lumin/workflow — one DATA-DRIVEN flow engine for every service template.
 *
 * A template ships a serializable `WorkflowConfig` (conditions are a small
 * boolean DSL — no code, no eval) and this engine turns a service's questions
 * into a dynamic flow: conditional steps, required follow-ups, disqualification,
 * warnings, recommendations, and pricing effects. It never modifies the shared
 * Service/Selection contracts, and it never computes an authoritative total —
 * pricing stays server-authoritative in `@lumin/core`'s PricingEngine. This
 * package only shapes the `Selection` that engine prices.
 */

export * from "./types";
export { evaluate } from "./conditions";
export { createWorkflowEngine, answersFromSelection } from "./engine";
export type { WorkflowEngine } from "./engine";
export {
  computePricingEffects,
  applyToSelection,
} from "./pricingEffects";
export type {
  AppliedEffect,
  SelectionPatch,
  FlowPricingEffects,
} from "./pricingEffects";
