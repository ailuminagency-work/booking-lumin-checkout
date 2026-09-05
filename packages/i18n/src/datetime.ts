/**
 * Date/time primitives.
 *
 * The platform stores every instant as a UTC ISO-8601 string and carries an
 * explicit IANA timezone (see the Tenant contract's `timezone`). Display always
 * happens in a GIVEN timezone — we NEVER assume the host machine's timezone,
 * and we NEVER do calendar/DST math by hand. All of that is delegated to
 * `Intl.DateTimeFormat`, which is timezone- and DST-correct via the ICU data
 * built into the runtime.
 *
 * `timeZone` is a REQUIRED argument on every function here. Locale is an
 * independent input controlling only presentation (month names, ordering,
 * numerals); it is never inferred from the timezone.
 */
import { type Locale, resolveLocale } from "./locale";

/** Parse a UTC ISO string to a Date, rejecting anything Intl can't place. */
function toDate(utcIso: string): Date {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid UTC ISO instant: ${JSON.stringify(utcIso)}`);
  }
  return d;
}

/**
 * Format a UTC instant for display in a specific timezone and locale.
 *
 * @param utcIso   UTC ISO-8601 instant (e.g. "2025-03-09T07:30:00Z").
 * @param timeZone REQUIRED IANA timezone (e.g. "America/Chicago").
 * @param locale   BCP-47 locale for presentation.
 * @param opts     Optional Intl.DateTimeFormat overrides. `timeZone` is always
 *                 forced to the argument and cannot be overridden here.
 */
export function formatDateTime(
  utcIso: string,
  timeZone: string,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const base: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    ...base,
    ...opts,
    timeZone,
  }).format(toDate(utcIso));
}

/** Date-only rendering of a UTC instant in the given timezone/locale. */
export function formatDateOnly(
  utcIso: string,
  timeZone: string,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts,
    timeZone,
  }).format(toDate(utcIso));
}

/** Time-only rendering of a UTC instant in the given timezone/locale. */
export function formatTimeOnly(
  utcIso: string,
  timeZone: string,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
    timeZone,
  }).format(toDate(utcIso));
}

/** Wall-clock components of a UTC instant, evaluated in a given timezone. */
export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}

/**
 * Decompose a UTC instant into its wall-clock parts in `timeZone`. Uses Intl
 * with a fixed, locale-independent formatter (en-US, 24-hour) purely to read
 * the numeric fields — this is not display, so the locale is irrelevant and the
 * numbers are the same regardless of the caller's locale. DST is handled by
 * Intl: the same UTC instant yields the correct local hour on either side of a
 * transition.
 */
export function zonedParts(utcIso: string, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(toDate(utcIso));
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`zonedParts: missing ${type} for ${timeZone}`);
    return Number(value);
  };
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}
