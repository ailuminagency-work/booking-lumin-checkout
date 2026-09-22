import { describe, expect, it } from "vitest";
import {
  buildVariables,
  interpolate,
  providerTemplateFor,
  resolveContextLocale,
  resolveTemplate,
} from "../src/index";
import { baseConfig, bookingContext } from "./fixtures";

describe("interpolate", () => {
  it("replaces known placeholders and tolerates surrounding whitespace", () => {
    expect(interpolate("Hi {{ name }}!", { name: "Sam" })).toBe("Hi Sam!");
  });

  it("leaves unknown placeholders intact (no silent blanks)", () => {
    expect(interpolate("{{a}}-{{b}}", { a: "x" })).toBe("x-{{b}}");
  });
});

describe("resolveTemplate", () => {
  it("returns undefined when no template is registered for the pair", () => {
    expect(resolveTemplate(baseConfig(), "booking.cancelled", "sms", "en-US")).toBeUndefined();
  });

  it("prefers an exact locale match", () => {
    const t = resolveTemplate(baseConfig(), "booking.confirmed", "email", "es-MX");
    expect(t!.locale).toBe("es-MX");
  });
});

describe("providerTemplateFor", () => {
  it("maps triggers to the fixed provider template ids", () => {
    expect(providerTemplateFor("booking.confirmed")).toBe("booking_confirmed");
    expect(providerTemplateFor("booking.cancelled")).toBe("booking_cancelled");
    expect(providerTemplateFor("booking.refunded")).toBe("refund_issued");
    expect(providerTemplateFor("reminder")).toBe("booking_reminder");
  });
});

describe("resolveContextLocale + buildVariables", () => {
  it("uses the booking locale override when present", () => {
    expect(resolveContextLocale(bookingContext({ locale: "es-MX" }), baseConfig())).toBe("es-MX");
  });

  it("builds display-formatted variables including a currency-aware total", () => {
    const vars = buildVariables(bookingContext(), baseConfig(), "en-US");
    expect(vars.bookingReference).toBe("LMN-3F8K2Q");
    expect(vars.total).toContain("125");
    expect(vars.slotStart).toBeTruthy();
  });

  it("omits total when the booking has none", () => {
    const vars = buildVariables(bookingContext({ total: undefined }), baseConfig(), "en-US");
    expect(vars.total).toBeUndefined();
  });
});
