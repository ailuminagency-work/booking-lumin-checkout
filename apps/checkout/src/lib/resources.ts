/**
 * Checkout integration seam onto @lumin/resources.
 *
 * The availability engine (do-not-touch) decides WHICH time slots exist; this
 * layer decides whether a resource-backed service can actually be staffed for a
 * given slot, by composing the engine's slots with the resource reservation
 * picture under identical overlap semantics. Pure reader — it never grants a
 * unit (the database does that atomically at runtime).
 */
import {
  effectiveCapacity,
  resolveServiceRequirements,
  resourceAvailability,
  type RequirementResolution,
} from "@lumin/resources";
import {
  reservations,
  resourcesById,
  serviceResourceRequirements,
} from "../config/resources";

export interface ResourceSlotStatus {
  /** True when this service declares resource requirements. */
  resourceBacked: boolean;
  /** Whole-service verdict: every required resource has enough free units. */
  satisfiable: boolean;
  /** Remaining units of the primary resource (badge numerator). */
  remaining: number;
  /** Capacity of the primary resource (badge denominator). */
  capacity: number;
  /** Primary resource's display name, or null when not resource-backed. */
  resourceName: string | null;
  /** Unmet requirement lines (empty when satisfiable). */
  shortfalls: RequirementResolution[];
}

const NOT_BACKED: ResourceSlotStatus = {
  resourceBacked: false,
  satisfiable: true,
  remaining: 0,
  capacity: 0,
  resourceName: null,
  shortfalls: [],
};

export function requirementsForService(serviceId: string | undefined | null) {
  if (!serviceId) return [];
  return serviceResourceRequirements.filter((r) => r.serviceId === serviceId);
}

export function isResourceBacked(serviceId: string | undefined | null): boolean {
  return requirementsForService(serviceId).length > 0;
}

/** Resource-derived status of a service for one slot at instant `now`. */
export function resourceStatusForSlot(
  serviceId: string,
  slot: { start: string; end: string },
  now: string,
): ResourceSlotStatus {
  const reqs = requirementsForService(serviceId);
  if (reqs.length === 0) return NOT_BACKED;

  const result = resolveServiceRequirements(reqs, resourcesById, reservations, slot, now);
  const primary = reqs[0]!;
  const resource = resourcesById.get(primary.resourceId) ?? null;
  const remaining = resource
    ? resourceAvailability(resource, reservations, slot, now)
    : 0;
  const capacity = resource ? effectiveCapacity(resource) : 0;

  return {
    resourceBacked: true,
    satisfiable: result.satisfiable,
    remaining,
    capacity,
    resourceName: resource?.name ?? null,
    shortfalls: result.shortfalls,
  };
}
