import { describe, expect, it } from "vitest";
import { money } from "@lumin/contracts";
import { getTenant } from "./api";
import { createStore, demoContext, otherContext } from "./mockTenant";
import { fmtMoney, localeForTenant } from "./i18n";

/** i18n wiring: money renders per the tenant's locale over integer minor units. */
describe("portal i18n", () => {
  const store = createStore();
  const demo = getTenant(demoContext, store);
  const other = getTenant(otherContext, store);

  it("surfaces a per-tenant display locale", () => {
    expect(localeForTenant(demo)).toBe("en-US");
    expect(localeForTenant(other)).toBe("nl-NL");
  });

  it("formats the same integer amount per tenant currency + locale", () => {
    expect(fmtMoney(demo, money(150000, "USD"))).toBe("$1,500.00");
    const nl = fmtMoney(other, money(150000, "EUR"));
    expect(nl).toContain("1.500,00");
    expect(nl).toContain("€");
  });
});
