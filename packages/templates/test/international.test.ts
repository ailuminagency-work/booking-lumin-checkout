import { describe, expect, it } from "vitest";
import { createPricingEngine } from "@lumin/core";
import { getTemplate } from "../src/registry";
import { DEMO_TENANT, uuid } from "./fixtures";

const pricing = createPricingEngine();

/**
 * The template layer holds no US-only assumptions. The SAME template, built for
 * three different (currency, timezone) tuples, prices to the SAME integer
 * minor-unit total and stamps each currency through untouched.
 */
const locales: { currency: string; timezone: string }[] = [
  { currency: "USD", timezone: "America/Chicago" },
  { currency: "EUR", timezone: "Europe/Amsterdam" },
  { currency: "MXN", timezone: "America/Mexico_City" },
];

describe("one template, many currencies/timezones", () => {
  for (const loc of locales) {
    it(`car-detailing prices identically in ${loc.currency} (${loc.timezone})`, () => {
      const service = getTemplate("car-detailing").build({
        tenantId: DEMO_TENANT,
        currency: loc.currency,
        timezone: loc.timezone,
        serviceId: uuid(200),
      });
      const bd = pricing.price(service, {
        serviceId: service.id,
        itemQuantities: {},
        addonIds: ["pet-hair"],
        answers: { package: { choiceIds: ["deluxe"] }, vehicle: { choiceIds: ["suv"] } },
      });
      // (15000 + 3000) × 1.25 = 22500; tax round(22500×825/10000)=1856
      expect(bd.subtotal.amount).toBe(22_500);
      expect(bd.total.amount).toBe(24_356);
      // Currency is whatever the tenant configured — never coerced to USD.
      expect(bd.total.currency).toBe(loc.currency);
      expect(bd.subtotal.currency).toBe(loc.currency);
    });
  }

  it("every template accepts any currency without changing its integer math", () => {
    for (const loc of locales) {
      const service = getTemplate("junk-removal").build({
        tenantId: DEMO_TENANT,
        currency: loc.currency,
        timezone: loc.timezone,
        serviceId: uuid(201),
      });
      const bd = pricing.price(service, {
        serviceId: service.id,
        itemQuantities: { sofa: 2, fridge: 1 },
        addonIds: ["zone-north"],
        answers: {},
      });
      expect(bd.subtotal.amount).toBe(26_000);
      expect(bd.total.amount).toBe(28_145);
      expect(bd.total.currency).toBe(loc.currency);
    }
  });
});
