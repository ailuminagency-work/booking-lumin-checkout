/**
 * @lumin/events — provider-neutral, mock-first, PURE OUTBOUND domain-event /
 * webhook dispatch engine.
 *
 * A tenant subscribes its own endpoint to booking/payment events; this engine
 * matches events to subscriptions (with strict tenant isolation), builds a
 * signed, idempotent delivery, and dispatches it through a `WebhookProvider`
 * with exponential-backoff retry and a dead-letter terminal state.
 *
 * It is CLOCK-FREE (every `now` is injected) and holds NO secrets: the signing
 * secret is passed in by the trusted caller at dispatch time; subscriptions
 * carry only a `signingSecretRef`.
 *
 * Boundary: this package imports ONLY @lumin/contracts (and node:crypto).
 */

export { hmacSha256Hex, constantTimeEqual } from "./crypto";
export {
  DEFAULT_SKEW_SECONDS,
  SIGNATURE_HEADER,
  buildSignatureHeader,
  parseSignatureHeader,
  verifySignature,
  type VerifyOptions,
} from "./signature";
export { matchSubscriptions, subscriptionMatches, type MatchableEvent } from "./match";
export {
  IDEMPOTENCY_HEADER,
  EVENT_HEADER,
  deliveryIdempotencyKey,
  serializeEnvelope,
  buildDelivery,
} from "./delivery";
export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_RETRY_MS,
  DEFAULT_BACKOFF_FACTOR,
  nextRetryDelayMs,
  computeNextRetryAtMs,
  dispatch,
  dispatchUntilSettled,
  type RetryPolicy,
  type DispatchInput,
  type DispatchUntilSettledOptions,
} from "./dispatch";
