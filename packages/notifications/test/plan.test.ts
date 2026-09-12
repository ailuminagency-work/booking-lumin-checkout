import { describe, expect, it } from "vitest";
import { planNotifications } from "../src/index";
import { NOW, baseConfig, bookingContext } from "./fixtures";

describe("planNotifications: channel selection from config", () => {
  it("booking.confirmed emits both email and sms per policy", () => {
    const out = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const channels = out.map((n) => n.channel).sort();
    expect(channels).toEqual(["email", "sms"]);
  });

  it("booking.cancelled emits email only per policy", () => {
    const out = planNotifications("booking.cancelled", bookingContext({ state: "cancelled" }), baseConfig(), NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.channel).toBe("email");
    expect(out[0]!.providerTemplate).toBe("booking_cancelled");
  });

  it("an event with an empty channel policy emits nothing", () => {
    const out = planNotifications("booking.completed", bookingContext({ state: "completed" }), baseConfig(), NOW);
    expect(out).toEqual([]);
  });

  it("an event with no policy at all emits nothing", () => {
    const out = planNotifications("booking.created", bookingContext(), baseConfig(), NOW);
    expect(out).toEqual([]);
  });

  it("skips a channel with no recipient (sms requested, no phone on file)", () => {
    const ctx = bookingContext({ customerPhone: undefined });
    const out = planNotifications("booking.confirmed", ctx, baseConfig(), NOW);
    expect(out.map((n) => n.channel)).toEqual(["email"]);
  });

  it("skips a channel with no configured template", () => {
    // Add sms to cancelled policy but provide no cancelled/sms template.
    const config = baseConfig({
      events: [{ event: "booking.cancelled", channels: ["email", "sms"] }],
    });
    const out = planNotifications("booking.cancelled", bookingContext({ state: "cancelled" }), config, NOW);
    expect(out.map((n) => n.channel)).toEqual(["email"]);
  });

  it("maps refunded to the refund_issued provider template", () => {
    const out = planNotifications("booking.refunded", bookingContext({ state: "refunded" }), baseConfig(), NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.providerTemplate).toBe("refund_issued");
  });
});

describe("planNotifications: rendering with tenant/booking vars", () => {
  it("email subject + body reference booking and tenant variables (en-US)", () => {
    const out = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const email = out.find((n) => n.channel === "email")!;
    expect(email.subject).toContain("LMN-3F8K2Q");
    expect(email.body).toContain("Dana Rivera");
    expect(email.body).toContain("Acme Detailing");
    // money is display-formatted (integer minor units -> "125" major)
    expect(email.body).toContain("125");
    // no leftover placeholders
    expect(email.body).not.toMatch(/\{\{.*\}\}/);
    expect(email.subject).not.toMatch(/\{\{.*\}\}/);
  });

  it("sms has no subject", () => {
    const out = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const sms = out.find((n) => n.channel === "sms")!;
    expect(sms.subject).toBeUndefined();
    expect(sms.body).toContain("LMN-3F8K2Q");
  });
});

describe("planNotifications: locale-aware rendering (>=2 locales/currencies)", () => {
  it("renders the es-MX template for a Spanish-locale booking", () => {
    const ctx = bookingContext({ locale: "es-MX" });
    const out = planNotifications("booking.confirmed", ctx, baseConfig(), NOW);
    const email = out.find((n) => n.channel === "email")!;
    expect(email.locale).toBe("es-MX");
    expect(email.subject).toContain("está confirmada");
    expect(email.body).toContain("Hola Dana Rivera");
  });

  it("falls back to config default locale when booking locale is unset", () => {
    const out = planNotifications("booking.confirmed", bookingContext({ locale: undefined }), baseConfig(), NOW);
    const email = out.find((n) => n.channel === "email")!;
    expect(email.locale).toBe("en-US");
    expect(email.subject).toContain("is confirmed");
  });

  it("formats a JPY total with no decimals and USD with two (currency-driven)", () => {
    const usd = planNotifications("booking.confirmed", bookingContext({ total: { amount: 12500, currency: "USD" } }), baseConfig(), NOW);
    const jpy = planNotifications("booking.confirmed", bookingContext({ total: { amount: 12500, currency: "JPY" } }), baseConfig(), NOW);
    const usdBody = usd.find((n) => n.channel === "email")!.body;
    const jpyBody = jpy.find((n) => n.channel === "email")!.body;
    // USD: 12500 minor units -> 125.00 ; JPY: 12500 minor units -> 12,500
    expect(usdBody).toContain("125.00");
    expect(jpyBody).toContain("12,500");
    expect(usdBody).not.toEqual(jpyBody);
  });

  it("does the same message in two locales differ in wording", () => {
    const en = planNotifications("booking.confirmed", bookingContext({ locale: "en-US" }), baseConfig(), NOW);
    const es = planNotifications("booking.confirmed", bookingContext({ locale: "es-MX" }), baseConfig(), NOW);
    const enEmail = en.find((n) => n.channel === "email")!;
    const esEmail = es.find((n) => n.channel === "email")!;
    expect(enEmail.body).not.toEqual(esEmail.body);
    expect(enEmail.subject).not.toEqual(esEmail.subject);
  });

  it("same-language fallback: an es-ES booking uses the es-MX template", () => {
    const out = planNotifications("booking.confirmed", bookingContext({ locale: "es-ES" }), baseConfig(), NOW);
    const email = out.find((n) => n.channel === "email")!;
    expect(email.body).toContain("Hola");
  });
});
