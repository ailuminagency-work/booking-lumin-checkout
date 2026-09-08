/**
 * Checkout integration seam onto @lumin/workflow.
 *
 * Given a service + the customer's base `Selection`, this resolves the flow:
 * which questions are visible, any warnings/recommendations/disqualifications,
 * and — via the package's pricing-effect mapping — the EFFECTIVE selection the
 * PricingEngine should price and the booking should charge. The engine's money
 * math is untouched: effects only add add-ons / set quantities / select choices
 * that @lumin/core already knows how to price. A service with no config passes
 * through unchanged (base selection, nothing hidden), so this is additive.
 */
import type { Selection, Service } from "@lumin/contracts";
import {
  answersFromSelection,
  applyToSelection,
  computePricingEffects,
  createWorkflowEngine,
  type AppliedEffect,
  type Disqualification,
  type Recommendation,
  type Warning,
} from "@lumin/workflow";
import { getWorkflowConfig } from "../config/workflows";

const engine = createWorkflowEngine();

export interface WorkflowView {
  /** True when this service is driven by a workflow config. */
  hasFlow: boolean;
  /** Question ids currently hidden by the flow (their answers don't count). */
  hiddenQuestionIds: ReadonlySet<string>;
  warnings: Warning[];
  recommendations: Recommendation[];
  disqualified: Disqualification[];
  /** Effects the flow contributed to pricing (for display / audit). */
  appliedEffects: AppliedEffect[];
  /**
   * The selection to PRICE and CHARGE: base selection + flow pricing effects.
   * Identical to the input for a service with no flow.
   */
  effectiveSelection: Selection;
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set();

/** Resolve the flow for a service + base selection (pure). */
export function workflowView(service: Service, selection: Selection): WorkflowView {
  const config = getWorkflowConfig(service.id);
  if (!config) {
    return {
      hasFlow: false,
      hiddenQuestionIds: EMPTY_HIDDEN,
      warnings: [],
      recommendations: [],
      disqualified: [],
      appliedEffects: [],
      effectiveSelection: selection,
    };
  }

  const answers = answersFromSelection(selection);
  const state = engine.nextState(config, answers);
  const visibleSteps = new Set(state.visibleSteps);

  const hiddenQuestionIds = new Set<string>();
  for (const step of config.steps) {
    if (step.questionKey && !visibleSteps.has(step.key)) {
      hiddenQuestionIds.add(step.questionKey);
    }
  }

  const effects = computePricingEffects(config, answers);
  const effectiveSelection = applyToSelection(selection, effects);

  return {
    hasFlow: true,
    hiddenQuestionIds,
    warnings: state.warnings,
    recommendations: state.recommendations,
    disqualified: state.disqualified,
    appliedEffects: effects.effects,
    effectiveSelection,
  };
}
