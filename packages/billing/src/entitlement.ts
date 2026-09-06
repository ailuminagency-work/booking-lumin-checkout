import { Plan } from "./plans";
import { Subscription } from "./subscription";

/**
 * PlatformBilling — Entitlement (provider-neutral derivation)
 *
 * =====================================================================
 *  ENTITLEMENT IS DERIVED ONLY FROM (Subscription, Plan).
 *
 *  It MUST NOT read any provider-specific field — no Stripe subscription
 *  status, no Paddle `state`, no Mercado Pago/Mollie/PayPal object, no raw
 *  webhook. Those never appear on our Subscription in the first place; this
 *  function's signature makes that guarantee structural. A provider adapter's
 *  job is to translate its world INTO our Subscription's status/period/addons
 *  BEFORE this runs — entitlement then depends on nothing but our own model.
 *
 *  Why: multiple providers, and mock-first development, must all yield the
 *  SAME entitlement for the same platform-level facts. Coupling entitlement to
 *  a provider's fields would fork behaviour per provider and leak vendor
 *  concepts into the product layer.
 * =====================================================================
 */

export interface Entitlements {
  /** Feature capability keys the tenant may use right now. */
  features: Set<string>;
  /** Add-on keys currently active. */
  activeAddons: Set<string>;
  /**
   * Whether the subscription currently grants access. True while trialing or
   * active, and — because access runs to the end of a paid period — while
   * past_due (grace) and while a period-end cancel is pending but the period
   * has not yet closed. False for incomplete and canceled.
   */
  isActive: boolean;
}

/**
 * Statuses that, on their own, grant platform access. `past_due` is included:
 * a failed renewal opens a grace window; access is cut only when the provider
 * flow ultimately transitions the subscription to `canceled`. `incomplete`
 * grants nothing until the first confirmation lands.
 */
const ACCESS_STATUSES = new Set(["trialing", "active", "past_due"]);

/**
 * Derive entitlements from the provider-neutral Subscription + its Plan.
 *
 * Features come from the PLAN. Active add-ons are the intersection of the
 * subscription's add-on keys with the plan's permitted `addonKeys` (a stale
 * add-on left over from a previous plan does not grant anything). When the
 * subscription is not active, features and add-ons are empty — access is all
 * or nothing at the platform tier.
 *
 * @param subscription our own record (never a provider object)
 * @param plan         the plan named by `subscription.planKey`
 */
export function entitlements(subscription: Subscription, plan: Plan): Entitlements {
  if (subscription.planKey !== plan.key) {
    throw new Error(`plan mismatch: subscription.planKey=${subscription.planKey} plan.key=${plan.key}`);
  }

  const isActive = ACCESS_STATUSES.has(subscription.status);
  if (!isActive) {
    return { features: new Set(), activeAddons: new Set(), isActive: false };
  }

  const permitted = new Set(plan.addonKeys);
  const activeAddons = new Set(subscription.addonKeys.filter((k) => permitted.has(k)));

  return {
    features: new Set(plan.features),
    activeAddons,
    isActive: true,
  };
}

/** Convenience predicate: does the tenant currently have `feature`? */
export function hasFeature(subscription: Subscription, plan: Plan, feature: string): boolean {
  return entitlements(subscription, plan).features.has(feature);
}

/** Convenience predicate: is `addonKey` currently active? */
export function hasAddon(subscription: Subscription, plan: Plan, addonKey: string): boolean {
  return entitlements(subscription, plan).activeAddons.has(addonKey);
}
