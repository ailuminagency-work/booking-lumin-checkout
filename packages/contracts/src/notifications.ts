import { z } from "zod";
import { EVENT_NAMES } from "./events";
import { Money } from "./money";
import { BookingState } from "./booking";
import { TenantId } from "./tenant";

/**
 * NotificationContract v1
 *
 * Contracts for a PROVIDER-NEUTRAL, event-driven notification/messaging engine
 * (@lumin/notifications). Booking lifecycle events (EventContract v1) drive
 * outbound customer messages; per-tenant config decides WHICH events notify on
 * WHICH channels, WHAT the sender identity is, and WHICH reminders fire before
 * a slot. Templates are locale-resolved and reference booking/tenant variables.
 *
 * These shapes are ADDITIVE — they compose with, and never modify,
 * IntegrationAdapterContract v1 (NotificationInput / NotificationProvider) or
 * EventContract v1 (EVENT_NAMES / EventName). A RenderedNotification maps 1:1
 * to a NotificationInput the injected NotificationProvider can send.
 *
 * Money is ALWAYS integer minor units + explicit currency (MoneyContract v1);
 * it is formatted for DISPLAY only inside a rendered body, never parsed back.
 */

/** Delivery channel — mirrors NotificationInput.channel (email | sms). */
export const NotificationChannel = z.enum(["email", "sms"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

/** Event names as a zod enum, so config/templates can be validated. */
export const EventNameSchema = z.enum(EVENT_NAMES);

/**
 * What a template renders for. Either a booking-lifecycle EventName or the
 * special "reminder" trigger (reminders are keyed by a ReminderRule, not by an
 * EventName, since there is no reminder event in EVENT_NAMES).
 */
export const TEMPLATE_TRIGGERS = [...EVENT_NAMES, "reminder"] as const;
export const TemplateTrigger = z.enum(
  TEMPLATE_TRIGGERS as unknown as [string, ...string[]],
);
export type TemplateTrigger = (typeof TEMPLATE_TRIGGERS)[number];

/**
 * The fixed provider template ids a NotificationInput carries. Mirrors
 * NotificationInput.template (IntegrationAdapterContract v1) additively — the
 * engine maps every trigger to one of these when emitting a NotificationInput.
 */
export const ProviderTemplateId = z.enum([
  "booking_confirmed",
  "booking_cancelled",
  "booking_reminder",
  "refund_issued",
]);
export type ProviderTemplateId = z.infer<typeof ProviderTemplateId>;

/**
 * A per-tenant message template, resolved by (trigger, channel, locale).
 * `subject` is EMAIL-ONLY (SMS has no subject). `body` is a template string
 * with `{{variable}}` placeholders referencing booking/tenant variables.
 */
export const NotificationTemplate = z
  .object({
    trigger: TemplateTrigger,
    channel: NotificationChannel,
    /** BCP-47 locale this template is written in (e.g. "en-US", "es-MX"). */
    locale: z.string().min(2),
    /** Email subject template. Forbidden for SMS. */
    subject: z.string().optional(),
    /** Body template with `{{variable}}` placeholders. */
    body: z.string().min(1),
  })
  .refine((t) => t.channel === "email" || t.subject === undefined, {
    message: "sms templates must not have a subject",
    path: ["subject"],
  });
export type NotificationTemplate = z.infer<typeof NotificationTemplate>;

/**
 * A reminder rule: schedule a reminder `offsetMinutes` before slotStart for
 * CONFIRMED bookings. `id` is stable per rule and participates in the dedupe
 * key so re-planning never double-schedules the same reminder.
 */
export const ReminderRule = z.object({
  id: z.string().min(1),
  /** Minutes before slotStart the reminder fires (e.g. 1440 = 24h, 60 = 1h). */
  offsetMinutes: z.number().int().positive(),
  /** Channels this reminder is delivered on. */
  channels: z.array(NotificationChannel).min(1),
});
export type ReminderRule = z.infer<typeof ReminderRule>;

/** Which channels an event notifies on (empty = event notifies on nothing). */
export const EventChannelPolicy = z.object({
  event: EventNameSchema,
  channels: z.array(NotificationChannel),
});
export type EventChannelPolicy = z.infer<typeof EventChannelPolicy>;

/** Sender identity for a tenant's outbound messages. */
export const SenderIdentity = z.object({
  emailFrom: z.string().email().optional(),
  emailFromName: z.string().optional(),
  smsFrom: z.string().optional(),
});
export type SenderIdentity = z.infer<typeof SenderIdentity>;

/**
 * A tenant's notification configuration: default locale/timezone, sender
 * identity, per-event channel policy, reminder rules, and the template library.
 */
export const NotificationConfig = z.object({
  tenantId: TenantId,
  /** Fallback locale when a booking carries none. */
  locale: z.string().min(2),
  /** IANA timezone used to render slot times (e.g. "America/Chicago"). */
  timezone: z.string().min(1),
  sender: SenderIdentity,
  events: z.array(EventChannelPolicy),
  reminders: z.array(ReminderRule),
  templates: z.array(NotificationTemplate),
});
export type NotificationConfig = z.infer<typeof NotificationConfig>;

/**
 * A projection of a booking with just what messaging needs. Pure data — the
 * engine only ever READS this; a notification never mutates booking state
 * (mirrors Security Invariant R2: notifications can't reverse a booking).
 */
export const NotificationBooking = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  state: BookingState,
  slotStart: z.string().datetime(),
  slotEnd: z.string().datetime(),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  /** Optional per-customer locale override (falls back to config.locale). */
  locale: z.string().min(2).optional(),
  /** Order total, for templates that show an amount. */
  total: Money.optional(),
});
export type NotificationBooking = z.infer<typeof NotificationBooking>;

/** Everything the engine needs to render a message for one booking. */
export const NotificationContext = z.object({
  tenant: z.object({ id: TenantId, name: z.string().min(1) }),
  booking: NotificationBooking,
});
export type NotificationContext = z.infer<typeof NotificationContext>;

/**
 * An intent to notify, before rendering — a stable, dedupe-keyed descriptor of
 * one (booking, trigger, channel[, reminder]) message.
 */
export const NotificationRequest = z.object({
  dedupeKey: z.string().min(1),
  tenantId: TenantId,
  bookingId: z.string().min(1),
  trigger: TemplateTrigger,
  channel: NotificationChannel,
  /** Set only for reminder requests (the ReminderRule id). */
  reminderId: z.string().optional(),
  /** Recipient address (email address or phone number). */
  to: z.string().min(1),
});
export type NotificationRequest = z.infer<typeof NotificationRequest>;

/**
 * A fully rendered notification. Maps 1:1 to a NotificationInput the injected
 * NotificationProvider sends (see toNotificationInput in @lumin/notifications).
 * `subject`/`body` are already locale-formatted for DISPLAY.
 */
export const RenderedNotification = NotificationRequest.extend({
  providerTemplate: ProviderTemplateId,
  /** Rendered subject (email only; undefined for SMS). */
  subject: z.string().optional(),
  /** Rendered body. */
  body: z.string().min(1),
  /** The resolved variable map used to render (already display-formatted). */
  variables: z.record(z.string()),
  /** Locale the message was rendered in. */
  locale: z.string().min(2),
});
export type RenderedNotification = z.infer<typeof RenderedNotification>;

/** Outcome of a send batch. */
export interface NotificationSendResult {
  sent: (RenderedNotification & { messageId: string })[];
  /** Already-sent (deduped) — not re-delivered. */
  skipped: RenderedNotification[];
  /** Per-item provider failures — captured, never thrown. */
  failed: { notification: RenderedNotification; error: string }[];
}
