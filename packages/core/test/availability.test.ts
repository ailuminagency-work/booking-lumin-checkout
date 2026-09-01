import { describe, expect, it } from "vitest";
import { AvailabilityQuery } from "@lumin/contracts";
import { createAvailabilityEngine } from "../src/availability";
import { override, policy, rule, uuid } from "./helpers";

const engine = createAvailabilityEngine();
const SERVICE = uuid(20);
const TZ = "America/Chicago";

// Mon–Fri 09:00–17:00 tenant-local (weekday 1–5)
const weekdayRules = [1, 2, 3, 4, 5].map((weekday) =>
  rule({ weekday, startMinute: 540, endMinute: 1020, capacity: 1 }),
);

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    tenantTimezone: TZ,
    serviceId: SERVICE,
    durationMinutes: 60,
    policy: policy(),
    rules: weekdayRules,
    overrides: [],
    existing: [],
    now: "2026-01-04T00:00:00.000Z", // Sunday
    from: "2026-01-05T00:00:00.000Z", // Monday
    to: "2026-01-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("availability: weekly windows in a non-UTC timezone", () => {
  it("converts tenant-local windows to UTC (CST is UTC-6 in January)", () => {
    const slots = engine.getSlots(query());
    // Mon 09:00–17:00 CST, 60-min slots on a 60-min grid → 15:00Z … 22:00Z starts
    expect(slots[0]?.start).toBe("2026-01-05T15:00:00.000Z");
    expect(slots[slots.length - 1]?.start).toBe("2026-01-05T22:00:00.000Z");
    expect(slots).toHaveLength(8);
    expect(slots.every((s) => s.remainingCapacity === 1)).toBe(true);
  });

  it("computes correct UTC offsets across the 2026-03-08 DST boundary", () => {
    const slots = engine.getSlots(
      query({
        rules: [
          rule({ weekday: 6, startMinute: 540, endMinute: 600 }), // Sat 09:00–10:00
          rule({ weekday: 0, startMinute: 540, endMinute: 600 }), // Sun 09:00–10:00
        ],
        now: "2026-03-06T00:00:00.000Z",
        from: "2026-03-07T00:00:00.000Z",
        to: "2026-03-09T00:00:00.000Z",
      }),
    );
    expect(slots.map((s) => s.start)).toEqual([
      "2026-03-07T15:00:00.000Z", // Sat 09:00 CST (UTC-6)
      "2026-03-08T14:00:00.000Z", // Sun 09:00 CDT (UTC-5) — DST started
    ]);
  });
});

describe("availability: policy limits", () => {
  it("lead time excludes near slots", () => {
    const slots = engine.getSlots(
      query({
        policy: policy({ leadTimeMinutes: 120 }),
        now: "2026-01-05T15:30:00.000Z", // Mon 09:30 CST
      }),
    );
    // earliest allowed start is 17:30Z → first grid slot 18:00Z
    expect(slots[0]?.start).toBe("2026-01-05T18:00:00.000Z");
  });

  it("horizon caps how far ahead slots exist", () => {
    const slots = engine.getSlots(
      query({
        policy: policy({ horizonDays: 2 }),
        now: "2026-01-04T00:00:00.000Z",
        to: "2026-01-16T00:00:00.000Z",
      }),
    );
    const horizonEnd = Date.parse("2026-01-06T00:00:00.000Z");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => Date.parse(s.start) <= horizonEnd)).toBe(true);
  });
});

describe("availability: overrides", () => {
  it("closed override removes the day", () => {
    const slots = engine.getSlots(query({ overrides: [override({ date: "2026-01-05", kind: "closed" })] }));
    expect(slots).toEqual([]);
  });

  it("open override replaces the weekly windows for that date", () => {
    const slots = engine.getSlots(
      query({
        overrides: [override({ date: "2026-01-05", kind: "open", startMinute: 600, endMinute: 720 })],
      }),
    );
    // replacement window 10:00–12:00 CST → starts 16:00Z and 17:00Z only
    expect(slots.map((s) => s.start)).toEqual(["2026-01-05T16:00:00.000Z", "2026-01-05T17:00:00.000Z"]);
  });
});

describe("availability: capacity and holds", () => {
  const capacity2 = [rule({ weekday: 1, startMinute: 540, endMinute: 720, capacity: 2 })];

  it("subtracts capacity consumed by overlapping holds and drops exhausted slots", () => {
    const hold = { start: "2026-01-05T15:00:00.000Z", end: "2026-01-05T16:00:00.000Z" };
    const one = engine.getSlots(query({ rules: capacity2, existing: [hold] }));
    expect(one.find((s) => s.start === "2026-01-05T15:00:00.000Z")?.remainingCapacity).toBe(1);
    const none = engine.getSlots(query({ rules: capacity2, existing: [hold, hold] }));
    expect(none.find((s) => s.start === "2026-01-05T15:00:00.000Z")).toBeUndefined();
    expect(none.find((s) => s.start === "2026-01-05T16:00:00.000Z")?.remainingCapacity).toBe(2);
  });
});

describe("availability: fail closed", () => {
  it("returns [] for an invalid timezone and for no rules; isSlotAvailable is false", () => {
    expect(engine.getSlots(query({ tenantTimezone: "Not/AZone" }))).toEqual([]);
    expect(engine.getSlots(query({ rules: [] }))).toEqual([]);
    expect(engine.isSlotAvailable(query({ tenantTimezone: "Not/AZone" }), "2026-01-05T15:00:00.000Z")).toBe(false);
    expect(engine.isSlotAvailable(query({ rules: [] }), "2026-01-05T15:00:00.000Z")).toBe(false);
    expect(engine.isSlotAvailable(query(), "not-a-date")).toBe(false);
  });

  it("isSlotAvailable is true only for an exact generated slot start", () => {
    expect(engine.isSlotAvailable(query(), "2026-01-05T15:00:00.000Z")).toBe(true);
    expect(engine.isSlotAvailable(query(), "2026-01-05T15:30:00.000Z")).toBe(false);
  });
});

describe("availability: service-specific rule precedence", () => {
  it("uses only service-specific rules for a weekday when any exist", () => {
    const slots = engine.getSlots(
      query({
        rules: [
          rule({ weekday: 1, startMinute: 540, endMinute: 1020 }), // tenant-wide
          rule({ id: uuid(950), weekday: 1, startMinute: 600, endMinute: 720, serviceId: SERVICE }),
        ],
      }),
    );
    expect(slots.map((s) => s.start)).toEqual(["2026-01-05T16:00:00.000Z", "2026-01-05T17:00:00.000Z"]);
  });

  it("ignores rules that belong to a different service", () => {
    const slots = engine.getSlots(
      query({ rules: [rule({ weekday: 1, startMinute: 540, endMinute: 1020, serviceId: uuid(21) })] }),
    );
    expect(slots).toEqual([]);
  });
});
