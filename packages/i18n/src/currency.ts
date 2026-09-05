/**
 * Currency primitives — thin, locale-aware helpers over the contracts money
 * rules. Money is ALWAYS integer minor units + an explicit ISO-4217 currency
 * (see @lumin/contracts money.ts). Locale and currency are independent inputs:
 * the same integer amount in the same currency renders differently per locale,
 * but the underlying integer never changes.
 *
 * We reuse `formatMoney` and `minorUnitFactor` from contracts rather than
 * reimplementing minor-unit logic.
 */
import { type Money, type CurrencyCode, formatMoney, minorUnitFactor } from "@lumin/contracts";
import { type Locale, resolveLocale } from "./locale";

/**
 * Format a `Money` for display in a given locale. Delegates to the contracts
 * `formatMoney` (Intl currency formatting over integer minor units). The
 * currency comes from the Money value; the locale only affects presentation
 * (grouping, decimal marks, symbol placement) — it never changes the currency
 * or the integer amount.
 */
export function formatMoneyLocalized(money: Money, locale: Locale): string {
  return formatMoney(money, resolveLocale(locale));
}

/**
 * Convert a decimal string (e.g. "19.99", "1500", "-4.50") to integer minor
 * units for the given currency, using the contracts `minorUnitFactor`.
 *
 * Integer-safe and lossless: the result MUST be a whole number of minor units.
 * A value with more fractional digits than the currency supports (e.g. "1.005"
 * USD, or any fraction for a zero-decimal currency like JPY) is REJECTED with a
 * thrown error rather than silently rounded.
 */
export function toMinorUnits(decimalString: string, currency: CurrencyCode): number {
  const raw = decimalString.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new Error(`toMinorUnits: not a plain decimal number: ${JSON.stringify(decimalString)}`);
  }
  const [, sign, intPart, fracPart = ""] = match;
  const factor = minorUnitFactor(currency);
  const decimals = factor === 1 ? 0 : Math.round(Math.log10(factor));

  if (fracPart.length > decimals) {
    throw new Error(
      `toMinorUnits: ${JSON.stringify(decimalString)} has more fractional digits than ${currency} ` +
        `supports (max ${decimals}); refusing to round`,
    );
  }

  const paddedFrac = fracPart.padEnd(decimals, "0");
  const combined = `${intPart}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  const magnitude = Number(combined);
  if (!Number.isSafeInteger(magnitude)) {
    throw new Error(`toMinorUnits: ${JSON.stringify(decimalString)} exceeds safe integer range`);
  }
  return sign ? -magnitude : magnitude;
}

/**
 * Inverse of `toMinorUnits`: render an integer minor-unit amount as a plain,
 * locale-independent decimal string with the currency's natural number of
 * decimal places (e.g. 1999 USD -> "19.99", 1500 JPY -> "1500"). This is a
 * machine string (always "." as the decimal mark, no grouping), NOT display
 * formatting — use `formatMoneyLocalized` for anything shown to a human.
 *
 * Throws if `minor` is not an integer (minor units are integers by contract).
 */
export function parseMinorUnits(minor: number, currency: CurrencyCode): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`parseMinorUnits: minor units must be an integer, got ${minor}`);
  }
  const factor = minorUnitFactor(currency);
  if (factor === 1) return String(minor);

  const decimals = Math.round(Math.log10(factor));
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const intPart = Math.trunc(abs / factor);
  const fracPart = String(abs % factor).padStart(decimals, "0");
  return `${sign}${intPart}.${fracPart}`;
}
