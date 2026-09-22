/**
 * @lumin/notifications — a PROVIDER-NEUTRAL, mock-first, PURE notification /
 * messaging engine driven by booking lifecycle events.
 *
 * The charter, applied to messaging: booking lifecycle events (EventContract
 * v1) decide WHAT to say; a per-tenant NotificationConfig decides WHICH events
 * notify on WHICH channels, the sender identity, and the reminder rules;
 * locale-aware templates decide HOW it reads. Everything is data over one model
 * — email vs SMS, confirmation vs reminder, en-US vs es-MX are all config, not
 * code branches per vertical.
 *
 * Pure and clock-free: `now` is INJECTED, never read from a wall clock; money is
 * integer minor units + currency, formatted for DISPLAY only (never parsed
 * back); reminder fire-time math is done on the ISO instant (DST-agnostic). No
 * I/O beyond the injected NotificationProvider.
 *
 * Idempotent: a stable dedupe key per (tenant, booking, trigger, channel[,
 * reminder]) means the same message is never planned or sent twice.
 *
 * Fail-safe: a send failure is captured PER ITEM, never thrown out of a batch,
 * and NEVER mutates booking state — a notification can't reverse a booking
 * (Security Invariant R2).
 *
 * Additive & boundaried: depends ONLY on @lumin/contracts and @lumin/i18n (both
 * pure). It never imports app, framework, adapter, or I/O code; tests inject the
 * @lumin/adapters mock provider.
 */

export {
  planNotifications,
  dueReminders,
} from "./plan";

export {
  dedupeKey,
  toNotificationInput,
  sendNotifications,
} from "./idempotency";
export type { DedupeKeyParts } from "./idempotency";

export {
  resolveContextLocale,
  buildVariables,
  interpolate,
  resolveTemplate,
  providerTemplateFor,
} from "./render";

export const NOTIFICATIONS_VERSION = "0.1.0";
