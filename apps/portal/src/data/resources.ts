/**
 * Mock resource dataset for the portal's Resources view (via @lumin/resources,
 * a pure reader). Fixed instants keep the availability preview deterministic.
 * The database is authoritative at runtime; this is preview data only.
 */
import type { Resource, ResourceReservation, ResourceSlot } from "@lumin/resources";
import { DEMO_TENANT_ID } from "./mockTenant";

export const portalResources: Resource[] = [
  {
    id: "res-crew-a",
    tenantId: DEMO_TENANT_ID,
    name: "Field crew",
    kind: "crew",
    mode: "pooled",
    capacity: 3,
    active: true,
  },
  {
    id: "res-bay-1",
    tenantId: DEMO_TENANT_ID,
    name: "Service bay 1",
    kind: "equipment",
    mode: "exclusive",
    capacity: 1,
    active: true,
  },
  {
    id: "res-van-1",
    tenantId: DEMO_TENANT_ID,
    name: "Cargo van",
    kind: "vehicle",
    mode: "exclusive",
    capacity: 1,
    active: true,
  },
];

/** The slot the Resources view previews availability for. */
export const SAMPLE_SLOT: ResourceSlot = {
  start: "2026-09-08T15:00:00.000Z",
  end: "2026-09-08T16:00:00.000Z",
};

export const SAMPLE_NOW = "2026-09-08T12:00:00.000Z";

const farFuture = "2027-01-01T00:00:00.000Z";

/**
 * Active holds over the sample slot: one crew unit and the single bay are taken,
 * so the preview shows crew 2/3 and bay 0/1 (fully booked), van 1/1 (free).
 */
export const portalReservations: ResourceReservation[] = [
  {
    id: "rr-crew-1",
    tenantId: DEMO_TENANT_ID,
    resourceId: "res-crew-a",
    bookingId: "seed-portal-crew",
    slotStart: SAMPLE_SLOT.start,
    slotEnd: SAMPLE_SLOT.end,
    status: "held",
    expiresAt: farFuture,
  },
  {
    id: "rr-bay-1",
    tenantId: DEMO_TENANT_ID,
    resourceId: "res-bay-1",
    bookingId: "seed-portal-bay",
    slotStart: SAMPLE_SLOT.start,
    slotEnd: SAMPLE_SLOT.end,
    status: "consumed",
    expiresAt: farFuture,
  },
];
