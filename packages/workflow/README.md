# @lumin/workflow

One **data-driven** flow engine that powers every service template. A template
ships a serializable `WorkflowConfig` (plain JSON data — **no code, no
closures, no `eval`**) and this single engine turns a service's questions into a
dynamic flow:

- **conditional steps** — `visibleWhen`
- **required follow-ups** — `required` / `requiredWhen`
- **disqualification** — `disqualify` (+ message), blocks completion
- **warnings** — `warn` (+ message), non-blocking
- **recommendations** — `recommend` (+ text, optional `addonKey`)
- **pricing effects** — `pricingEffect`, mapping flow outcomes to pricing inputs

All functions are **pure, deterministic, and I/O-free**.

## Condition DSL

Conditions are a small, fully serializable boolean expression tree over the
answers gathered so far. There is deliberately no way to embed a function.

```ts
type Comparison = { field: string; op: Op; value?: JsonLiteral };
type Condition  = Comparison | { and: Condition[] } | { or: Condition[] } | { not: Condition };
```

Operators (`Op`): `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte`, `answered`,
`includes`.

- `answered` — field present and non-empty (value ignored).
- `eq` / `ne` — deep equality (arrays compared element-wise).
- `in` — field is one of `value` (an array).
- `includes` — array field contains `value` (or string field contains substring).
- `gt` / `gte` / `lt` / `lte` — numeric; non-numbers compare `false`.

**Missing field** never throws: `answered` → `false`, and every comparison over
a missing field → `false` (so `ne` on a missing field is `false`, not `true`).
**Unknown operators are rejected** (`evaluate` throws) so malformed configs fail
loud.

`evaluate(condition, answers)` — `answers` is the flattened view produced by
`answersFromSelection(selection)`:

- quantity question → `number`
- single-choice question → the choice id (`string`)
- multi-choice question → the choice id array (`string[]`)

## Engine API

```ts
const engine = createWorkflowEngine();
const state  = engine.nextState(config, answers); // WorkflowState
const issues = engine.validate(config);           // ValidationIssue[]
```

`nextState` returns:

```ts
{
  visibleSteps: string[];        // ordered keys currently shown
  requiredUnanswered: string[];  // visible+required steps still missing an answer
  disqualified: { stepKey, message }[];
  warnings: { stepKey, message }[];
  recommendations: { stepKey, text, addonKey? }[];
  complete: boolean;             // nothing required unanswered AND nothing disqualifies
}
```

A **hidden** step is ignored entirely: its (possibly stale) answer never counts
toward `requiredUnanswered` or `disqualified`. Ordering follows config order, so
the result is deterministic.

`validate` catches: duplicate step keys, duplicate question keys, unknown field
references (a condition field no step answers), and **forward-hidden required
steps** (a required step whose `visibleWhen` depends on an answer only produced
at/after its own position — it could never be shown).

## Pricing effects — mapping, not pricing

**Authoritative pricing stays server-side in `@lumin/core`'s `PricingEngine`.**
This package never computes a total. `computePricingEffects(config, answers)`
translates flow outcomes into the parts of a `Selection` the pricing engine
already understands, then `applyToSelection(base, patch)` merges them:

- addon acceptance → `Selection.addonIds` (priced by `addon.price`)
- item injection → `Selection.itemQuantities` (priced by `item.unitPrice`)
- choice selection → `Selection.answers` (priced by the choice's `priceDelta`
  and/or `priceMultiplierBp`)

```ts
const patch = computePricingEffects(config, answers);
const priced = pricingEngine.price(service, applyToSelection(baseSelection, patch));
```

The workflow only *shapes* the selection; the PricingEngine's result is the only
figure that may be charged. Because every effect resolves to real service
config (`addonId` / `itemId` / `questionKey`+`choiceIds`), the two stay
compatible by construction — the workflow can never invent a price the core
engine wouldn't compute.
