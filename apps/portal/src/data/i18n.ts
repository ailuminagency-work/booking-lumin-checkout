/**
 * Portal display formatting — the single seam onto @lumin/i18n.
 *
 * Locale is surfaced per tenant (independent of currency/timezone). Money stays
 * integer minor units + explicit currency; only DISPLAY is localized. Dates
 * render in the tenant's own timezone. Swapping a tenant's locale relocalizes
 * every amount and date the portal shows for that tenant.
 */
import type { Money, Tenant } from "@lumin/contracts";
import {
  formatDateOnly,
  formatDateTime as i18nFormatDateTime,
  formatMoneyLocalized,
  formatTimeOnly,
  resolveLocale,
  type Locale,
} from "@lumin/i18n";
import { DEMO_TENANT_ID, OTHER_TENANT_ID } from "./mockTenant";

/**
 * Per-tenant display locale. Kept as data (not inferred from currency/timezone)
 * so a USD tenant could still present in any locale. Unknown tenants fall back
 * to the platform default.
 */
const LOCALE_BY_TENANT: Readonly<Record<string, Locale>> = Object.freeze({
  [DEMO_TENANT_ID]: "en-US",
  [OTHER_TENANT_ID]: "nl-NL",
});

export function localeForTenant(tenant: Tenant): Locale {
  return LOCALE_BY_TENANT[tenant.id] ?? resolveLocale(undefined);
}

/** Localized currency string over integer minor units (never used for math). */
export function fmtMoney(tenant: Tenant, m: Money): string {
  return formatMoneyLocalized(m, localeForTenant(tenant));
}

/** Full localized date-time in the tenant timezone. */
export function fmtDateTime(tenant: Tenant, utcIso: string): string {
  return i18nFormatDateTime(utcIso, tenant.timezone, localeForTenant(tenant));
}

/** Compact slot range ("Tue, Sep 8, 9:00 AM–10:00 AM") in the tenant timezone. */
export function fmtSlot(tenant: Tenant, startIso: string, endIso: string): string {
  const locale = localeForTenant(tenant);
  const day = formatDateOnly(startIso, tenant.timezone, locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: undefined,
  });
  const start = formatTimeOnly(startIso, tenant.timezone, locale, { hour: "numeric" });
  const end = formatTimeOnly(endIso, tenant.timezone, locale, { hour: "numeric" });
  return `${day}, ${start}–${end}`;
}
