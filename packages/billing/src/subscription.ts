import { z } from "zod";
import { TenantId } from "@lumin/contracts";

/**
 * PlatformBilling — Subscription state model (provider-neutral)
 *
 * A `Subscription` is Lumin's OWN record of a tenant's platform subscription.
 * It is deliberately expressed only in terms Lumin controls — plan key,
 * lifecycle status, period window, add-on keys — and carries NO provider
 * object, id, or raw event. Provider adapters (future: Stripe, Paddle,
 * Mercado Pago, Mollie, PayPal) map their world ONTO this record; nothing in
 * the platform maps back out.
 *
 * Status is a server-authoritative STATE MACHINE, in the same spirit as
 * BOOKING_TRANSITIONS: legal transitions are declared once here and enforced
 * by `transition()`, so provider webhooks can never drive a subscription into
 * an illegal state.
 */

export const SubscriptionStatus = z.enum([
  "incomplete", // created, first payment/confirmation not yet done
  "trialing", // inside a free trial
  "active", // paid and current
  "past_due", // a renewal failed; entitlement is on borrowed time
  "canceled", // terminated (period ended, or immediate)
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

/**
 * Legal status transitions. Read as: from KEY you may move to any state in its
 * list. `canceled` is terminal. Mirrors the shape of BOOKING_TRANSITIONS so the
 * whole platform reasons about lifecycles the same way.
 *
 *   incomplete → trialing | active | canceled
 *   trialing   → active | past_due | canceled
 *   active     → past_due | canceled
 *   past_due   → active | canceled          (recovered renewal, or give up)
 *   canceled   → (terminal)
 */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  incomplete: ["trialing", "active", "canceled"],
  trialing: ["active", "past_due", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled"],
  canceled: [],
};

/** Is `to` a legal next status from `from`? */
export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/** Thrown when a caller attempts an illegal status transition. */
export class SubscriptionError extends Error {
  constructor(
    public readonly code: "ILLEGAL_TRANSITION" | "INVALID_ADDON" | "INVALID_PLAN_CHANGE",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "SubscriptionError";
  }
}

export const Subscription = z.object({
  id: z.string().min(1),
  tenantId: TenantId,
  planKey: z.string().min(1),
  status: SubscriptionStatus,
  /** ISO-8601. Start of the current paid/trial period. */
  currentPeriodStart: z.string().datetime(),
  /** ISO-8601. End of the current period; renewal is attempted at/after this. */
  currentPeriodEnd: z.string().datetime(),
  /** ISO-8601. When the trial ends, if the subscription is/was trialing. */
  trialEnd: z.string().datetime().optional(),
  /**
   * If true, the subscription will terminate at `currentPeriodEnd` instead of
   * renewing. Entitlement persists until then (see ./entitlement). Distinct
   * from an IMMEDIATE cancel, which moves status straight to `canceled`.
   */
  cancelAtPeriodEnd: z.boolean(),
  /** Active add-on keys (subset of the plan's permitted addonKeys). */
  addonKeys: z.array(z.string().min(1)).readonly(),
});
export type Subscription = z.infer<typeof Subscription>;

/**
 * How a plan change is billed. Proration is represented as DATA — a policy the
 * caller records — not computed here beyond simple integer math the caller may
 * do with Money helpers. This package never guesses a proration amount.
 */
export const ProrationPolicy = z.enum(["none", "prorate", "at_period_end"]);
export type ProrationPolicy = z.infer<typeof ProrationPolicy>;

export const PlanChange = z.object({
  toPlanKey: z.string().min(1),
  /** "upgrade" vs "downgrade" is a label the caller assigns; not enforced. */
  direction: z.enum(["upgrade", "downgrade"]),
  proration: ProrationPolicy,
  /**
   * Optional pre-computed proration amount in minor units (positive = charge,
   * negative = credit). Supplied by the caller; this package does not derive
   * it. Present only for record-keeping / handoff to a provider adapter.
   */
  prorationMinorUnits: z.number().int().optional(),
});
export type PlanChange = z.infer<typeof PlanChange>;

/**
 * Apply a status transition. Returns a NEW subscription (records are treated as
 * immutable). Throws SubscriptionError("ILLEGAL_TRANSITION") for any move not
 * in SUBSCRIPTION_TRANSITIONS. A self-transition (from === to) is rejected as
 * illegal, matching the declared tables (no status lists itself).
 */
export function transition(sub: Subscription, to: SubscriptionStatus): Subscription {
  if (!canTransition(sub.status, to)) {
    throw new SubscriptionError("ILLEGAL_TRANSITION", `cannot transition ${sub.status} → ${to}`);
  }
  return { ...sub, status: to };
}

/**
 * Change the plan on a subscription. Records the new `planKey` and prunes any
 * active add-ons that the caller says are no longer permitted (see
 * `allowedAddonKeys`). Status is unchanged — a plan change does not itself move
 * the lifecycle. Proration is carried as data on the returned PlanChange, never
 * computed here.
 *
 * Returns both the updated subscription and the PlanChange record so a provider
 * adapter can act on the intent (charge/credit) separately.
 */
export function changePlan(
  sub: Subscription,
  change: PlanChange,
  allowedAddonKeys: readonly string[],
): { subscription: Subscription; change: PlanChange } {
  const parsed = PlanChange.parse(change);
  if (sub.status === "canceled") {
    throw new SubscriptionError("INVALID_PLAN_CHANGE", "cannot change plan on a canceled subscription");
  }
  const allowed = new Set(allowedAddonKeys);
  const keptAddons = sub.addonKeys.filter((k) => allowed.has(k));
  return {
    subscription: { ...sub, planKey: parsed.toPlanKey, addonKeys: keptAddons },
    change: parsed,
  };
}

/**
 * Schedule cancellation at period end. Entitlement continues until
 * `currentPeriodEnd`; status is untouched. Reversible via `reactivate`.
 */
export function cancelAtPeriodEnd(sub: Subscription): Subscription {
  if (sub.status === "canceled") {
    throw new SubscriptionError("ILLEGAL_TRANSITION", "already canceled");
  }
  return { ...sub, cancelAtPeriodEnd: true };
}

/**
 * Cancel immediately: status → canceled (must be a legal transition) and the
 * period is closed now (`currentPeriodEnd` clamped to `asOf`). Entitlement ends
 * at once.
 */
export function cancelImmediately(sub: Subscription, asOf: string): Subscription {
  const canceled = transition(sub, "canceled");
  return { ...canceled, cancelAtPeriodEnd: true, currentPeriodEnd: asOf };
}

/**
 * Undo a scheduled cancellation (clears `cancelAtPeriodEnd`). Only meaningful
 * while the subscription is still in a non-terminal status; a canceled
 * subscription cannot be reactivated this way (start a new one instead).
 */
export function clearScheduledCancel(sub: Subscription): Subscription {
  if (sub.status === "canceled") {
    throw new SubscriptionError("ILLEGAL_TRANSITION", "cannot un-cancel a canceled subscription");
  }
  return { ...sub, cancelAtPeriodEnd: false };
}
