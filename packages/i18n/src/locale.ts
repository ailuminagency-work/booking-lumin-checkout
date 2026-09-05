/**
 * Locale primitives.
 *
 * A `Locale` is a BCP-47 language tag (e.g. "en-US", "es-MX", "nl-NL",
 * "pt-BR", "ja-JP"). The platform treats locale as an INDEPENDENT input:
 * it is never inferred from currency, timezone, country, or vice versa.
 * Formatting money in USD for a Dutch-speaking customer is entirely valid.
 */

/** BCP-47 language tag. Kept as a plain string alias so callers may pass any tag. */
export type Locale = string;

/** Text directionality for a locale's script. */
export type TextDirection = "ltr" | "rtl";

export interface LocaleInfo {
  /** The canonical BCP-47 tag. */
  tag: Locale;
  /** Default writing direction for the locale's primary script. */
  direction: TextDirection;
  /** Human-readable, English display name. */
  displayName: string;
}

/**
 * Registry of locales the platform explicitly supports. This is intentionally
 * small and additive — it exists to give callers a known-good set plus a
 * direction and display name. Unlisted-but-valid BCP-47 tags are still usable
 * anywhere a `Locale` is accepted; they simply are not "supported" here.
 */
export const SUPPORTED_LOCALES: Readonly<Record<string, LocaleInfo>> = Object.freeze({
  "en-US": { tag: "en-US", direction: "ltr", displayName: "English (United States)" },
  "en-GB": { tag: "en-GB", direction: "ltr", displayName: "English (United Kingdom)" },
  "es-MX": { tag: "es-MX", direction: "ltr", displayName: "Spanish (Mexico)" },
  "es-ES": { tag: "es-ES", direction: "ltr", displayName: "Spanish (Spain)" },
  "nl-NL": { tag: "nl-NL", direction: "ltr", displayName: "Dutch (Netherlands)" },
  "pt-BR": { tag: "pt-BR", direction: "ltr", displayName: "Portuguese (Brazil)" },
  "de-DE": { tag: "de-DE", direction: "ltr", displayName: "German (Germany)" },
  "fr-FR": { tag: "fr-FR", direction: "ltr", displayName: "French (France)" },
  "ja-JP": { tag: "ja-JP", direction: "ltr", displayName: "Japanese (Japan)" },
  "ar-EG": { tag: "ar-EG", direction: "rtl", displayName: "Arabic (Egypt)" },
  "he-IL": { tag: "he-IL", direction: "rtl", displayName: "Hebrew (Israel)" },
});

/** The platform's fallback locale when nothing else resolves. */
export const DEFAULT_LOCALE: Locale = "en-US";

/** Case-insensitive lookup index (e.g. "EN-us" -> "en-US"). */
const CANONICAL_INDEX: ReadonlyMap<string, string> = new Map(
  Object.keys(SUPPORTED_LOCALES).map((tag) => [tag.toLowerCase(), tag]),
);

/** True when `input` names a locale in the supported registry (case-insensitive). */
export function isSupportedLocale(input: unknown): input is Locale {
  return typeof input === "string" && CANONICAL_INDEX.has(input.toLowerCase());
}

/** Look up registry info for a supported locale, or `undefined` if unlisted. */
export function localeInfo(input: string): LocaleInfo | undefined {
  const canonical = CANONICAL_INDEX.get(input.toLowerCase());
  return canonical ? SUPPORTED_LOCALES[canonical] : undefined;
}

/** Default text direction for a locale (ltr for anything not explicitly rtl). */
export function localeDirection(input: string): TextDirection {
  return localeInfo(input)?.direction ?? "ltr";
}

/**
 * Resolve an arbitrary input to a supported locale.
 *
 * Resolution order:
 *  1. exact/case-insensitive match against the registry;
 *  2. language-only match (e.g. "es" or "es-419" -> first "es-*" listed);
 *  3. the provided `fallback` if it is itself supported;
 *  4. DEFAULT_LOCALE.
 */
export function resolveLocale(input: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (typeof input === "string" && input.length > 0) {
    const exact = CANONICAL_INDEX.get(input.toLowerCase());
    if (exact) return exact;

    const lang = input.toLowerCase().split("-")[0];
    if (lang) {
      for (const tag of Object.keys(SUPPORTED_LOCALES)) {
        if (tag.toLowerCase().split("-")[0] === lang) return tag;
      }
    }
  }
  if (isSupportedLocale(fallback)) return CANONICAL_INDEX.get(fallback.toLowerCase())!;
  return DEFAULT_LOCALE;
}
