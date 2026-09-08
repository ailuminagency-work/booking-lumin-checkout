/**
 * Date/time BUCKETING helper.
 *
 * This is not display — it produces a locale-independent, stable day key used to
 * group slots by calendar day in the tenant timezone. All human-facing date/time
 * rendering goes through `../lib/i18n` (backed by @lumin/i18n). Keeping the key
 * locale-independent (en-CA → YYYY-MM-DD) means grouping never shifts when the
 * display locale changes.
 */

export function dateKeyInTz(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
