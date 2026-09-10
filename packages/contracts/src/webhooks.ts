import { z } from "zod";
import { TenantId } from "./tenant";
import { EVENT_NAMES } from "./events";
import { WebhookDeliveryInput } from "./integrations";

/**
 * WebhookContract v1 — tenant-facing OUTBOUND webhooks.
 *
 * A tenant subscribes its OWN endpoint to booking/payment domain events; the
 * platform signs and delivers a canonical envelope to that endpoint. This is
 * the outbound counterpart to the (already-existing) inbound Stripe webhook —
 * it is a distinct concern and does not touch payment intent verification.
 *
 * Two invariants are load-bearing here and enforced in @lumin/events:
 *  - TENANT ISOLATION: a subscription only ever receives its own tenant's
 *    events. `tenantId` scopes both the subscription and the envelope.
 *  - SECRET BOUNDARY (R6): a subscription stores only a REFERENCE to its
 *    signing secret (`signingSecretRef`) — never the secret value. The value
 *    is held in the secret store and passed to the engine by a trusted caller
 *    at delivery time; it never appears in this client-readable contract.
 *
 * Event names are NOT redefined here — the canonical `EVENT_NAMES` /
 * `EventName` from EventContract are reused (this schema is built from them).
 */

/** Zod validator over the canonical, reused `EVENT_NAMES` (never redefined). */
export const EventNameSchema = z.enum(EVENT_NAMES);

/** Wildcard token in a subscription filter — matches every event name. */
export const WEBHOOK_EVENT_WILDCARD = "*" as const;
export type WebhookEventWildcard = typeof WEBHOOK_EVENT_WILDCARD;

/**
 * A subscription's event filter: either the wildcard (all events) or an
 * explicit, non-empty list of canonical event names.
 */
export const WebhookEventFilter = z.union([
  z.literal(WEBHOOK_EVENT_WILDCARD),
  z.array(EventNameSchema).min(1),
]);
export type WebhookEventFilter = z.infer<typeof WebhookEventFilter>;

/** A tenant's registered outbound endpoint + which events it wants. */
export const WebhookSubscription = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  /** Destination endpoint (tenant-owned). */
  url: z.string().url(),
  /** Wildcard or an explicit list of event names to deliver. */
  eventFilter: WebhookEventFilter,
  /** Inactive subscriptions never match and never receive deliveries. */
  active: z.boolean(),
  /**
   * REFERENCE (id/handle) to the signing secret in the secret store — NEVER
   * the secret value. The value is resolved by a trusted server caller and
   * passed to the engine separately (R6 secret boundary).
   */
  signingSecretRef: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WebhookSubscription = z.infer<typeof WebhookSubscription>;

/**
 * WebhookEventEnvelope — the canonical outbound payload delivered to a tenant.
 *
 * Mirrors `AuditEvent`'s discipline: `data` is PII-minimized and MUST NOT
 * contain secrets or raw personal data (SI-11). Same tenant scoping as the
 * subscription.
 */
export const WebhookEventEnvelope = z.object({
  id: z.string().uuid(),
  /** Canonical event name (reused from EventContract). */
  name: EventNameSchema,
  tenantId: TenantId,
  /** UTC ISO timestamp of when the domain event occurred. */
  occurredAt: z.string().datetime(),
  /** Redacted, PII-minimized payload — never secrets or raw PII (SI-11). */
  data: z.record(z.unknown()),
});
export type WebhookEventEnvelope = z.infer<typeof WebhookEventEnvelope>;

/**
 * A signed, ready-to-send delivery. Extends the transport-level
 * `WebhookDeliveryInput` (so it can be handed straight to a `WebhookProvider`)
 * with the signing metadata a receiver needs to verify authenticity + replay.
 */
export interface SignedWebhookDelivery extends WebhookDeliveryInput {
  /** Owning subscription. */
  subscriptionId: string;
  /** Destination endpoint copied from the subscription. */
  url: string;
  /** Stable per (subscriptionId, envelopeId) — a retry reuses the same key. */
  idempotencyKey: string;
  /** Signature timestamp, unix SECONDS (bound into the signed string). */
  timestamp: number;
  /** The exact serialized body the signature covers. */
  body: string;
  /** `t=<ts>,v1=<hex hmac_sha256(secret,"<ts>.<body>")>` (Stripe-style scheme). */
  signature: string;
  /** Ready-to-send HTTP headers, including the signature + idempotency key. */
  headers: Record<string, string>;
}

/** Lifecycle status of a delivery to one subscription for one envelope. */
export const DeliveryStatus = z.enum(["pending", "delivered", "failed", "dead_letter"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

/** A single delivery attempt against the provider. */
export const DeliveryAttempt = z.object({
  /** 1-based attempt number. */
  attempt: z.number().int().positive(),
  status: z.enum(["delivered", "failed"]),
  /** UTC ISO time the attempt was made. */
  at: z.string().datetime(),
  /** Provider-assigned delivery id, when the provider returned one. */
  deliveryId: z.string().nullable(),
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttempt>;

/**
 * DeliveryOutcome — the accumulated record for one (subscription, envelope):
 * every attempt, the current status, the next-retry time (null when settled),
 * and whether it has been moved to the dead-letter state.
 */
export const DeliveryOutcome = z.object({
  subscriptionId: z.string().uuid(),
  envelopeId: z.string().uuid(),
  /** Stable idempotency key for this (subscription, envelope). */
  idempotencyKey: z.string(),
  status: DeliveryStatus,
  attempts: z.array(DeliveryAttempt),
  /** When to retry next (UTC ISO); null once delivered or dead-lettered. */
  nextRetryAt: z.string().datetime().nullable(),
  /** True once max attempts were exhausted without a successful delivery. */
  deadLettered: z.boolean(),
});
export type DeliveryOutcome = z.infer<typeof DeliveryOutcome>;
