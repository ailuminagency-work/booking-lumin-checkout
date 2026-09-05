/**
 * Phone primitives — country-aware, dependency-free.
 *
 * LIMITATION (read this): these helpers are deliberately lightweight and do NOT
 * replace a full validation library like libphonenumber. They normalize
 * formatting and attach a country calling code so numbers can be stored in a
 * consistent E.164-ISH shape, and they do a coarse plausibility check
 * (character set + length band). They do NOT validate that a number is real,
 * that its length is correct for its specific number plan, or that the national
 * portion is well-formed. Treat `isPlausiblePhone` as a cheap sanity gate, not
 * as verification.
 *
 * The country is an explicit input (`defaultCountry`) — it is never inferred
 * from locale, currency, or timezone.
 */

/** ISO 3166-1 alpha-2 country code -> E.164 calling code (without the "+"). */
export const CALLING_CODES: Readonly<Record<string, string>> = Object.freeze({
  US: "1",
  CA: "1",
  MX: "52",
  NL: "31",
  BR: "55",
  JP: "81",
  GB: "44",
  DE: "49",
  ES: "34",
  FR: "33",
});

/**
 * Countries whose national number carries a trunk prefix "0" that must be
 * dropped before prepending the calling code (e.g. NL/GB/DE/FR/BR). US/CA/MX do
 * not use a national trunk 0, so a leading 0 there is kept as a normal digit.
 */
const TRUNK_ZERO_COUNTRIES = new Set(["NL", "GB", "DE", "FR", "BR", "ES"]);

/** The calling code for a country, or undefined if unknown to this small map. */
export function callingCodeFor(country: string): string | undefined {
  return CALLING_CODES[country.toUpperCase()];
}

/** Keep only digits from a string. */
function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

/**
 * Normalize a phone number to an E.164-ish string ("+" + digits).
 *
 * Rules:
 *  - Formatting (spaces, dashes, parens, dots) is stripped.
 *  - A leading "+" is authoritative: the number is treated as already
 *    international, its "+" kept and the rest reduced to digits.
 *  - A leading "00" is treated as an international access prefix and converted
 *    to "+".
 *  - Otherwise the number is national: the `defaultCountry` calling code is
 *    prepended (dropping a national trunk "0" for countries that use one).
 *
 * The result is NOT guaranteed valid — see the module limitation note.
 */
export function normalizePhone(input: string, defaultCountry: string): string {
  const trimmed = input.trim();

  if (trimmed.startsWith("+")) {
    return `+${digitsOnly(trimmed)}`;
  }

  const digits = digitsOnly(trimmed);
  if (digits.length === 0) return "";

  // International access code "00…" -> "+…"
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  const country = defaultCountry.toUpperCase();
  const code = CALLING_CODES[country];
  if (!code) {
    // Unknown default country: cannot attach a calling code. Return digits as a
    // "+"-prefixed best effort so callers still get a stable, inspectable shape.
    return `+${digits}`;
  }

  let national = digits;
  if (TRUNK_ZERO_COUNTRIES.has(country) && national.startsWith("0")) {
    national = national.replace(/^0+/, "");
  }
  return `+${code}${national}`;
}

/**
 * Coarse plausibility check. True when `input` (after normalization) is a "+"
 * followed by 8–15 digits — the E.164 length band — and contains only allowed
 * characters before normalization. This is a sanity gate, NOT validation.
 */
export function isPlausiblePhone(input: string, defaultCountry: string): boolean {
  if (typeof input !== "string") return false;
  // Reject inputs with letters or other unexpected characters (allow the common
  // formatting set only).
  if (/[^\d+()\-.\s]/.test(input)) return false;

  const normalized = normalizePhone(input, defaultCountry);
  return /^\+\d{8,15}$/.test(normalized);
}
