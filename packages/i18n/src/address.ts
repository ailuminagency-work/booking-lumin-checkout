/**
 * Address primitives.
 *
 * Postal address layout is country-specific. This module turns a contracts
 * `Address` (line1/line2/city/region/postalCode/country, most fields optional)
 * into an ORDERED array of display lines following the destination country's
 * common convention. There is NO US-only assumption: `region` and `postalCode`
 * are optional and omitted gracefully when absent, and the ordering rule is
 * chosen from the `country` field (ISO 3166-1 alpha-2), never hard-coded to US.
 *
 * The country name shown on the final line is derived with Intl.DisplayNames
 * from the address's country code and an optional locale (independent input) —
 * it is not inferred from anything else.
 */
import { type Address } from "@lumin/contracts";
import { type Locale, resolveLocale } from "./locale";

/** An address-formatting strategy: contracts Address -> ordered lines. */
export type AddressFormat = (address: Address, countryName: string) => string[];

/** Drop empty/whitespace-only fragments and join the survivors with a separator. */
function joinParts(parts: (string | undefined)[], sep = " "): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(sep);
}

/** Push a line only when it has content. */
function pushLine(lines: string[], line: string): void {
  if (line.trim().length > 0) lines.push(line.trim());
}

/** US / CA style: recipient lines, then "City, REGION postal", then country. */
const formatUS: AddressFormat = (a, countryName) => {
  const lines: string[] = [];
  pushLine(lines, a.line1);
  pushLine(lines, a.line2 ?? "");
  // "City, Region Postal" — comma only when a city is present; region/postal optional.
  const cityRegion = joinParts([a.region, a.postalCode]);
  pushLine(lines, joinParts([a.city ? `${a.city},` : "", cityRegion]).replace(/,\s*$/, ""));
  pushLine(lines, countryName);
  return lines;
};

/** NL / much of Europe: recipient lines, then "postal City", then country. */
const formatNL: AddressFormat = (a, countryName) => {
  const lines: string[] = [];
  pushLine(lines, a.line1);
  pushLine(lines, a.line2 ?? "");
  pushLine(lines, joinParts([a.postalCode, a.city]));
  pushLine(lines, countryName);
  return lines;
};

/** JP (romanized, large-to-small as commonly rendered for latin output):
 *  postal, then "Region City", then street lines, then country. */
const formatJP: AddressFormat = (a, countryName) => {
  const lines: string[] = [];
  if (a.postalCode) pushLine(lines, `〒${a.postalCode}`);
  pushLine(lines, joinParts([a.region, a.city]));
  pushLine(lines, a.line1);
  pushLine(lines, a.line2 ?? "");
  pushLine(lines, countryName);
  return lines;
};

/** Sensible default (recipient lines, "postal City Region", country). */
const formatDefault: AddressFormat = (a, countryName) => {
  const lines: string[] = [];
  pushLine(lines, a.line1);
  pushLine(lines, a.line2 ?? "");
  pushLine(lines, joinParts([a.postalCode, a.city, a.region]));
  pushLine(lines, countryName);
  return lines;
};

/** Country (ISO 3166-1 alpha-2, uppercased) -> layout strategy. */
const FORMATS: Readonly<Record<string, AddressFormat>> = Object.freeze({
  US: formatUS,
  CA: formatUS,
  NL: formatNL,
  DE: formatNL,
  FR: formatNL,
  ES: formatNL,
  GB: formatNL,
  JP: formatJP,
});

/** Pick the layout strategy for a country code, falling back to the default. */
export function addressFormatFor(country: string): AddressFormat {
  return FORMATS[country.toUpperCase()] ?? formatDefault;
}

/** Human-readable country name from an ISO 3166-1 alpha-2 code, in `locale`. */
export function countryDisplayName(country: string, locale: Locale = "en-US"): string {
  const code = country.toUpperCase();
  try {
    const dn = new Intl.DisplayNames([resolveLocale(locale)], { type: "region" });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Produce the ordered display lines for an address, using its `country` to pick
 * the layout and `locale` (independent input) only to render the country name.
 * Empty optional fields are omitted; the number of lines varies with the data.
 */
export function formatAddressLines(address: Address, locale: Locale = "en-US"): string[] {
  const format = addressFormatFor(address.country);
  const countryName = countryDisplayName(address.country, locale);
  return format(address, countryName);
}

/** Convenience: the same lines joined with "\n" for single-string display. */
export function formatAddressBlock(address: Address, locale: Locale = "en-US"): string {
  return formatAddressLines(address, locale).join("\n");
}
