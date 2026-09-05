import { Service, ServiceArchetype } from "@lumin/contracts";

/**
 * Inputs every template needs to materialize a tenant-scoped Service.
 *
 * A template is DATA + RULES only: it never reaches into an engine. It stamps
 * the caller's tenant, currency and timezone onto a configuration and returns a
 * plain `Service` that the SAME shared pricing/availability/booking engines
 * consume. There is no vertical branch anywhere — the vertical *is* the data.
 */
export interface TemplateBuildInput {
  /** Owning tenant (uuid). */
  tenantId: string;
  /** ISO 4217 currency the produced service prices in (USD, EUR, MXN, …). */
  currency: string;
  /**
   * IANA timezone of the tenant (e.g. "America/Chicago"). Carried through for
   * the scheduling layer; the pricing layer is timezone-independent, which is
   * exactly why the same template prices correctly the world over.
   */
  timezone: string;
  /** Optional deterministic service id; a random uuid is minted when omitted. */
  serviceId?: string;
}

/**
 * A pure factory from tenant context to a valid contracts `Service`. Each
 * template exercises the existing service primitives (items, add-ons,
 * questions, rental config) — never a new engine, never a new schema.
 */
export interface ServiceTemplate {
  /** Stable machine key, e.g. "car-detailing". */
  key: string;
  /** Human-facing catalog title. */
  title: string;
  /** Which flow preset over the shared primitives this template uses. */
  archetype: ServiceArchetype;
  /** Produce a validated Service for the given tenant/currency/timezone. */
  build(input: TemplateBuildInput): Service;
}
