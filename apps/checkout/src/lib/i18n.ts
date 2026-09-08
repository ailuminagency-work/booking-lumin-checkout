/**
 * Checkout display formatting — the single seam onto @lumin/i18n.
 *
 * Money stays integer minor units + explicit currency END TO END; ONLY display
 * routes through here. Locale, timezone and currency are independent inputs:
 * locale + timezone come from the tenant config, currency travels on each
 * `Money` value. Swapping the tenant's locale/timezone reskins every amount and
 * date in the checkout without touching a single component.
 */
import {
  formatMoneyLocalized,
  formatDateOnly,
  formatTimeOnly,
  formatDateTime,
  type Locale,
} from "@lumin/i18n";
import type { Money } from "@lumin/contracts";
import { locale as tenantLocale, tenant } from "../config/demoTenant";

export interface DisplayFormatters {
  /** Localized currency string over integer minor units (never used for math). */
  money(m: Money): string;
  /** e.g. "Mon, Sep 8" — a compact day label in the tenant timezone. */
  dayLabel(utcIso: string): string;
  /** e.g. "2:00 PM" — a start time in the tenant timezone. */
  time(utcIso: string): string;
  /** A full, human date-time with timezone name in the tenant timezone. */
  dateTime(utcIso: string): string;
}

/** Build formatters bound to a locale + timezone (pure; exported for tests). */
export function createDisplayFormatters(locale: Locale, timeZone: string): DisplayFormatters {
  return {
    money: (m) => formatMoneyLocalized(m, locale),
    dayLabel: (utcIso) =>
      formatDateOnly(utcIso, timeZone, locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: undefined,
      }),
    time: (utcIso) => formatTimeOnly(utcIso, timeZone, locale, { hour: "numeric" }),
    dateTime: (utcIso) =>
      formatDateTime(utcIso, timeZone, locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
  };
}

/** Formatters bound to the running tenant's locale + timezone. */
export const display = createDisplayFormatters(tenantLocale, tenant.timezone);
