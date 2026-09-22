/**
 * dispatch — attempt delivery, and on failure schedule an exponentially
 * backed-off retry up to a max attempt count, then move to DEAD-LETTER.
 *
 * Retry TIMING is pure: the next-retry instant is computed from the attempt
 * number and the injected `now` — the engine never sleeps. Each `dispatch`
 * call performs at most ONE provider attempt; a scheduler re-invokes it (with
 * the prior `DeliveryOutcome`) when `nextRetryAt` is due.
 *
 * IDEMPOTENCY: a `DeliveryOutcome` that is already `delivered` or
 * `dead_letter` is terminal — re-dispatching it returns it UNCHANGED and makes
 * NO provider call, so a success is never double-delivered and a dead-lettered
 * event is never retried.
 */

import {
  type DeliveryAttempt,
  type DeliveryOutcome,
  type WebhookEventEnvelope,
  type WebhookProvider,
  type WebhookSubscription,
} from "@lumin/contracts";
import { buildDelivery, deliveryIdempotencyKey } from "./delivery";

/** Default ceiling on attempts before dead-lettering. */
export const DEFAULT_MAX_ATTEMPTS = 5;
/** Default base retry delay (ms) — the delay after the first failure. */
export const DEFAULT_BASE_RETRY_MS = 1_000;
/** Default exponential growth factor between attempts. */
export const DEFAULT_BACKOFF_FACTOR = 2;

export interface RetryPolicy {
  maxAttempts?: number;
  baseRetryMs?: number;
  backoffFactor?: number;
}

/**
 * Delay (ms) before the retry that FOLLOWS a given failed attempt:
 *   delay(attempt) = baseRetryMs * backoffFactor^(attempt - 1)
 * so attempt 1 → base, attempt 2 → base*factor, attempt 3 → base*factor², …
 */
export function nextRetryDelayMs(attempt: number, policy?: RetryPolicy): number {
  const base = policy?.baseRetryMs ?? DEFAULT_BASE_RETRY_MS;
  const factor = policy?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  return base * Math.pow(factor, attempt - 1);
}

/** Absolute next-retry instant (epoch ms) after a failed `attempt` at `now`. */
export function computeNextRetryAtMs(attempt: number, now: number, policy?: RetryPolicy): number {
  return now + nextRetryDelayMs(attempt, policy);
}

export interface DispatchInput extends RetryPolicy {
  provider: WebhookProvider;
  envelope: WebhookEventEnvelope;
  subscription: WebhookSubscription;
  /** Signing secret — supplied by the trusted caller, never stored. */
  secret: string;
  /** Epoch ms of THIS dispatch tick. */
  now: number;
  /** Prior accumulated outcome, when this is a retry. */
  prior?: DeliveryOutcome | null;
}

/**
 * Perform at most one delivery attempt and return the updated outcome.
 *
 * - Terminal prior (`delivered`/`dead_letter`) → returned unchanged, no call.
 * - `delivered` → status delivered, no next retry.
 * - `failed` and attempts < max → status failed, `nextRetryAt` = backed-off.
 * - `failed` and attempts ≥ max → status dead_letter.
 */
export async function dispatch(input: DispatchInput): Promise<DeliveryOutcome> {
  const { provider, envelope, subscription, secret, now } = input;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const prior = input.prior ?? null;
  const idempotencyKey = deliveryIdempotencyKey(subscription.id, envelope.id);

  // IDEMPOTENCY: terminal outcomes are never re-delivered.
  if (prior && (prior.status === "delivered" || prior.status === "dead_letter")) {
    return prior;
  }

  const priorAttempts = prior?.attempts ?? [];
  const attemptNumber = priorAttempts.length + 1;

  const delivery = buildDelivery(envelope, subscription, secret, now);
  const result = await provider.deliver(delivery);

  const attempt: DeliveryAttempt = {
    attempt: attemptNumber,
    status: result.status,
    at: new Date(now).toISOString(),
    deliveryId: result.deliveryId ?? null,
  };
  const attempts = [...priorAttempts, attempt];

  const base = {
    subscriptionId: subscription.id,
    envelopeId: envelope.id,
    idempotencyKey,
    attempts,
  };

  if (result.status === "delivered") {
    return { ...base, status: "delivered", nextRetryAt: null, deadLettered: false };
  }

  // Failed. Dead-letter once the attempt ceiling is reached.
  if (attemptNumber >= maxAttempts) {
    return { ...base, status: "dead_letter", nextRetryAt: null, deadLettered: true };
  }

  const nextRetryAtMs = computeNextRetryAtMs(attemptNumber, now, input);
  return {
    ...base,
    status: "failed",
    nextRetryAt: new Date(nextRetryAtMs).toISOString(),
    deadLettered: false,
  };
}

export interface DispatchUntilSettledOptions {
  /** Safety cap on iterations (defaults to maxAttempts + 1). */
  maxTicks?: number;
}

/**
 * Drive `dispatch` to a settled state (`delivered` or `dead_letter`), returning
 * the outcome after EACH attempt in order. Purely advances the clock to each
 * computed `nextRetryAt` — it never sleeps. Convenience for callers/tests that
 * want the whole attempt sequence in one call.
 */
export async function dispatchUntilSettled(
  input: DispatchInput,
  options?: DispatchUntilSettledOptions,
): Promise<DeliveryOutcome[]> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxTicks = options?.maxTicks ?? maxAttempts + 1;

  const outcomes: DeliveryOutcome[] = [];
  let prior: DeliveryOutcome | null = input.prior ?? null;
  let now = input.now;

  for (let tick = 0; tick < maxTicks; tick++) {
    const outcome = await dispatch({ ...input, now, prior });
    // Terminal prior returns unchanged — nothing new happened.
    if (prior && outcome === prior) break;
    outcomes.push(outcome);
    if (outcome.status === "delivered" || outcome.status === "dead_letter") break;
    now = Date.parse(outcome.nextRetryAt as string);
    prior = outcome;
  }

  return outcomes;
}
