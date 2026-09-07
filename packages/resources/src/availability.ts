import type {
  Resource,
  ResourceReservation,
  ResourceSlot,
  ServiceResourceRequirement,
} from "./types";

/**
 * Resource availability — a PURE, deterministic reader that composes with the
 * W6 capacity engine under IDENTICAL overlap semantics.
 *
 * A reservation CONSUMES a unit of its resource for a slot iff it OVERLAPS the
 * slot and is "active":
 *   * status 'consumed'                      → always counts (confirmed unit)
 *   * status 'held' AND expiresAt > now      → counts (in-flight hold)
 *   * status 'held' AND expiresAt <= now     → does NOT count (expired hold)
 *   * status 'released' | 'expired'          → does NOT count (back in the pool)
 * This is exactly the rule lumin.reserve_resource (0012) and lumin.reserve_capacity
 * (0010) apply in the database, so the JS reader and the DB writer never disagree
 * about who holds a unit. The DB remains AUTHORITATIVE at runtime (it mints holds
 * under an advisory lock); this reader plans and previews.
 *
 * `now` is INJECTED (never a wall clock inside the engine) — same discipline as
 * the AvailabilityContract, so results are reproducible and fail-closed.
 */

/** Epoch ms for an ISO instant; NaN if unparseable (callers treat NaN as unsafe). */
function toMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Half-open overlap: [aStart, aEnd) intersects [bStart, bEnd) iff aStart < bEnd
 * and bStart < aEnd. Touching at an endpoint (aEnd === bStart) does NOT overlap.
 * Fails CLOSED: any unparseable/degenerate instant is treated as overlapping so
 * an unverifiable reservation can never silently free a unit.
 */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = toMs(aStart);
  const ae = toMs(aEnd);
  const bs = toMs(bStart);
  const be = toMs(bEnd);
  if ([as, ae, bs, be].some((n) => Number.isNaN(n))) return true; // fail closed
  return as < be && bs < ae;
}

/**
 * Does a reservation currently consume a unit of its resource for `slot`, at
 * instant `now`? See the module header for the (status, expiry, overlap) rule.
 */
export function reservationConsumes(
  reservation: ResourceReservation,
  slot: ResourceSlot,
  now: string,
): boolean {
  const active =
    reservation.status === "consumed" ||
    (reservation.status === "held" && toMs(reservation.expiresAt) > toMs(now));
  if (!active) return false;
  return overlaps(reservation.slotStart, reservation.slotEnd, slot.start, slot.end);
}

/** The effective capacity of a resource: exclusive is always 1, pooled is N. */
export function effectiveCapacity(resource: Resource): number {
  return resource.mode === "exclusive" ? 1 : resource.capacity;
}

/**
 * Remaining units of `resource` for `slot` at `now`, given the resource's
 * reservations. Exclusive → 0 or 1; pooled → capacity − overlapping active
 * reservations, floored at 0. An inactive resource yields 0 (fail closed).
 *
 * `reservations` may contain rows for OTHER resources; only those whose
 * `resourceId` matches are counted, so callers can pass a tenant-wide list.
 */
export function resourceAvailability(
  resource: Resource,
  reservations: readonly ResourceReservation[],
  slot: ResourceSlot,
  now: string,
): number {
  if (!resource.active) return 0;
  const capacity = effectiveCapacity(resource);
  let consumed = 0;
  for (const r of reservations) {
    if (r.resourceId !== resource.id) continue;
    if (reservationConsumes(r, slot, now)) consumed += 1;
  }
  return Math.max(0, capacity - consumed);
}

/**
 * Can `quantity` units of `resource` be reserved for `slot` at `now`?
 * True iff remaining availability is at least `quantity` (default 1). For an
 * exclusive resource the only meaningful quantity is 1.
 */
export function canReserve(
  resource: Resource,
  reservations: readonly ResourceReservation[],
  slot: ResourceSlot,
  now: string,
  quantity = 1,
): boolean {
  if (quantity < 1) return false;
  return resourceAvailability(resource, reservations, slot, now) >= quantity;
}

/** One line of a requirements resolution: what a service needs vs. what is free. */
export interface RequirementResolution {
  serviceId: string;
  resourceId: string;
  quantityRequired: number;
  remaining: number;
  /** True iff the resource exists, is active, and remaining >= quantityRequired. */
  satisfied: boolean;
  /** Present when the requirement points at a missing/unknown resource. */
  missing?: boolean;
}

/** The whole-service verdict: every requirement satisfied, plus per-line detail. */
export interface ServiceRequirementResult {
  satisfiable: boolean;
  resolutions: RequirementResolution[];
  /** The lines that were NOT satisfied (empty when satisfiable). */
  shortfalls: RequirementResolution[];
}

/**
 * Resolve a service's resource requirements against the current reservation
 * picture. A service that requires, say, 2 crew is satisfiable iff its crew
 * resource has >= 2 units free for the slot. Fails CLOSED: a requirement whose
 * resource is unknown (or inactive) is unsatisfied, never skipped.
 *
 * `resourcesById` maps resourceId → Resource; `reservations` is any list (rows
 * for unrelated resources are ignored per-line by `resourceAvailability`).
 */
export function resolveServiceRequirements(
  requirements: readonly ServiceResourceRequirement[],
  resourcesById: ReadonlyMap<string, Resource>,
  reservations: readonly ResourceReservation[],
  slot: ResourceSlot,
  now: string,
): ServiceRequirementResult {
  const resolutions: RequirementResolution[] = requirements.map((req) => {
    const resource = resourcesById.get(req.resourceId);
    if (!resource) {
      return {
        serviceId: req.serviceId,
        resourceId: req.resourceId,
        quantityRequired: req.quantityRequired,
        remaining: 0,
        satisfied: false,
        missing: true,
      };
    }
    const remaining = resourceAvailability(resource, reservations, slot, now);
    return {
      serviceId: req.serviceId,
      resourceId: req.resourceId,
      quantityRequired: req.quantityRequired,
      remaining,
      satisfied: remaining >= req.quantityRequired,
    };
  });

  const shortfalls = resolutions.filter((r) => !r.satisfied);
  return { satisfiable: shortfalls.length === 0, resolutions, shortfalls };
}
