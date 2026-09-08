/**
 * Mock resource data for the checkout (consumed by @lumin/resources, a pure
 * reader). The DATABASE is authoritative at runtime; this is a preview dataset
 * so the SlotPicker/Summary can reflect resource-derived constraints without any
 * backend. Nothing here modifies the availability engine or its contract — the
 * app composes the engine's slot output with this resource picture.
 */
import type { Resource, ResourceReservation, ServiceResourceRequirement } from "@lumin/resources";
import { TENANT_ID, carDetailingService } from "./demoTenant";

const HOUR_MS = 3_600_000;

/** A pooled resource: two interchangeable detailing bays. */
export const DETAILING_BAY: Resource = {
  id: "res-detailing-bay",
  tenantId: TENANT_ID,
  name: "Detailing bay",
  kind: "equipment",
  mode: "pooled",
  capacity: 2,
  active: true,
};

export const resources: Resource[] = [DETAILING_BAY];

export const resourcesById: ReadonlyMap<string, Resource> = new Map(
  resources.map((r) => [r.id, r]),
);

/** The car-detailing vertical needs one bay per booking. */
export const serviceResourceRequirements: ServiceResourceRequirement[] = [
  {
    serviceId: carDetailingService.id,
    resourceId: DETAILING_BAY.id,
    quantityRequired: 1,
  },
];

/**
 * Existing holds that consume the pool for the near-term window, so the earliest
 * slots visibly reflect a resource constraint (both bays taken for ~20h from
 * now, then the pool frees up). Instants are relative to load time — this is a
 * mock preview, not persisted state.
 */
const now = Date.now();
const isoAt = (ms: number): string => new Date(ms).toISOString();
const farFuture = isoAt(now + 365 * 24 * HOUR_MS);

export const reservations: ResourceReservation[] = [
  {
    id: "rr-bay-1",
    tenantId: TENANT_ID,
    resourceId: DETAILING_BAY.id,
    bookingId: "seed-bay-hold-1",
    slotStart: isoAt(now - HOUR_MS),
    slotEnd: isoAt(now + 20 * HOUR_MS),
    status: "held",
    expiresAt: farFuture,
  },
  {
    id: "rr-bay-2",
    tenantId: TENANT_ID,
    resourceId: DETAILING_BAY.id,
    bookingId: "seed-bay-hold-2",
    slotStart: isoAt(now - HOUR_MS),
    slotEnd: isoAt(now + 20 * HOUR_MS),
    status: "held",
    expiresAt: farFuture,
  },
];
