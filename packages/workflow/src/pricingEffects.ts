import { Selection } from "@lumin/contracts";
import { evaluate } from "./conditions";
import { Answers, WorkflowConfig, WorkflowPricingEffect } from "./types";

/**
 * Flow → pricing INPUT mapping.
 *
 * IMPORTANT: this module does NOT price anything. Authoritative, server-side
 * pricing lives entirely in `@lumin/core`'s `createPricingEngine`. Here we only
 * translate the flow's outcomes (an accepted add-on recommendation, a
 * conditional surcharge, a conditional multiplier) into the parts of a
 * `Selection` the pricing engine already understands:
 *   - addon acceptance  → `Selection.addonIds`      (priced by `addon.price`)
 *   - item injection    → `Selection.itemQuantities`(priced by `item.unitPrice`)
 *   - choice selection  → `Selection.answers`       (priced by the choice's
 *                                                     `priceDelta` / `priceMultiplierBp`)
 *
 * The caller merges this patch into the customer's base `Selection` and hands
 * the result to the PricingEngine, whose output is the only figure that may be
 * charged.
 */

/** A single fired effect, kept for display / audit. */
export interface AppliedEffect {
  stepKey: string;
  target: WorkflowPricingEffect["target"];
  addonId?: string;
  itemId?: string;
  quantity?: number;
  questionKey?: string;
  choiceIds?: string[];
}

/** A partial `Selection` the flow contributes; merge into the base selection. */
export interface SelectionPatch {
  addonIds: string[];
  itemQuantities: Record<string, number>;
  answers: Record<string, { choiceIds: string[]; quantity?: number }>;
}

export interface FlowPricingEffects extends SelectionPatch {
  /** Ordered trace of every effect that fired (config order). */
  effects: AppliedEffect[];
}

/**
 * Compute the pricing patch a config + answers imply. Deterministic: effects
 * are collected in step order. An effect with no `when` always fires; otherwise
 * it fires only when its condition holds over `answers`.
 */
export function computePricingEffects(config: WorkflowConfig, answers: Answers): FlowPricingEffects {
  const effects: AppliedEffect[] = [];
  const addonIds: string[] = [];
  const itemQuantities: Record<string, number> = {};
  const answersPatch: Record<string, { choiceIds: string[]; quantity?: number }> = {};

  for (const step of config.steps) {
    const eff = step.pricingEffect;
    if (!eff) continue;
    if (eff.when && !evaluate(eff.when, answers)) continue;

    if (eff.target === "addon") {
      if (!addonIds.includes(eff.addonId)) addonIds.push(eff.addonId);
      effects.push({ stepKey: step.key, target: "addon", addonId: eff.addonId });
    } else if (eff.target === "item") {
      // last-writer-wins within the flow; base selection is merged separately
      itemQuantities[eff.itemId] = eff.quantity;
      effects.push({
        stepKey: step.key,
        target: "item",
        itemId: eff.itemId,
        quantity: eff.quantity,
      });
    } else {
      const existing = answersPatch[eff.questionKey]?.choiceIds ?? [];
      const merged = [...existing];
      for (const id of eff.choiceIds) if (!merged.includes(id)) merged.push(id);
      answersPatch[eff.questionKey] = { choiceIds: merged };
      effects.push({
        stepKey: step.key,
        target: "choice",
        questionKey: eff.questionKey,
        choiceIds: eff.choiceIds,
      });
    }
  }

  return { effects, addonIds, itemQuantities, answers: answersPatch };
}

/**
 * Merge a flow patch into a base `Selection`, producing a new `Selection` ready
 * for the PricingEngine. Pure: neither argument is mutated.
 *   - addonIds:       union (base first, then flow additions), de-duplicated
 *   - itemQuantities: flow entries override base entries of the same id
 *   - answers:        flow choiceIds union into the base answer for that key
 */
export function applyToSelection(base: Selection, patch: SelectionPatch): Selection {
  const addonIds = [...(base.addonIds ?? [])];
  for (const id of patch.addonIds) if (!addonIds.includes(id)) addonIds.push(id);

  const itemQuantities: Record<string, number> = {
    ...(base.itemQuantities ?? {}),
    ...patch.itemQuantities,
  };

  const answers: Selection["answers"] = {};
  for (const [k, v] of Object.entries(base.answers ?? {})) {
    answers[k] = { choiceIds: [...(v.choiceIds ?? [])], ...(v.quantity !== undefined ? { quantity: v.quantity } : {}) };
  }
  for (const [k, v] of Object.entries(patch.answers)) {
    const existing = answers[k]?.choiceIds ?? [];
    const merged = [...existing];
    for (const id of v.choiceIds) if (!merged.includes(id)) merged.push(id);
    const prevQty = answers[k]?.quantity;
    answers[k] = { choiceIds: merged, ...(prevQty !== undefined ? { quantity: prevQty } : {}) };
  }

  return {
    ...base,
    addonIds,
    itemQuantities,
    answers,
  };
}
