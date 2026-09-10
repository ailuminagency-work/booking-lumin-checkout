/**
 * match — select the subscriptions that should receive an event.
 *
 * TENANT ISOLATION (security property): a subscription only ever matches an
 * event of its OWN tenant. Tenant B's subscription can never match tenant A's
 * event, regardless of its filter — this is enforced here, before any body is
 * built or signed, and is covered by dedicated tests.
 */

import {
  WEBHOOK_EVENT_WILDCARD,
  type WebhookEventEnvelope,
  type WebhookSubscription,
} from "@lumin/contracts";

/** The event fields matching depends on. */
export type MatchableEvent = Pick<WebhookEventEnvelope, "name" | "tenantId">;

/** Does one subscription match one event? Active + same tenant + filter hit. */
export function subscriptionMatches(
  subscription: WebhookSubscription,
  event: MatchableEvent,
): boolean {
  if (!subscription.active) return false;
  // TENANT ISOLATION: never cross tenant boundaries.
  if (subscription.tenantId !== event.tenantId) return false;
  if (subscription.eventFilter === WEBHOOK_EVENT_WILDCARD) return true;
  return subscription.eventFilter.includes(event.name);
}

/**
 * Return every active subscription whose tenant + filter matches the event,
 * preserving input order. Pure — no clock, no I/O.
 */
export function matchSubscriptions(
  event: MatchableEvent,
  subscriptions: readonly WebhookSubscription[],
): WebhookSubscription[] {
  return subscriptions.filter((subscription) => subscriptionMatches(subscription, event));
}
