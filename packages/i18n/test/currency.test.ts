import { describe, expect, it } from "vitest";
import { money } from "@lumin/contracts";
import { formatMoneyLocalized, toMinorUnits, parseMinorUnits } from "../src/currency";

/**
 * The same integer minor-unit amount is presented differently per locale
 * (grouping separators, decimal marks, symbol placement) but the underlying
 * integer never changes. Locale and currency are independent inputs.
 */
describe("formatMoneyLocalized — one integer, many locales", () => {
  const amount = 199_999; // integer minor units, held constant across all locales

  it("renders 199999 USD minor units across en-US / es-MX / nl-NL with different grouping", () => {
    const usd = money(amount, "USD");
    // Same underlying integer in every case.
    expect(usd.amount).toBe(199_999);

    // en-US: comma groups, dot decimal, leading symbol.
    expect(formatMoneyLocalized(usd, "en-US")).toBe("$1,999.99");
    // es-MX: foreign USD shown with the ISO code and a NO-BREAK space (U+00A0).
    expect(formatMoneyLocalized(usd, "es-MX")).toBe("USD 1,999.99");
    // nl-NL: dot groups, comma decimal, "US$" marker + NO-BREAK space.
    expect(formatMoneyLocalized(usd, "nl-NL")).toBe("US$ 1.999,99");
  });

  it("keeps grouping/decimal marks locale-specific for EUR and MXN too", () => {
    expect(formatMoneyLocalized(money(amount, "EUR"), "nl-NL")).toBe("€ 1.999,99");
    expect(formatMoneyLocalized(money(amount, "MXN"), "es-MX")).toBe("$1,999.99");
  });

  it("renders a zero-decimal currency (JPY) with no fractional digits", () => {
    // 199999 minor units of JPY IS 199999 yen (factor 1) — no decimal part.
    expect(formatMoneyLocalized(money(199_999, "JPY"), "ja-JP")).toBe("￥199,999");
    expect(formatMoneyLocalized(money(199_999, "JPY"), "en-US")).toBe("¥199,999");
  });

  it("small amounts: same integer, locale-specific presentation", () => {
    expect(formatMoneyLocalized(money(1999, "USD"), "en-US")).toBe("$19.99");
    expect(formatMoneyLocalized(money(1999, "USD"), "nl-NL")).toBe("US$ 19,99");
    expect(formatMoneyLocalized(money(1500, "JPY"), "ja-JP")).toBe("￥1,500");
  });
});

describe("toMinorUnits — integer-safe decimal parsing", () => {
  it("converts 2-decimal currencies exactly", () => {
    expect(toMinorUnits("19.99", "USD")).toBe(1999);
    expect(toMinorUnits("0.05", "USD")).toBe(5);
    expect(toMinorUnits("1500", "USD")).toBe(150_000);
    expect(toMinorUnits("1999.00", "MXN")).toBe(199_900);
    expect(toMinorUnits("-4.50", "EUR")).toBe(-450);
    expect(toMinorUnits("1999", "BRL")).toBe(199_900);
  });

  it("converts zero-decimal currencies (JPY/KRW) with factor 1", () => {
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(toMinorUnits("250000", "KRW")).toBe(250_000);
  });

  it("REJECTS fractional cents rather than rounding", () => {
    // More fractional digits than USD supports.
    expect(() => toMinorUnits("1.005", "USD")).toThrow(/fractional digits/);
    expect(() => toMinorUnits("19.999", "EUR")).toThrow(/fractional digits/);
    // Any fractional part at all is invalid for a zero-decimal currency.
    expect(() => toMinorUnits("1500.5", "JPY")).toThrow(/fractional digits/);
    expect(() => toMinorUnits("1500.00", "JPY")).toThrow(/fractional digits/);
  });

  it("REJECTS non-numeric input", () => {
    expect(() => toMinorUnits("19,99", "USD")).toThrow(/plain decimal/);
    expect(() => toMinorUnits("$19.99", "USD")).toThrow(/plain decimal/);
    expect(() => toMinorUnits("", "USD")).toThrow(/plain decimal/);
  });
});

describe("parseMinorUnits — integer minor units to a machine decimal string", () => {
  it("renders 2-decimal currencies with a dot and two places", () => {
    expect(parseMinorUnits(1999, "USD")).toBe("19.99");
    expect(parseMinorUnits(5, "USD")).toBe("0.05");
    expect(parseMinorUnits(-450, "EUR")).toBe("-4.50");
  });

  it("renders zero-decimal currencies as a bare integer", () => {
    expect(parseMinorUnits(1500, "JPY")).toBe("1500");
    expect(parseMinorUnits(250_000, "KRW")).toBe("250000");
  });

  it("round-trips with toMinorUnits", () => {
    for (const [minor, cur] of [
      [1999, "USD"],
      [5, "USD"],
      [199_900, "MXN"],
      [1500, "JPY"],
    ] as const) {
      expect(toMinorUnits(parseMinorUnits(minor, cur), cur)).toBe(minor);
    }
  });

  it("rejects a non-integer minor-unit amount", () => {
    expect(() => parseMinorUnits(19.99, "USD")).toThrow(/integer/);
  });
});
