import { z } from "zod";

/**
 * @lumin/workflow — types
 *
 * A DATA-DRIVEN flow engine. ONE engine powers every service template: a
 * template ships a `WorkflowConfig` (pure data, fully serializable — no code,
 * no closures, no eval) and the engine turns the service's questions into a
 * dynamic flow: conditional steps, required follow-ups, disqualification,
 * warnings, recommendations, and pricing effects.
 *
 * This package defines its OWN config types. It never modifies the shared
 * `Service`/`Selection` contracts. It consumes the flattened answer view
 * (`Answers`) that `answersFromSelection` derives from a `Selection`, and it
 * MAPS flow outcomes onto pricing INPUTS the core PricingEngine already
 * understands (addon ids, item quantities, choice answers). Authoritative,
 * server-side pricing stays entirely in `@lumin/core`'s PricingEngine; this
 * package never computes a total.
 */

/* -------------------------------------------------------------------------- */
/* Answer view                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A single answer's scalar/array value, keyed by question key. This is the
 * flattened projection of `Selection.answers` that conditions evaluate over:
 *   - quantity questions      → number
 *   - single_choice questions → the chosen choice id (string)
 *   - multi_choice questions  → array of chosen choice ids (string[])
 * `answersFromSelection` produces this; a value of `undefined` means unanswered.
 */
export type AnswerValue = string | number | boolean | string[] | null | undefined;

/** Flattened answers keyed by question key. */
export type Answers = Record<string, AnswerValue>;

/* -------------------------------------------------------------------------- */
/* Condition DSL (serializable boolean expression — NO code / NO eval)        */
/* -------------------------------------------------------------------------- */

/** Comparison operators supported by the DSL. */
export const CONDITION_OPS = [
  "eq",
  "ne",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "answered",
  "includes",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** A JSON-serializable literal usable as a comparison operand. */
export const ConditionValue: z.ZodType<
  string | number | boolean | null | Array<string | number | boolean>
> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);
export type ConditionValue = z.infer<typeof ConditionValue>;

/** A single leaf comparison: `answers[field] <op> value`. */
export const Comparison = z.object({
  field: z.string().min(1),
  op: z.enum(CONDITION_OPS),
  /** Operand. Omitted for `answered`; required for the others. */
  value: ConditionValue.optional(),
});
export type Comparison = z.infer<typeof Comparison>;

/**
 * A boolean expression over answers. Combinators are plain data objects, so the
 * whole tree round-trips through JSON. There is deliberately no way to embed a
 * function or reference to code.
 */
export type Condition =
  | Comparison
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    Comparison,
    z.object({ and: z.array(Condition).min(1) }),
    z.object({ or: z.array(Condition).min(1) }),
    z.object({ not: Condition }),
  ]),
);

/* -------------------------------------------------------------------------- */
/* Pricing effects (flow outcome → pricing INPUT, never a computed total)     */
/* -------------------------------------------------------------------------- */

/**
 * A conditional mapping from a flow outcome to a pricing INPUT the core
 * PricingEngine already prices. The effect never carries a money total; it only
 * shapes the `Selection` (add an addon, set an item quantity, or select a
 * question choice). The engine then applies that config's own
 * priceDelta / priceMultiplierBp / addon price / unit price.
 */
export const WorkflowPricingEffect = z.discriminatedUnion("target", [
  /** Include an addon (priced via `service.addons[addonId].price`). */
  z.object({
    target: z.literal("addon"),
    when: Condition.optional(),
    addonId: z.string().min(1),
  }),
  /** Set an item quantity (priced via `service.items[itemId].unitPrice`). */
  z.object({
    target: z.literal("item"),
    when: Condition.optional(),
    itemId: z.string().min(1),
    quantity: z.number().int().min(1),
  }),
  /**
   * Select choice(s) on a question (priced via each choice's `priceDelta`
   * and/or `priceMultiplierBp`). This is how a "conditional surcharge" or a
   * "conditional multiplier" reaches the engine without re-implementing pricing.
   */
  z.object({
    target: z.literal("choice"),
    when: Condition.optional(),
    questionKey: z.string().min(1),
    choiceIds: z.array(z.string().min(1)).min(1),
  }),
]);
export type WorkflowPricingEffect = z.infer<typeof WorkflowPricingEffect>;

/* -------------------------------------------------------------------------- */
/* Steps + config                                                             */
/* -------------------------------------------------------------------------- */

export const StepKind = z.enum(["question", "info", "warning"]);
export type StepKind = z.infer<typeof StepKind>;

/** A messaged conditional rule (disqualify / warn). */
export const MessagedRule = z.object({
  when: Condition,
  message: z.string().min(1),
});
export type MessagedRule = z.infer<typeof MessagedRule>;

/** A recommendation rule; may point at an addon so it can also price. */
export const RecommendRule = z.object({
  when: Condition,
  text: z.string().min(1),
  /** Optional addon this recommendation offers; wired to pricing on accept. */
  addonKey: z.string().min(1).optional(),
});
export type RecommendRule = z.infer<typeof RecommendRule>;

export const WorkflowStep = z.object({
  /** Unique key identifying this step within the config. */
  key: z.string().min(1),
  /** The service question this step drives (by question id/key). Omit for info/warning steps. */
  questionKey: z.string().min(1).optional(),
  kind: StepKind.default("question"),
  title: z.string().optional(),
  /** Step is shown only when this condition holds (absent → always visible). */
  visibleWhen: Condition.optional(),
  /** Statically required (when visible). */
  required: z.boolean().default(false),
  /** Dynamically required when visible AND this condition holds. */
  requiredWhen: Condition.optional(),
  /** When visible AND this holds → disqualified (blocks completion). */
  disqualify: MessagedRule.optional(),
  /** When visible AND this holds → a non-blocking warning. */
  warn: MessagedRule.optional(),
  /** When visible AND this holds → a recommendation (optionally an addon offer). */
  recommend: RecommendRule.optional(),
  /** Conditional pricing input this step contributes. */
  pricingEffect: WorkflowPricingEffect.optional(),
});
/**
 * Authoring type: the INPUT shape, so a config literal may omit fields that
 * carry a schema default (`kind`, `required`). Use `WorkflowStep.parse(...)` to
 * obtain the fully-defaulted output shape. The engine reads these fields
 * defensively, so either shape is safe to pass.
 */
export type WorkflowStep = z.input<typeof WorkflowStep>;

/** An ordered list of steps. Order is authoritative and deterministic. */
export const WorkflowConfig = z.object({
  key: z.string().min(1),
  steps: z.array(WorkflowStep),
});
export type WorkflowConfig = z.input<typeof WorkflowConfig>;

/* -------------------------------------------------------------------------- */
/* Engine output shapes                                                        */
/* -------------------------------------------------------------------------- */

export interface Disqualification {
  stepKey: string;
  message: string;
}
export interface Warning {
  stepKey: string;
  message: string;
}
export interface Recommendation {
  stepKey: string;
  text: string;
  addonKey?: string;
}

export interface WorkflowState {
  /** Ordered keys of the steps currently shown. */
  visibleSteps: string[];
  /** Keys of visible+required steps whose answer is still missing. */
  requiredUnanswered: string[];
  /** Disqualifying outcomes currently in effect (blocks completion). */
  disqualified: Disqualification[];
  /** Non-blocking warnings currently in effect. */
  warnings: Warning[];
  /** Recommendations currently in effect. */
  recommendations: Recommendation[];
  /** True iff nothing required is unanswered and nothing disqualifies. */
  complete: boolean;
}

export interface ValidationIssue {
  code:
    | "duplicate_step_key"
    | "duplicate_question_key"
    | "unknown_field_ref"
    | "forward_hidden_required";
  message: string;
  stepKey?: string;
  field?: string;
}
