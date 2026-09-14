import { describe, expect, it } from "vitest";
import {
  BusinessProfile,
  EmbedStep,
  PROFILE_REGISTRY,
  ProfileConfig,
  getProfile,
  listProfiles,
} from "../src/profile";

const ALL_KEYS = BusinessProfile.options;

describe("BusinessProfile registry", () => {
  it("declares exactly the six profiles", () => {
    expect(ALL_KEYS).toEqual([
      "CLEANING",
      "DETAILING",
      "VEHICLE_RENTAL",
      "EQUIPMENT_RENTAL",
      "JUNK_REMOVAL",
      "EVENT_RENTAL",
    ]);
    expect(Object.keys(PROFILE_REGISTRY).sort()).toEqual([...ALL_KEYS].sort());
  });

  it("every profile config is well-formed (parses ProfileConfig)", () => {
    for (const key of ALL_KEYS) {
      const cfg = PROFILE_REGISTRY[key];
      // Re-parse to prove the shape is valid config, not just typed.
      expect(() => ProfileConfig.parse(cfg)).not.toThrow();
      expect(cfg.key).toBe(key);
      expect(cfg.label.length).toBeGreaterThan(0);
    }
  });

  it("maps each profile to at least one allowed template key", () => {
    for (const key of ALL_KEYS) {
      expect(PROFILE_REGISTRY[key].allowedTemplateKeys.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("terminology carries non-empty customer + worker vocabulary", () => {
    for (const key of ALL_KEYS) {
      const t = PROFILE_REGISTRY[key].terminology;
      expect(t.customer.length).toBeGreaterThan(0);
      expect(t.worker.length).toBeGreaterThan(0);
      expect(t.service.length).toBeGreaterThan(0);
      expect(t.booking.length).toBeGreaterThan(0);
    }
  });

  it("capabilities are all booleans over the six flags", () => {
    for (const key of ALL_KEYS) {
      const c = PROFILE_REGISTRY[key].capabilities;
      for (const flag of ["scheduling", "resourceExclusive", "resourcePooled", "quantity", "serviceArea", "worker"] as const) {
        expect(typeof c[flag]).toBe("boolean");
      }
    }
  });

  it("embedFlow is well-formed: valid step keys, starts service, ends confirmation", () => {
    for (const key of ALL_KEYS) {
      const flow = PROFILE_REGISTRY[key].embedFlow;
      expect(flow.length).toBeGreaterThan(0);
      expect(flow[0]).toBe("service");
      expect(flow[flow.length - 1]).toBe("confirmation");
      for (const step of flow) expect(EmbedStep.options).toContain(step);
      // No duplicate steps.
      expect(new Set(flow).size).toBe(flow.length);
    }
  });

  it("onboarding hints are a non-empty list of non-empty strings", () => {
    for (const key of ALL_KEYS) {
      const hints = PROFILE_REGISTRY[key].onboarding;
      expect(hints.length).toBeGreaterThan(0);
      for (const h of hints) expect(h.length).toBeGreaterThan(0);
    }
  });

  it("getProfile resolves valid keys and rejects unknown ones", () => {
    expect(getProfile("CLEANING").key).toBe("CLEANING");
    expect(getProfile("VEHICLE_RENTAL").label).toBe("Vehicle Rental");
    expect(() => getProfile("NOPE")).toThrow(/unknown business profile/);
  });

  it("listProfiles returns all six in enum order, fresh array each call", () => {
    const a = listProfiles();
    const b = listProfiles();
    expect(a.map((p) => p.key)).toEqual([...ALL_KEYS]);
    expect(a).not.toBe(b);
  });
});
