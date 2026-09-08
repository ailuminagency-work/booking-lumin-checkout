import { describe, expect, it } from "vitest";
import { money } from "@lumin/contracts";
import { createDisplayFormatters } from "./i18n";

/**
 * i18n wiring: the SAME integer minor-unit amount renders differently per
 * locale/currency, and dates render in the given timezone. Money math never
 * changes — only presentation.
 */
describe("checkout i18n display formatters", () => {
  it("formats money per locale + currency over integer minor units", () => {
    const en = createDisplayFormatters("en-US", "America/Chicago");
    const de = createDisplayFormatters("de-DE", "Europe/Berlin");

    // 151550 minor units — one integer, two locales, two currencies.
    expect(en.money(money(151550, "USD"))).toBe("$1,515.50");

    const deStr = de.money(money(151550, "EUR"));
    expect(deStr).toContain("1.515,50"); // comma decimal, dot grouping
    expect(deStr).toContain("€");
  });

  it("renders a start time and day label in the tenant timezone", () => {
    const en = createDisplayFormatters("en-US", "America/Chicago");
    // 14:00Z on 2026-09-10 is 09:00 CDT (UTC-5).
    expect(en.time("2026-09-10T14:00:00.000Z")).toBe("9:00 AM");
    expect(en.dayLabel("2026-09-10T14:00:00.000Z")).toContain("Sep 10");
  });
});
