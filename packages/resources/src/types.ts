import { z } from "zod";
import { TenantId } from "@lumin/contracts";

/**
 * ResourceModelContract (package-local) — a GENERIC bookable-resource model.
 *
 * The charter, applied to resources: a vehicle, a trailer, a room, a crew and a
 * technician are all just data over ONE model. A resource is either an
 * EXCLUSIVE unit (mode 'exclusive', capacity 1 — a vehicle/trailer/room booked
 * whole) or POOLED capacity (mode 'pooled', capacity N — a crew of N, a bank of
 * technicians). `kind` is a descriptive label only; `mode` + `capacity` carry
 * ALL the scheduling semantics. There is no ERP/inventory here — only "how many
 * of THIS resource can a slot consume".
 *
 * Everything is TENANT-owned (`tenantId` on every record, a `@lumin/contracts`
 * `TenantId`). This model is the authoritative shape; the DB (0012_resources)
 * is authoritative at RUNTIME (holds are minted under an advisory lock by
 * lumin.reserve_resource) — this package is the pure planner/reader that
 * composes with the W6 capacity holds under identical overlap semantics.
 */

/** Descriptive label. Semantics come from `mode`/`capacity`, never from here. */
export const ResourceKind = z.enum([
  "vehicle",
  "crew",
  "technician",
  "trailer",
  "equipment",
  "room",
  "generic",
]);
export type ResourceKind = z.infer<typeof ResourceKind>;

/**
 * EXCLUSIVE = a single indivisible unit (capacity is always 1 — a slot either
 * gets it or does not). POOLED = shared capacity of N interchangeable units
 * (a slot may consume 1..N).
 */
export const ResourceMode = z.enum(["exclusive", "pooled"]);
export type ResourceMode = z.infer<typeof ResourceMode>;

/**
 * A bookable resource. For an exclusive resource `capacity` MUST be 1 (enforced
 * by refine); for a pooled resource `capacity` is the pool size N (>= 1).
 */
export const Resource = z
  .object({
    id: z.string().min(1),
    tenantId: TenantId,
    name: z.string().min(1),
    kind: ResourceKind,
    mode: ResourceMode,
    /** Pool size for 'pooled'; always 1 for 'exclusive'. */
    capacity: z.number().int().min(1),
    active: z.boolean(),
  })
  .refine((r) => r.mode !== "exclusive" || r.capacity === 1, {
    message: "an exclusive resource must have capacity 1",
    path: ["capacity"],
  });
export type Resource = z.infer<typeof Resource>;

/**
 * The lifecycle status of a reservation — MIRRORS the DB
 * (public.resource_reservations.status in 0012) and the W6 hold model:
 *   held     → reserved, counts against capacity until it expires or is used
 *   consumed → the booking was confirmed; the unit is locked in for it
 *   released → the checkout failed/cancelled; the unit returned to the pool
 *   expired  → TTL elapsed without confirm; treated as non-consuming
 * Only 'held' (not past `expiresAt`) and 'consumed' reservations consume a unit.
 */
export const ReservationStatus = z.enum(["held", "consumed", "released", "expired"]);
export type ReservationStatus = z.infer<typeof ReservationStatus>;

/**
 * One reservation of one resource for one booking over a [slotStart, slotEnd)
 * window. `expiresAt` is the hold TTL (ignored once `status` is 'consumed').
 * All instants are UTC ISO strings, exchanged the same way availability slots
 * are (never read from a wall clock inside the engine — `now` is injected).
 */
export const ResourceReservation = z.object({
  id: z.string().min(1),
  tenantId: TenantId,
  resourceId: z.string().min(1),
  bookingId: z.string().min(1),
  slotStart: z.string().datetime(),
  slotEnd: z.string().datetime(),
  status: ReservationStatus,
  expiresAt: z.string().datetime(),
});
export type ResourceReservation = z.infer<typeof ResourceReservation>;

/**
 * A service REQUIRES `quantityRequired` units of a resource. Mirrors the DB
 * link table public.service_resources (0012). One row per (serviceId,
 * resourceId).
 */
export const ServiceResourceRequirement = z.object({
  serviceId: z.string().uuid(),
  resourceId: z.string().min(1),
  quantityRequired: z.number().int().min(1),
});
export type ServiceResourceRequirement = z.infer<typeof ServiceResourceRequirement>;

/** A [start, end) window, UTC ISO instants — the same shape a slot is exchanged as. */
export interface ResourceSlot {
  start: string;
  end: string;
}
