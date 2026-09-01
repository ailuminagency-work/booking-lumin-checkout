/**
 * EventContract v1
 *
 * Canonical event names for audit logging, outbound webhooks, and
 * observability. Names are stable API — renames are breaking changes and
 * require Architecture Governor review.
 */

export const EVENT_NAMES = [
  "booking.created",
  "booking.pending_payment",
  "booking.confirmed",
  "booking.completed",
  "booking.cancelled",
  "booking.refunded",
  "booking.failed",
  "payment.intent_created",
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "integration.connected",
  "integration.disconnected",
  "integration.delivery_failed",
  "tenant.created",
  "tenant.member_invited",
  "tenant.settings_updated",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export interface AuditEvent {
  id: string;
  tenantId: string | null; // null = platform-level event
  name: EventName;
  /** Redacted, PII-minimized payload. Sensitive values must never appear (SI-11). */
  data: Record<string, unknown>;
  at: string; // UTC ISO
}
