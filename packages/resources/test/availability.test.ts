import { describe, expect, it } from "vitest";
import {
  Resource,
  ResourceReservation,
  canReserve,
  effectiveCapacity,
  overlaps,
  resolveServiceRequirements,
  resourceAvailability,
} from "../src/index";
import type { ServiceResourceRequirement } from "../src/index";
import {
  LATER_SLOT,
  NOW,
  SLOT,
  TENANT_A,
  exclusiveVehicle,
  heldReservation,
  pooledCrew,
} from "./fixtures";

describe("exclusive resource: at most one overlapping reservation", () => {
  const van = exclusiveVehicle();

  it("is free (1 unit) with no reservations", () => {
    expect(resourceAvailability(van, [], SLOT, NOW)).toBe(1);
    expect(canReserve(van, [], SLOT, NOW)).toBe(true);
  });

  it("denies a SECOND overlapping reservation (0 remaining)", () => {
    const held = [heldReservation("r1", van.id)];
    expect(resourceAvailability(van, held, SLOT, NOW)).toBe(0);
    expect(canReserve(van, held, SLOT, NOW)).toBe(false);
  });
});

describe("pooled resource capacity 3: 3 ok, 4th denied", () => {
  const crew = pooledCrew(3);

  it("effective capacity is the pool size", () => {
    expect(effectiveCapacity(crew)).toBe(3);
  });

  it("has 3 free with none held, 1 free with two held", () => {
    expect(resourceAvailability(crew, [], SLOT, NOW)).toBe(3);
    const twoHeld = [heldReservation("r1", crew.id), heldReservation("r2", crew.id)];
    expect(resourceAvailability(crew, twoHeld, SLOT, NOW)).toBe(1);
    expect(canReserve(crew, twoHeld, SLOT, NOW)).toBe(true);
  });

  it("denies the 4th when three units are already held (0 remaining)", () => {
    const threeHeld = [
      heldReservation("r1", crew.id),
      heldReservation("r2", crew.id),
      heldReservation("r3", crew.id),
    ];
    expect(resourceAvailability(crew, threeHeld, SLOT, NOW)).toBe(0);
    expect(canReserve(crew, threeHeld, SLOT, NOW)).toBe(false);
  });

  it("counts a consumed reservation the same as a live hold", () => {
    const threeMixed = [
      heldReservation("r1", crew.id, { status: "consumed" }),
      heldReservation("r2", crew.id),
      heldReservation("r3", crew.id),
    ];
    expect(resourceAvailability(crew, threeMixed, SLOT, NOW)).toBe(0);
  });
});

describe("expired / released reservations free a unit", () => {
  const van = exclusiveVehicle();

  it("an EXPIRED-status hold does not consume", () => {
    const expired = [heldReservation("r1", van.id, { status: "expired" })];
    expect(resourceAvailability(van, expired, SLOT, NOW)).toBe(1);
    expect(canReserve(van, expired, SLOT, NOW)).toBe(true);
  });

  it("a held hold PAST its expiresAt does not consume (freed by TTL)", () => {
    // expiresAt one hour BEFORE NOW → lapsed.
    const lapsed = [
      heldReservation("r1", van.id, { expiresAt: "2026-01-01T11:00:00.000Z" }),
    ];
    expect(resourceAvailability(van, lapsed, SLOT, NOW)).toBe(1);
  });

  it("a RELEASED hold does not consume", () => {
    const released = [heldReservation("r1", van.id, { status: "released" })];
    expect(resourceAvailability(van, released, SLOT, NOW)).toBe(1);
  });
});

describe("non-overlapping reservations do not consume", () => {
  const crew = pooledCrew(2);

  it("a live hold on a DIFFERENT (non-overlapping) slot leaves full capacity", () => {
    const otherSlot = [
      heldReservation("r1", crew.id, {
        slotStart: LATER_SLOT.start,
        slotEnd: LATER_SLOT.end,
      }),
    ];
    expect(resourceAvailability(crew, otherSlot, SLOT, NOW)).toBe(2);
  });

  it("a reservation for a DIFFERENT resource id is ignored", () => {
    const otherResource = [heldReservation("r1", "res-someone-else")];
    expect(resourceAvailability(crew, otherResource, SLOT, NOW)).toBe(2);
  });

  it("half-open: touching at the endpoint does not overlap", () => {
    expect(overlaps(SLOT.start, SLOT.end, SLOT.end, LATER_SLOT.end)).toBe(false);
    expect(overlaps(SLOT.start, SLOT.end, "2026-01-01T15:00:00.000Z", "2026-01-01T17:00:00.000Z")).toBe(true);
  });
});

describe("inactive resource fails closed", () => {
  it("an inactive resource has 0 availability regardless of holds", () => {
    const off: Resource = { ...exclusiveVehicle(), active: false };
    expect(resourceAvailability(off, [], SLOT, NOW)).toBe(0);
    expect(canReserve(off, [], SLOT, NOW)).toBe(false);
  });
});

describe("service resource requirements: a service requiring 2 crew resolves", () => {
  const crew = pooledCrew(3);
  const van = exclusiveVehicle();
  const resourcesById = new Map<string, Resource>([
    [crew.id, crew],
    [van.id, van],
  ]);
  const serviceId = "00000000-0000-0000-0000-0000000000aa";

  it("SATISFIED when the crew pool has >= 2 free units", () => {
    const reqs: ServiceResourceRequirement[] = [
      { serviceId, resourceId: crew.id, quantityRequired: 2 },
    ];
    const result = resolveServiceRequirements(reqs, resourcesById, [], SLOT, NOW);
    expect(result.satisfiable).toBe(true);
    expect(result.shortfalls).toEqual([]);
    expect(result.resolutions[0]!.remaining).toBe(3);
  });

  it("UNSATISFIED when only 1 crew unit remains but 2 are required", () => {
    const held: ResourceReservation[] = [
      heldReservation("r1", crew.id),
      heldReservation("r2", crew.id),
    ];
    const reqs: ServiceResourceRequirement[] = [
      { serviceId, resourceId: crew.id, quantityRequired: 2 },
    ];
    const result = resolveServiceRequirements(reqs, resourcesById, held, SLOT, NOW);
    expect(result.satisfiable).toBe(false);
    expect(result.shortfalls).toHaveLength(1);
    expect(result.shortfalls[0]!.remaining).toBe(1);
  });

  it("resolves a MULTI-resource service (2 crew AND 1 van) as a whole", () => {
    const reqs: ServiceResourceRequirement[] = [
      { serviceId, resourceId: crew.id, quantityRequired: 2 },
      { serviceId, resourceId: van.id, quantityRequired: 1 },
    ];
    const result = resolveServiceRequirements(reqs, resourcesById, [], SLOT, NOW);
    expect(result.satisfiable).toBe(true);
    expect(result.resolutions).toHaveLength(2);

    // With the van already exclusively held, the whole service cannot be met.
    const vanHeld = [heldReservation("v1", van.id)];
    const blocked = resolveServiceRequirements(reqs, resourcesById, vanHeld, SLOT, NOW);
    expect(blocked.satisfiable).toBe(false);
    expect(blocked.shortfalls.map((s) => s.resourceId)).toEqual([van.id]);
  });

  it("fails CLOSED on a requirement pointing at an unknown resource", () => {
    const reqs: ServiceResourceRequirement[] = [
      { serviceId, resourceId: "res-does-not-exist", quantityRequired: 1 },
    ];
    const result = resolveServiceRequirements(reqs, resourcesById, [], SLOT, NOW);
    expect(result.satisfiable).toBe(false);
    expect(result.shortfalls[0]!.missing).toBe(true);
  });
});

describe("schema validation", () => {
  it("accepts a valid pooled resource and rejects an exclusive with capacity > 1", () => {
    expect(() => Resource.parse(pooledCrew(5))).not.toThrow();
    expect(() =>
      Resource.parse({ ...exclusiveVehicle(), capacity: 2 }),
    ).toThrow();
  });

  it("accepts a valid reservation and rejects a bad status", () => {
    const good = heldReservation("r1", "res-van-1");
    expect(() => ResourceReservation.parse(good)).not.toThrow();
    expect(() => ResourceReservation.parse({ ...good, status: "bogus" })).toThrow();
    expect(good.tenantId).toBe(TENANT_A);
  });
});
