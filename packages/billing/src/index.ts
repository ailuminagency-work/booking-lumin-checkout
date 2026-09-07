/**
 * @lumin/billing — provider-neutral PLATFORM billing.
 *
 * How BUSINESSES pay Lumin for the platform: plans, add-ons, subscriptions,
 * entitlement, and a provider-neutral billing contract with a deterministic
 * mock. Deliberately separate from @lumin/contracts PaymentProviderContract,
 * which is how a business's CUSTOMERS pay for a booking.
 *
 * Design guarantees:
 *  - Money is integer minor units + explicit ISO-4217 currency (MoneyContract).
 *  - Entitlement derives ONLY from (Subscription, Plan) — never a provider field.
 *  - Subscription status is a server-authoritative STATE MACHINE.
 *  - Mock-first: real processors (Stripe, Paddle, Mercado Pago, Mollie, PayPal)
 *    are FUTURE adapters and a LAST activation step; nothing here couples to them.
 */

export {
  BillingInterval,
  AddOn,
  Plan,
  PlanCatalog,
  makePlanCatalog,
  getPlan,
  getAddOn,
  sampleCatalog,
} from "./plans";

export {
  SubscriptionStatus,
  SUBSCRIPTION_TRANSITIONS,
  canTransition,
  SubscriptionError,
  Subscription,
  ProrationPolicy,
  PlanChange,
  transition,
  changePlan,
  cancelAtPeriodEnd,
  cancelImmediately,
  clearScheduledCancel,
} from "./subscription";

export { entitlements, hasFeature, hasAddon } from "./entitlement";
export type { Entitlements } from "./entitlement";

export {
  UsageRecord,
  Invoice,
  NormalizedBillingEvent,
  createMockBillingProvider,
} from "./provider";
export type {
  BillingProvider,
  MockBillingProvider,
  MockBillingProviderOptions,
  CreateSubscriptionInput,
} from "./provider";

export const BILLING_VERSION = "0.1.0";
