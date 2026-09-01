import { z } from "zod";
import { TenantId } from "./tenant";

/**
 * IntegrationAdapterContract v1
 *
 * Calendar, notification, and outbound-webhook services follow the same
 * adapter pattern as payments: one interface per capability, mock-first,
 * per-tenant connections that begin NOT CONNECTED.
 */

export const ConnectionStatus = z.enum(["not_connected", "connected", "error", "revoked"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const IntegrationKind = z.enum(["payment", "calendar", "notification", "webhook"]);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const IntegrationConnection = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  kind: IntegrationKind,
  provider: z.string(),
  status: ConnectionStatus,
  /** Health of the last delivery/sync attempt. */
  lastCheckAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type IntegrationConnection = z.infer<typeof IntegrationConnection>;

export interface CalendarEventInput {
  tenantId: TenantId;
  bookingId: string;
  title: string;
  start: string; // UTC ISO
  end: string; // UTC ISO
  description?: string;
  location?: string;
}

export interface CalendarProvider {
  readonly providerName: string;
  createEvent(input: CalendarEventInput): Promise<{ eventId: string }>;
  deleteEvent(tenantId: TenantId, eventId: string): Promise<void>;
}

export interface NotificationInput {
  tenantId: TenantId;
  channel: "email" | "sms";
  to: string;
  template: "booking_confirmed" | "booking_cancelled" | "booking_reminder" | "refund_issued";
  variables: Record<string, string>;
}

export interface NotificationProvider {
  readonly providerName: string;
  send(input: NotificationInput): Promise<{ messageId: string }>;
}

export interface WebhookDeliveryInput {
  tenantId: TenantId;
  event: string;
  payload: unknown;
}

export interface WebhookProvider {
  readonly providerName: string;
  deliver(input: WebhookDeliveryInput): Promise<{ deliveryId: string; status: "delivered" | "failed" }>;
}
