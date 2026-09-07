/**
 * @lumin/resources — a GENERIC resource / pool / reservation model for Booking
 * Lumin Checkout, composed with the W6 capacity holds.
 *
 * The charter, applied to resources: a vehicle, a trailer, a room, a crew and a
 * technician are all just data over ONE model. A resource is either an
 * EXCLUSIVE unit (capacity 1) or POOLED capacity (a crew of N). `mode` +
 * `capacity` carry every scheduling semantic; `kind` is only a label. There is
 * no ERP/inventory here — only "how many of THIS resource can a slot consume".
 *
 * The package is model + pure reader only: `resourceAvailability` / `canReserve`
 * count overlapping ACTIVE (non-expired) reservations with the EXACT semantics
 * lumin.reserve_resource and lumin.reserve_capacity use in the database, and
 * `resolveServiceRequirements` answers "can this service get the resources it
 * needs for this slot". No wall clock, no I/O — `now` is injected and results
 * are reproducible. The DATABASE is authoritative at runtime: holds are minted
 * atomically under a (tenant, resource, slot) advisory lock by
 * lumin.reserve_resource (supabase/migrations/0012_resources.sql); this reader
 * plans and previews and never itself grants a unit.
 *
 * Additive only: depends solely on `@lumin/contracts`; touches no core, adapter,
 * contract, or app code.
 */

export {
  ResourceKind,
  ResourceMode,
  Resource,
  ReservationStatus,
  ResourceReservation,
  ServiceResourceRequirement,
} from "./types";
export type { ResourceSlot } from "./types";

export {
  overlaps,
  reservationConsumes,
  effectiveCapacity,
  resourceAvailability,
  canReserve,
  resolveServiceRequirements,
} from "./availability";
export type {
  RequirementResolution,
  ServiceRequirementResult,
} from "./availability";
