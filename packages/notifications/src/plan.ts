import type {
  EventName,
  NotificationChannel,
  NotificationConfig,
  NotificationContext,
  RenderedNotification,
  TemplateTrigger,
} from "@lumin/contracts";
import { dedupeKey } from "./idempotency";
import {
  buildVariables,
  interpolate,
  providerTemplateFor,
  resolveContextLocale,
  resolveTemplate,
} from "./render";

/**
 * Planning: PURE, deterministic production of the notifications to send for a
 * booking-lifecycle event or a due reminder. `now` is INJECTED — never a wall
 * clock — so results are reproducible. Nothing here mutates booking state.
 */

/** Recipient address for a channel, or undefined when the booking lacks one. */
function recipientFor(context: NotificationContext, channel: NotificationChannel): string | undefined {
  if (channel === "email") return context.booking.customerEmail;
  return context.booking.customerPhone; // sms
}

/** Render one notification for a (trigger, channel), or undefined if it can't. */
function renderOne(
  context: NotificationContext,
  config: NotificationConfig,
  trigger: TemplateTrigger,
  channel: NotificationChannel,
  locale: string,
  vars: Record<string, string>,
  reminderId?: string,
): RenderedNotification | undefined {
  const to = recipientFor(context, channel);
  if (!to) return undefined; // e.g. SMS requested but no phone on file

  const template = resolveTemplate(config, trigger, channel, locale);
  if (!template) return undefined; // no template configured => no message

  const subject =
    channel === "email" && template.subject !== undefined
      ? interpolate(template.subject, vars)
      : undefined;

  return {
    dedupeKey: dedupeKey({
      tenantId: context.tenant.id,
      bookingId: context.booking.id,
      trigger,
      channel,
      reminderId,
    }),
    tenantId: context.tenant.id,
    bookingId: context.booking.id,
    trigger,
    channel,
    reminderId,
    to,
    providerTemplate: providerTemplateFor(trigger),
    subject,
    body: interpolate(template.body, vars),
    variables: vars,
    locale,
  };
}

/**
 * Plan the notifications to send for a booking-lifecycle event. Reads the
 * tenant's per-event channel policy, resolves a locale-aware template per
 * channel, and renders each. Channels with no recipient or no template are
 * skipped. Deterministic and side-effect-free.
 */
export function planNotifications(
  event: EventName,
  context: NotificationContext,
  config: NotificationConfig,
  _now: string,
): RenderedNotification[] {
  const policy = config.events.find((e) => e.event === event);
  if (!policy || policy.channels.length === 0) return [];

  const locale = resolveContextLocale(context, config);
  const vars = buildVariables(context, config, locale);

  const out: RenderedNotification[] = [];
  const seenChannels = new Set<NotificationChannel>();
  for (const channel of policy.channels) {
    if (seenChannels.has(channel)) continue; // dedupe channels within a policy
    seenChannels.add(channel);
    const rendered = renderOne(context, config, event, channel, locale, vars);
    if (rendered) out.push(rendered);
  }
  return out;
}

/** Epoch ms for a UTC ISO instant; NaN when unparseable. */
function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * The reminders due for a booking within [now, now+horizon].
 *
 * A reminder fires at `slotStart - offsetMinutes`. It is DUE when that instant
 * is at/after `now` and at/before `now + horizonMinutes`. Only CONFIRMED
 * bookings get reminders. Fire-time math is done on the ISO INSTANT (epoch ms),
 * so it is DST-agnostic. Pure and deterministic; returns rendered reminders.
 */
export function dueReminders(
  context: NotificationContext,
  config: NotificationConfig,
  now: string,
  horizonMinutes: number,
): RenderedNotification[] {
  if (context.booking.state !== "confirmed") return [];

  const nowMs = toMs(now);
  const slotStartMs = toMs(context.booking.slotStart);
  if (Number.isNaN(nowMs) || Number.isNaN(slotStartMs)) return [];
  const horizonEndMs = nowMs + horizonMinutes * 60_000;

  const locale = resolveContextLocale(context, config);
  const vars = buildVariables(context, config, locale);

  const out: RenderedNotification[] = [];
  for (const rule of config.reminders) {
    const fireMs = slotStartMs - rule.offsetMinutes * 60_000;
    if (fireMs < nowMs || fireMs > horizonEndMs) continue; // not due in window

    const seenChannels = new Set<NotificationChannel>();
    for (const channel of rule.channels) {
      if (seenChannels.has(channel)) continue;
      seenChannels.add(channel);
      const rendered = renderOne(context, config, "reminder", channel, locale, vars, rule.id);
      if (rendered) out.push(rendered);
    }
  }
  return out;
}
