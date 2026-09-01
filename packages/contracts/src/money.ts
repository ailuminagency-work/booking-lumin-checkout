import { z } from "zod";

/**
 * MoneyContract v1
 *
 * All monetary values are integer minor units (cents, pence, centavos).
 * Floating point money is forbidden everywhere in the platform.
 * Currency is always explicit — there is no platform-global default currency.
 */

export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "ISO 4217 uppercase currency code");
export type CurrencyCode = z.infer<typeof CurrencyCode>;

export const MinorUnits = z.number().int().safe();
export type MinorUnits = z.infer<typeof MinorUnits>;

export const Money = z.object({
  amount: MinorUnits,
  currency: CurrencyCode,
});
export type Money = z.infer<typeof Money>;

export function money(amount: MinorUnits, currency: CurrencyCode): Money {
  return { amount, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} + ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Format for display. Uses Intl; never used for arithmetic. */
export function formatMoney(m: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
  }).format(m.amount / minorUnitFactor(m.currency));
}

/** Minor-unit factor per ISO 4217 (zero-decimal currencies handled). */
export function minorUnitFactor(currency: CurrencyCode): number {
  const zeroDecimal = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF"]);
  return zeroDecimal.has(currency) ? 1 : 100;
}
