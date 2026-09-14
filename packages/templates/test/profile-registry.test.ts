import { describe, expect, it } from "vitest";
import { BusinessProfile, PROFILE_REGISTRY } from "@lumin/contracts";
import { templateRegistry } from "../src/registry";

/**
 * The one-directional coupling check: every archetype key a profile allows
 * must be a REAL key in @lumin/templates' registry. contracts/profile.ts
 * imports nothing internal, so this cross-package assertion lives here (the
 * templates package can see both sides) — it is what keeps the profile menu
 * from ever pointing at a dangling archetype.
 */
describe("PROFILE_REGISTRY ↔ templateRegistry", () => {
  it("every allowedTemplateKey resolves to a registered template", () => {
    for (const key of BusinessProfile.options) {
      const profile = PROFILE_REGISTRY[key];
      for (const templateKey of profile.allowedTemplateKeys) {
        expect(
          templateRegistry[templateKey],
          `profile ${key} references missing template "${templateKey}"`,
        ).toBeDefined();
      }
    }
  });

  it("each profile maps to at least one real template", () => {
    for (const key of BusinessProfile.options) {
      const resolved = PROFILE_REGISTRY[key].allowedTemplateKeys.filter((k) => templateRegistry[k]);
      expect(resolved.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every registered template is reachable from exactly one profile (no orphan archetypes)", () => {
    const owners = new Map<string, string[]>();
    for (const key of BusinessProfile.options) {
      for (const templateKey of PROFILE_REGISTRY[key].allowedTemplateKeys) {
        owners.set(templateKey, [...(owners.get(templateKey) ?? []), key]);
      }
    }
    for (const templateKey of Object.keys(templateRegistry)) {
      const claimants = owners.get(templateKey) ?? [];
      expect(claimants.length, `template "${templateKey}" is not owned by any profile`).toBe(1);
    }
  });
});
