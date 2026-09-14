import { describe, it, expect } from "vitest";
import { isSlotAvailable, slotCapacityAt, type AvailabilityQuery } from "./confirm-availability";

// R5 (availability fail-closed): a slot that cannot be proven free is
// unavailable, and the capacity handed to reserve_capacity comes from the SAME
// inputs as the availability decision.

const SLOT = "2026-09-15T10:00:00.000Z";
const WEEKDAY = new Date(Date.UTC(2026, 8, 15)).getUTCDay();

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    tenantTimezone: "UTC",
    serviceId: "svc",
    durationMinutes: 60,
    policy: { leadTimeMinutes: 0, horizonDays: 60, slotIntervalMinutes: 60 },
    rules: [{ weekday: WEEKDAY, serviceId: null, startMinute: 600, endMinute: 660, capacity: 2 }],
    overrides: [],
    existing: [],
    now: "2026-09-14T00:00:00.000Z",
    from: SLOT,
    to: SLOT,
    ...overrides,
  };
}

describe("confirm availability (R5)", () => {
  it("derives the grid capacity and availability from the same inputs", () => {
    expect(slotCapacityAt(query(), SLOT)).toBe(2);
    expect(isSlotAvailable(query(), SLOT)).toBe(true);
  });

  it("fails closed when no rules are configured", () => {
    expect(slotCapacityAt(query({ rules: [] }), SLOT)).toBe(0);
    expect(isSlotAvailable(query({ rules: [] }), SLOT)).toBe(false);
  });

  it("counts overlapping holds against remaining availability", () => {
    const q = query({
      rules: [{ weekday: WEEKDAY, serviceId: null, startMinute: 600, endMinute: 660, capacity: 1 }],
      existing: [{ start: SLOT, end: "2026-09-15T11:00:00.000Z" }],
    });
    // Grid capacity is 1 but the single unit is already held → unavailable.
    expect(slotCapacityAt(q, SLOT)).toBe(1);
    expect(isSlotAvailable(q, SLOT)).toBe(false);
  });

  it("fails closed on a closed-day override", () => {
    const q = query({ overrides: [{ date: "2026-09-15", serviceId: null, kind: "closed" }] });
    expect(isSlotAvailable(q, SLOT)).toBe(false);
  });
});
