import { describe, expect, it } from "vitest";
import {
  Subscription,
  entitlements,
  getPlan,
  hasAddon,
  hasFeature,
  sampleCatalog,
} from "../src/index";

const catalog = sampleCatalog();
const TENANT = "22222222-2222-2222-2222-222222222222";

function sub(planKey: string, status: Subscription["status"], addonKeys: string[] = []): Subscription {
  return {
    id: "sub_e",
    tenantId: TENANT,
    planKey,
    status,
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    addonKeys,
  };
}

describe("entitlement derives features/add-ons from Subscription + Plan only", () => {
  it("active pro subscription grants the plan's features", () => {
    const plan = getPlan(catalog, "pro");
    const ent = entitlements(sub("pro", "active", ["sms"]), plan);
    expect(ent.isActive).toBe(true);
    expect(ent.features).toEqual(new Set(["booking", "multi_service", "reminders", "analytics"]));
    expect(ent.activeAddons).toEqual(new Set(["sms"]));
  });

  it("trialing grants entitlement; incomplete and canceled do not", () => {
    const plan = getPlan(catalog, "pro");
    expect(entitlements(sub("pro", "trialing"), plan).isActive).toBe(true);
    expect(entitlements(sub("pro", "incomplete"), plan).isActive).toBe(false);
    const canceled = entitlements(sub("pro", "canceled"), plan);
    expect(canceled.isActive).toBe(false);
    expect(canceled.features.size).toBe(0);
    expect(canceled.activeAddons.size).toBe(0);
  });

  it("past_due keeps entitlement (grace window)", () => {
    const plan = getPlan(catalog, "pro");
    expect(entitlements(sub("pro", "past_due", ["sms"]), plan).isActive).toBe(true);
  });

  it("add-ons not permitted by the plan are ignored", () => {
    const plan = getPlan(catalog, "starter"); // permits no add-ons
    const ent = entitlements(sub("starter", "active", ["sms", "extra_seats"]), plan);
    expect(ent.activeAddons.size).toBe(0);
  });

  it("upgrade changes entitlements: starter → scale unlocks api_access", () => {
    const starter = entitlements(sub("starter", "active"), getPlan(catalog, "starter"));
    expect(starter.features.has("api_access")).toBe(false);
    const scale = entitlements(sub("scale", "active"), getPlan(catalog, "scale"));
    expect(scale.features.has("api_access")).toBe(true);
    expect(scale.features.has("priority_support")).toBe(true);
  });

  it("downgrade removes features: scale → starter drops analytics", () => {
    const scale = entitlements(sub("scale", "active"), getPlan(catalog, "scale"));
    expect(scale.features.has("analytics")).toBe(true);
    const starter = entitlements(sub("starter", "active"), getPlan(catalog, "starter"));
    expect(starter.features.has("analytics")).toBe(false);
  });

  it("hasFeature / hasAddon convenience predicates agree with entitlements", () => {
    const plan = getPlan(catalog, "pro");
    const s = sub("pro", "active", ["sms"]);
    expect(hasFeature(s, plan, "analytics")).toBe(true);
    expect(hasFeature(s, plan, "api_access")).toBe(false);
    expect(hasAddon(s, plan, "sms")).toBe(true);
    expect(hasAddon(s, plan, "extra_seats")).toBe(false);
  });

  it("throws if the plan does not match the subscription's planKey", () => {
    expect(() => entitlements(sub("pro", "active"), getPlan(catalog, "scale"))).toThrow(/plan mismatch/);
  });

  /**
   * Structural proof the derivation touches no provider field: entitlement is
   * identical whether or not we bolt arbitrary vendor-shaped junk onto the
   * record. The function only ever reads status / planKey / addonKeys.
   */
  it("ignores any extra provider-shaped fields on the record", () => {
    const plan = getPlan(catalog, "pro");
    const clean = sub("pro", "active", ["sms"]);
    const contaminated = {
      ...clean,
      // deliberately NOT part of Subscription — a real adapter must never add these
      stripeStatus: "canceled",
      paddle_state: "deleted",
      provider: "mercadopago",
    } as unknown as Subscription;
    expect(entitlements(contaminated, plan)).toEqual(entitlements(clean, plan));
  });
});
