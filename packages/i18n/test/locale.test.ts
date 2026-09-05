import { describe, expect, it } from "vitest";
import {
  isSupportedLocale,
  resolveLocale,
  localeDirection,
  localeInfo,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "../src/locale";

describe("isSupportedLocale", () => {
  it("recognizes registered locales (case-insensitive)", () => {
    expect(isSupportedLocale("en-US")).toBe(true);
    expect(isSupportedLocale("EN-us")).toBe(true);
    expect(isSupportedLocale("ja-JP")).toBe(true);
    expect(isSupportedLocale("zz-ZZ")).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});

describe("resolveLocale", () => {
  it("returns the canonical tag for an exact/case-insensitive match", () => {
    expect(resolveLocale("nl-NL")).toBe("nl-NL");
    expect(resolveLocale("PT-br")).toBe("pt-BR");
  });

  it("falls back by language when the exact tag is unlisted", () => {
    // "es-419" (Latin American Spanish) → first listed "es-*".
    expect(resolveLocale("es-419")).toBe("es-MX");
    expect(resolveLocale("en")).toBe("en-US");
  });

  it("uses the provided fallback, then DEFAULT_LOCALE", () => {
    expect(resolveLocale("xx-XX", "ja-JP")).toBe("ja-JP");
    expect(resolveLocale("xx-XX", "also-bad")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });
});

describe("locale metadata", () => {
  it("exposes direction and display name", () => {
    expect(localeDirection("en-US")).toBe("ltr");
    expect(localeDirection("ar-EG")).toBe("rtl");
    expect(localeDirection("he-IL")).toBe("rtl");
    // Unlisted locale defaults to ltr.
    expect(localeDirection("zz-ZZ")).toBe("ltr");
    expect(localeInfo("nl-NL")?.displayName).toBe("Dutch (Netherlands)");
  });

  it("registry is frozen", () => {
    expect(Object.isFrozen(SUPPORTED_LOCALES)).toBe(true);
  });
});
