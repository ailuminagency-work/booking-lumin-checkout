import type {
  NotificationChannel,
  NotificationConfig,
  NotificationContext,
  NotificationTemplate,
  ProviderTemplateId,
  TemplateTrigger,
} from "@lumin/contracts";
import {
  formatDateOnly,
  formatDateTime,
  formatMoneyLocalized,
  formatTimeOnly,
  resolveLocale,
} from "@lumin/i18n";

/**
 * Rendering: PURE, locale-aware production of the subject/body text for one
 * notification. Money is formatted for DISPLAY only (integer minor units +
 * currency via @lumin/i18n) and never parsed back; date/times are rendered in
 * the tenant timezone via Intl (DST-correct). No wall clock, no I/O.
 */

/** The locale a message renders in: booking override, else config default. */
export function resolveContextLocale(
  context: NotificationContext,
  config: NotificationConfig,
): string {
  return resolveLocale(context.booking.locale ?? config.locale, config.locale);
}

/**
 * Build the display-formatted variable map a template body/subject can
 * reference via `{{name}}`. All values are strings, already localized.
 */
export function buildVariables(
  context: NotificationContext,
  config: NotificationConfig,
  locale: string,
): Record<string, string> {
  const { tenant, booking } = context;
  const tz = config.timezone;
  const vars: Record<string, string> = {
    tenantName: tenant.name,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    bookingReference: booking.reference,
    bookingState: booking.state,
    slotStart: formatDateTime(booking.slotStart, tz, locale),
    slotEnd: formatDateTime(booking.slotEnd, tz, locale),
    slotDate: formatDateOnly(booking.slotStart, tz, locale),
    slotTime: formatTimeOnly(booking.slotStart, tz, locale),
  };
  if (booking.customerPhone) vars.customerPhone = booking.customerPhone;
  if (booking.total) vars.total = formatMoneyLocalized(booking.total, locale);
  return vars;
}

/** Replace every `{{key}}` for which a variable exists; leave unknowns intact. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : whole,
  );
}

/**
 * Resolve the best template for (trigger, channel, locale). Preference:
 *   1. exact resolved-locale match,
 *   2. same-language match (e.g. "es-ES" template for an "es-MX" booking),
 *   3. the config default locale,
 *   4. the first template registered for (trigger, channel).
 * Returns undefined when no template is registered for (trigger, channel).
 */
export function resolveTemplate(
  config: NotificationConfig,
  trigger: TemplateTrigger,
  channel: NotificationChannel,
  locale: string,
): NotificationTemplate | undefined {
  const candidates = config.templates.filter(
    (t) => t.trigger === trigger && t.channel === channel,
  );
  if (candidates.length === 0) return undefined;

  const wanted = resolveLocale(locale, config.locale).toLowerCase();
  const exact = candidates.find((t) => resolveLocale(t.locale, config.locale).toLowerCase() === wanted);
  if (exact) return exact;

  const lang = wanted.split("-")[0];
  const sameLang = candidates.find(
    (t) => resolveLocale(t.locale, config.locale).toLowerCase().split("-")[0] === lang,
  );
  if (sameLang) return sameLang;

  const defaultLocale = resolveLocale(config.locale, config.locale).toLowerCase();
  const byDefault = candidates.find(
    (t) => resolveLocale(t.locale, config.locale).toLowerCase() === defaultLocale,
  );
  return byDefault ?? candidates[0];
}

/** Map a trigger to the fixed provider template id a NotificationInput carries. */
export function providerTemplateFor(trigger: TemplateTrigger): ProviderTemplateId {
  switch (trigger) {
    case "reminder":
      return "booking_reminder";
    case "booking.cancelled":
    case "booking.failed":
      return "booking_cancelled";
    case "booking.refunded":
    case "payment.refunded":
      return "refund_issued";
    default:
      return "booking_confirmed";
  }
}
