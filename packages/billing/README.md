# @lumin/billing

Provider-neutral **platform billing** — how a business pays Lumin for the
platform (subscription tiers + usage add-ons). This is **not** how a business's
customers pay for a booking; that is `@lumin/contracts` `PaymentProviderContract`.
The two are deliberately separate contracts.

## Principles

- **Provider-neutral.** Nothing here names or shapes itself around a real
  processor. Stripe, Paddle, Mercado Pago, Mollie and PayPal are **future
  adapters** and a **last activation step**. The platform's `Subscription`
  carries no provider id, object, status, or raw webhook.
- **Entitlement is decoupled from provider fields.** `entitlements(subscription,
  plan)` derives features and add-ons **only** from Lumin's own
  `Subscription` + `Plan`. It must never read a Stripe status, a Paddle `state`,
  or any vendor object. A provider adapter's job is to translate its world *into*
  our `Subscription` (status / period / add-ons) *before* entitlement runs, so
  every provider — and the mock — yields the same entitlement for the same facts.
- **Mock-first.** `createMockBillingProvider` is a deterministic, in-memory,
  credential-free reference that drives the full subscription state machine.
  Real adapters must reproduce these state moves.
- **Integer minor-unit money.** All amounts are integer minor units plus an
  explicit ISO-4217 currency, per `MoneyContract v1`. No floats, no default
  currency. Proration is represented as **data** (a policy + optional
  pre-computed amount), never guessed here.

## Subscription state machine

Server-authoritative, declared once in `SUBSCRIPTION_TRANSITIONS` and enforced
by `transition()` (same spirit as `BOOKING_TRANSITIONS`):

```
incomplete → trialing | active | canceled
trialing   → active | past_due | canceled
active     → past_due | canceled
past_due   → active | canceled
canceled   → (terminal)
```

- `cancelAtPeriodEnd(sub)` schedules termination but keeps entitlement until the
  period closes; `cancelImmediately(sub, asOf)` moves straight to `canceled`.
- `changePlan(sub, change, allowedAddonKeys)` records upgrade/downgrade and
  prunes add-ons the new plan does not permit; proration rides along as data.

## Entitlement

`entitlements(subscription, plan)` → `{ features: Set, activeAddons: Set, isActive }`.
Access statuses are `trialing`, `active`, and `past_due` (grace window);
`incomplete` and `canceled` grant nothing. Active add-ons are the intersection of
the subscription's add-on keys with the plan's permitted `addonKeys`.

## Provider contract

`BillingProvider`: `createSubscription`, `changePlan`, `cancel`, `reactivate`,
`recordUsage` (usage billing), `listInvoices`, `syncFromProviderEvent`
(NORMALIZED events only — raw webhook parsing/verification lives inside each
adapter). The mock adds inspection getters and `simulateRenewal(success)` /
`simulatePastDue()` to exercise flows.

## Usage

```ts
import {
  sampleCatalog,
  createMockBillingProvider,
  entitlements,
  getPlan,
} from "@lumin/billing";

const catalog = sampleCatalog();
const billing = createMockBillingProvider({ catalog });

const sub = await billing.createSubscription({
  tenantId: "…uuid…",
  planKey: "pro",
  startAt: "2026-01-01T00:00:00.000Z",
});
// sub.status === "trialing"

const ent = entitlements(sub, getPlan(catalog, sub.planKey));
ent.features.has("analytics"); // true
```
