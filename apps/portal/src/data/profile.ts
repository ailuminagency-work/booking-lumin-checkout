/**
 * Portal profile gate (additive, frontend-protecting).
 *
 * Given a tenant's activated `profileKey`, resolve the profile's allowed
 * template archetypes and terminology from the pure `PROFILE_REGISTRY`. This
 * is the ONLY place the portal turns a profile into a filtered archetype menu +
 * vocabulary — the Services page and Embed Builder both read it, so a cleaning
 * tenant sees a cleaning menu and a rental tenant a rental one.
 *
 * When `profileKey` is null the tenant has NOT activated a profile yet: the
 * gate returns `active: false` and the full template catalog (existing UI),
 * and callers show an activation prompt. No working component is removed.
 */
import type { BusinessProfile, ProfileConfig, ServiceArchetype, Tenant } from "@lumin/contracts";
import { getProfile } from "@lumin/contracts";
import { listTemplates, type ServiceTemplate } from "@lumin/templates";

export interface ProfileGate {
  /** True once the tenant has an activated profile. */
  active: boolean;
  /** The resolved profile config, or null when not activated. */
  profile: ProfileConfig | null;
  /** Templates this tenant may adopt (all templates when not activated). */
  allowedTemplates: ServiceTemplate[];
  /** Fast membership test for a template key under the active profile. */
  allowsTemplate(key: string): boolean;
  /** Whether an archetype is reachable by any allowed template. */
  allowsArchetype(archetype: ServiceArchetype): boolean;
}

/** Resolve the profile config for a tenant, or null when unactivated/unknown. */
export function profileFor(tenant: Pick<Tenant, "profileKey">): ProfileConfig | null {
  const key = tenant.profileKey as BusinessProfile | null | undefined;
  if (!key) return null;
  try {
    return getProfile(key);
  } catch {
    return null;
  }
}

/**
 * Build the archetype gate for a tenant. Activated → only the profile's
 * `allowedTemplateKeys`; not activated → the full catalog (unchanged UI).
 */
export function profileGate(tenant: Pick<Tenant, "profileKey">): ProfileGate {
  const profile = profileFor(tenant);
  const all = listTemplates();

  if (!profile) {
    return {
      active: false,
      profile: null,
      allowedTemplates: all,
      allowsTemplate: () => true,
      allowsArchetype: () => true,
    };
  }

  const allowed = new Set(profile.allowedTemplateKeys);
  const allowedTemplates = all.filter((t) => allowed.has(t.key));
  const archetypes = new Set(allowedTemplates.map((t) => t.archetype));

  return {
    active: true,
    profile,
    allowedTemplates,
    allowsTemplate: (key: string) => allowed.has(key),
    allowsArchetype: (archetype: ServiceArchetype) => archetypes.has(archetype),
  };
}
