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
export * from "./publication";
export * from "./configurablePublication";
export * from "./fieldRegistry";
export * from "./fieldAnswers";
export * from "./textFieldDraft";
export { parseFieldDocumentV2 } from "./fieldDocumentV2";
export type { FieldV2, FieldDocumentV2 } from "./fieldDocumentV2";
export { parseFieldAnswersV2 } from "./fieldAnswersV2";
export type { FieldAnswerDocumentV2 } from "./fieldAnswersV2";
export { parseFieldDraftSaveV2, parseFieldDraftReceiptV2, parseFieldDraftReadV2 } from "./fieldDraftV2";
export type { FieldDraftSaveV2, FieldDraftReceiptV2, FieldDraftReadV2 } from "./fieldDraftV2";
