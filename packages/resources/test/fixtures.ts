import type { Resource, ResourceReservation, ResourceSlot } from "../src/types";

/** A fixed tenant id (valid uuid) shared across the resource tests. */
export const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** The instant every test evaluates "now" at (injected, never a wall clock). */
export const NOW = "2026-01-01T12:00:00.000Z";

/** The slot under test: 14:00–16:00 UTC, well after NOW. */
export const SLOT: ResourceSlot = {
  start: "2026-01-01T14:00:00.000Z",
  end: "2026-01-01T16:00:00.000Z",
};

/** A slot that does NOT overlap SLOT (16:00–18:00, touching end excluded). */
export const LATER_SLOT: ResourceSlot = {
  start: "2026-01-01T16:00:00.000Z",
  end: "2026-01-01T18:00:00.000Z",
};

export function exclusiveVehicle(): Resource {
  return {
    id: "res-van-1",
    tenantId: TENANT_A,
    name: "Cargo Van 1",
    kind: "vehicle",
    mode: "exclusive",
    capacity: 1,
    active: true,
  };
}

export function pooledCrew(capacity = 3): Resource {
  return {
    id: "res-crew",
    tenantId: TENANT_A,
    name: "Install Crew",
    kind: "crew",
    mode: "pooled",
    capacity,
    active: true,
  };
}

/**
 * A held reservation for `resourceId` overlapping SLOT, expiring an hour after
 * NOW (i.e. still live at NOW).
 */
export function heldReservation(
  id: string,
  resourceId: string,
  overrides: Partial<ResourceReservation> = {},
): ResourceReservation {
  return {
    id,
    tenantId: TENANT_A,
    resourceId,
    bookingId: `booking-${id}`,
    slotStart: SLOT.start,
    slotEnd: SLOT.end,
    status: "held",
    expiresAt: "2026-01-01T13:00:00.000Z", // 1h after NOW → live
    ...overrides,
  };
}
