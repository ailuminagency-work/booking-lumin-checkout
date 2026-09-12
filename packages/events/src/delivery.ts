/**
 * delivery — build a signed, ready-to-send delivery from an envelope.
 *
 * Pure and clock-free: `now` (epoch ms) is injected and the signing `secret`
 * is passed in by the trusted caller. The engine NEVER stores the secret and
 * the subscription carries only a `signingSecretRef` (R6 secret boundary).
 */

import {
  type SignedWebhookDelivery,
  type WebhookEventEnvelope,
  type WebhookSubscription,
} from "@lumin/contracts";
import { SIGNATURE_HEADER, buildSignatureHeader } from "./signature";

/** Header carrying the idempotency key a receiver can dedupe on. */
export const IDEMPOTENCY_HEADER = "x-lumin-idempotency-key";
/** Header carrying the canonical event name. */
export const EVENT_HEADER = "x-lumin-event";

/**
 * Stable idempotency key for a (subscription, envelope) pair. Deterministic:
 * the first attempt and every retry produce the SAME key, so a receiver — and
 * the dispatch engine — can guarantee a given envelope is delivered to a given
 * subscription at most once.
 */
export function deliveryIdempotencyKey(subscriptionId: string, envelopeId: string): string {
  return `whd_${subscriptionId}:${envelopeId}`;
}

/** Canonical serialization of the envelope — the exact bytes that get signed. */
export function serializeEnvelope(envelope: WebhookEventEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Build a signed `WebhookDeliveryInput` for `envelope` → `subscription`, signed
 * with `secret` at `now` (epoch ms).
 *
 * Guards tenant isolation at build time: refuses to build a delivery whose
 * subscription tenant differs from the envelope tenant.
 */
export function buildDelivery(
  envelope: WebhookEventEnvelope,
  subscription: WebhookSubscription,
  secret: string,
  now: number,
): SignedWebhookDelivery {
  if (subscription.tenantId !== envelope.tenantId) {
    throw new Error(
      "tenant isolation violation: subscription tenant does not match envelope tenant",
    );
  }

  const body = serializeEnvelope(envelope);
  const timestamp = Math.floor(now / 1000);
  const signature = buildSignatureHeader(body, secret, timestamp);
  const idempotencyKey = deliveryIdempotencyKey(subscription.id, envelope.id);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    [SIGNATURE_HEADER]: signature,
    [IDEMPOTENCY_HEADER]: idempotencyKey,
    [EVENT_HEADER]: envelope.name,
  };

  return {
    // WebhookDeliveryInput fields (assignable to the provider contract):
    tenantId: envelope.tenantId,
    event: envelope.name,
    payload: envelope,
    // Signing metadata:
    subscriptionId: subscription.id,
    url: subscription.url,
    idempotencyKey,
    timestamp,
    body,
    signature,
    headers,
  };
}
