import { describe, expect, it } from "vitest";
import { AvailabilityQuery } from "@lumin/contracts";
import { createAvailabilityEngine } from "../src/availability";
import { blackout, policy, rule, uuid } from "./helpers";

/**
 * W4 scheduling extensions — ranged/recurring blackouts + seasonal rule
 * effective-date windows, plus explicit DST-correctness proofs.
 *
 * These tests are ADDITIVE; the existing 11 tests in availability.test.ts are
 * untouched. Everything here uses fixed injected now/from/to (clock-free).
 */

const engine = createAvailabilityEngine();
const SERVICE = uuid(20);
const OTHER_SERVICE = uuid(21);
const TZ = "America/Chicago";

// Mon–Fri 09:00–17:00 tenant-local (weekday 1–5)
const weekdayRules = [1, 2, 3, 4, 5].map((weekday) =>
  rule({ weekday, startMinute: 540, endMinute: 1020, capacity: 1 }),
);
// All seven days 09:00–17:00 (used by range/annual tests so every date has base slots)
const allWeekRules = [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
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

const startsOn = (slots: { start: string }[], date: string) =>
  slots.filter((s) => s.start.startsWith(date));

// ---------------------------------------------------------------------------
// Blackouts
// ---------------------------------------------------------------------------

describe("blackout: single date", () => {
  it("removes every slot that starts on a single blacked-out date, leaving other days", () => {
    // Mon 01-05 and Tue 01-06 both have 8 slots without a blackout.
    const base = engine.getSlots(query({ to: "2026-01-07T00:00:00.000Z" }));
    expect(startsOn(base, "2026-01-05")).toHaveLength(8);
    expect(startsOn(base, "2026-01-06")).toHaveLength(8);

    const slots = engine.getSlots(
      query({ to: "2026-01-07T00:00:00.000Z", blackouts: [blackout({ from: "2026-01-05", to: "2026-01-05" })] }),
    );
    expect(startsOn(slots, "2026-01-05")).toHaveLength(0); // Monday closed
    expect(startsOn(slots, "2026-01-06")).toHaveLength(8); // Tuesday untouched
  });
});

describe("blackout: inclusive date range", () => {
  it("includes both boundary days; the day after `to` is open", () => {
    // Query Mon 01-05 … Fri 01-09. Blackout the inclusive range 01-05..01-07.
    const slots = engine.getSlots(
      query({
        now: "2026-01-04T00:00:00.000Z",
        from: "2026-01-05T00:00:00.000Z",
        to: "2026-01-10T00:00:00.000Z",
        blackouts: [blackout({ from: "2026-01-05", to: "2026-01-07" })],
      }),
    );
    // Boundary days (from and to) are both closed.
    expect(startsOn(slots, "2026-01-05")).toHaveLength(0);
    expect(startsOn(slots, "2026-01-06")).toHaveLength(0);
    expect(startsOn(slots, "2026-01-07")).toHaveLength(0);
    // The day AFTER `to` is open again (proves `to` is inclusive, not exclusive).
    expect(startsOn(slots, "2026-01-08")).toHaveLength(8);
    expect(startsOn(slots, "2026-01-09")).toHaveLength(8);
  });

  it("fails CLOSED on a backwards-typed once-range (from > to) — normalized, not ignored", () => {
    // A tenant misconfigures the vacation with the dates inverted. Because
    // blackouts must fail closed, the intended range 01-05..01-07 is still
    // closed rather than silently left bookable.
    const slots = engine.getSlots(
      query({
        now: "2026-01-04T00:00:00.000Z",
        from: "2026-01-05T00:00:00.000Z",
        to: "2026-01-10T00:00:00.000Z",
        blackouts: [blackout({ from: "2026-01-07", to: "2026-01-05" })],
      }),
    );
    expect(startsOn(slots, "2026-01-05")).toHaveLength(0);
    expect(startsOn(slots, "2026-01-06")).toHaveLength(0);
    expect(startsOn(slots, "2026-01-07")).toHaveLength(0);
    // Days outside the intended range stay open.
    expect(startsOn(slots, "2026-01-08")).toHaveLength(8);
  });
});

describe("blackout: annual recurrence across a year boundary", () => {
  const holiday = blackout({ from: "2000-12-24", to: "2001-01-02", recurrence: "annual" });

  it("closes the recurring month/day range even when it wraps Dec→Jan", () => {
    const slots = engine.getSlots(
      query({
        rules: allWeekRules,
        now: "2026-12-22T00:00:00.000Z",
        from: "2026-12-23T00:00:00.000Z",
        to: "2027-01-04T00:00:00.000Z",
        blackouts: [holiday],
      }),
    );
    // Day before the range: open.
    expect(startsOn(slots, "2026-12-23").length).toBeGreaterThan(0);
    // Every date inside the wrapped range across the year boundary: closed.
    for (const d of ["2026-12-24", "2026-12-31", "2027-01-01", "2027-01-02"]) {
      expect(startsOn(slots, d)).toHaveLength(0);
    }
    // Day after the range: open again.
    expect(startsOn(slots, "2027-01-03").length).toBeGreaterThan(0);
  });

  it("recurs in a different year (same MM-DD closed a year earlier)", () => {
    const slots = engine.getSlots(
      query({
        rules: allWeekRules,
        now: "2025-12-23T00:00:00.000Z",
        from: "2025-12-24T00:00:00.000Z",
        to: "2025-12-25T00:00:00.000Z",
        blackouts: [holiday],
      }),
    );
    expect(slots).toEqual([]);
  });
});

describe("blackout: per-service vs tenant-wide scoping", () => {
  const day = { now: "2026-01-04T00:00:00.000Z", from: "2026-01-05T00:00:00.000Z", to: "2026-01-06T00:00:00.000Z" };

  it("a tenant-wide blackout (serviceId null) closes the queried service", () => {
    const slots = engine.getSlots(query({ ...day, blackouts: [blackout({ from: "2026-01-05", to: "2026-01-05" })] }));
    expect(slots).toEqual([]);
  });

  it("a blackout scoped to a DIFFERENT service does not affect the queried service", () => {
    const slots = engine.getSlots(
      query({ ...day, blackouts: [blackout({ from: "2026-01-05", to: "2026-01-05", serviceId: OTHER_SERVICE })] }),
    );
    expect(slots).toHaveLength(8);
  });

  it("a blackout scoped to the queried service closes it", () => {
    const slots = engine.getSlots(
      query({ ...day, blackouts: [blackout({ from: "2026-01-05", to: "2026-01-05", serviceId: SERVICE })] }),
    );
    expect(slots).toEqual([]);
  });
});

describe("blackout: fail closed — beats an open override", () => {
  it("a blackout removes slots an open override would have created (safer outcome wins)", () => {
    const openOnly = engine.getSlots(
      query({ overrides: [{ id: uuid(801), tenantId: uuid(1), serviceId: null, date: "2026-01-05", kind: "open", startMinute: 600, endMinute: 720 }] }),
    );
    expect(openOnly.length).toBeGreaterThan(0); // sanity: override alone opens the day

    const slots = engine.getSlots(
      query({
        overrides: [{ id: uuid(801), tenantId: uuid(1), serviceId: null, date: "2026-01-05", kind: "open", startMinute: 600, endMinute: 720 }],
        blackouts: [blackout({ from: "2026-01-05", to: "2026-01-05" })],
      }),
    );
    expect(slots).toEqual([]); // blackout wins → closed
  });
});

describe("blackout: partial-day window (nice-to-have)", () => {
  it("clips only the blacked-out minute window out of the day", () => {
    // Mon 09:00–17:00 CST base → starts 15:00Z…22:00Z. Black out 10:00–12:00.
    const slots = engine.getSlots(
      query({ blackouts: [blackout({ from: "2026-01-05", to: "2026-01-05", startMinute: 600, endMinute: 720 })] }),
    );
    expect(slots.map((s) => s.start)).toEqual([
      "2026-01-05T15:00:00.000Z", // 09:00 CST survives
      // 10:00 (16:00Z) and 11:00 (17:00Z) fall inside the blackout → removed
      "2026-01-05T18:00:00.000Z", // 12:00 CST
      "2026-01-05T19:00:00.000Z",
      "2026-01-05T20:00:00.000Z",
      "2026-01-05T21:00:00.000Z",
      "2026-01-05T22:00:00.000Z",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Seasonal rule effective-date windows
// ---------------------------------------------------------------------------

describe("seasonal rule: effective-date window", () => {
  // A Monday summer rule effective 2026-06-01 … 2026-08-31 (both Mondays).
  const summerRule = rule({ weekday: 1, startMinute: 540, endMinute: 1020, effectiveFrom: "2026-06-01", effectiveTo: "2026-08-31" });
  const monday = (date: string): Partial<AvailabilityQuery> => {
    const from = `${date}T00:00:00.000Z`;
    const prevDay = new Date(Date.parse(from) - 86_400_000).toISOString();
    const to = new Date(Date.parse(from) + 86_400_000).toISOString();
    return { rules: [summerRule], now: prevDay, from, to };
  };

  it("applies inside the window", () => {
    const slots = engine.getSlots(query(monday("2026-07-06"))); // Mon in July (CDT)
    expect(slots).toHaveLength(8);
    expect(slots[0]?.start).toBe("2026-07-06T14:00:00.000Z"); // 09:00 CDT
  });

  it("is ignored before the window and after the window", () => {
    expect(engine.getSlots(query(monday("2026-01-05")))).toEqual([]); // before effectiveFrom
    expect(engine.getSlots(query(monday("2026-09-07")))).toEqual([]); // after effectiveTo
  });

  it("includes both boundary dates (inclusive)", () => {
    expect(engine.getSlots(query(monday("2026-06-01")))).toHaveLength(8); // == effectiveFrom
    expect(engine.getSlots(query(monday("2026-08-31")))).toHaveLength(8); // == effectiveTo
    // Mondays just outside each boundary are excluded.
    expect(engine.getSlots(query(monday("2026-05-25")))).toEqual([]); // effectiveFrom − 7d
    expect(engine.getSlots(query(monday("2026-09-07")))).toEqual([]); // effectiveTo + 7d
  });

  it("a rule with no window behaves exactly as today (always effective)", () => {
    const always = [rule({ weekday: 1, startMinute: 540, endMinute: 1020 })];
    expect(engine.getSlots(query({ ...monday("2026-01-05"), rules: always }))).toHaveLength(8);
    expect(engine.getSlots(query({ ...monday("2026-07-06"), rules: always }))).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// DST correctness proof (required W4 evidence) — America/Chicago
// ---------------------------------------------------------------------------

describe("DST proof: spring-forward 2026-03-08 (a wall-clock hour that does not exist)", () => {
  const sunday00to06 = [rule({ weekday: 0, startMinute: 0, endMinute: 360 })];

  it("collapses the nonexistent 02:00 onto 03:00 — no double-count, no gap", () => {
    const slots = engine.getSlots(
      query({
        rules: sunday00to06,
        now: "2026-03-07T00:00:00.000Z",
        from: "2026-03-08T00:00:00.000Z",
        to: "2026-03-09T00:00:00.000Z",
      }),
    );
    // Local grid 00:00,01:00,02:00,03:00,04:00,05:00 (six points). 00:00/01:00 are
    // CST (UTC-6) → 06:00Z/07:00Z; 03:00–05:00 are CDT (UTC-5) → 08:00Z–10:00Z; the
    // nonexistent 02:00 resolves onto 08:00Z (== 03:00 CDT) and dedups. Five distinct
    // contiguous instants, one bookable slot lost, no repeated instant.
    expect(slots.map((s) => s.start)).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T09:00:00.000Z",
      "2026-03-08T10:00:00.000Z",
    ]);
    // Distinct instants (no double-count) and strictly increasing 1h apart (no phantom gap).
    const ms = slots.map((s) => Date.parse(s.start));
    expect(new Set(ms).size).toBe(ms.length);
    const gaps = ms.slice(1).map((v, i) => v - ms[i]!);
    expect(gaps).toEqual([3_600_000, 3_600_000, 3_600_000, 3_600_000]);
  });

  it("a normal 09:00–17:00 rule yields 8 CDT slots on the spring-forward day", () => {
    const slots = engine.getSlots(
      query({
        rules: [rule({ weekday: 0, startMinute: 540, endMinute: 1020 })],
        now: "2026-03-07T00:00:00.000Z",
        from: "2026-03-08T00:00:00.000Z",
        to: "2026-03-09T00:00:00.000Z",
      }),
    );
    expect(slots).toHaveLength(8);
    expect(slots[0]?.start).toBe("2026-03-08T14:00:00.000Z"); // 09:00 CDT (UTC-5)
    expect(slots[slots.length - 1]?.start).toBe("2026-03-08T21:00:00.000Z"); // 16:00 CDT
  });
});

describe("DST proof: fall-back 2026-11-01 (a wall-clock hour that occurs twice)", () => {
  const sunday00to06 = [rule({ weekday: 0, startMinute: 0, endMinute: 360 })];

  it("offers the repeated 01:00 hour exactly once — no double-booking", () => {
    const slots = engine.getSlots(
      query({
        rules: sunday00to06,
        now: "2026-10-31T00:00:00.000Z",
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-02T00:00:00.000Z",
      }),
    );
    // Local grid 00:00–05:00. 00:00 is CDT (UTC-5) → 05:00Z; the ambiguous 01:00 is
    // offered once at 06:00Z (CDT), NOT also at 07:00Z (CST); 02:00–05:00 are CST
    // (UTC-6) → 08:00Z–11:00Z. Six distinct instants, repeated hour counted once.
    expect(slots.map((s) => s.start)).toEqual([
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
      "2026-11-01T11:00:00.000Z",
    ]);
    // The second occurrence of 01:00 CST (07:00Z) must NOT appear (no double-count).
    expect(slots.some((s) => s.start === "2026-11-01T07:00:00.000Z")).toBe(false);
    const ms = slots.map((s) => Date.parse(s.start));
    expect(new Set(ms).size).toBe(ms.length);
  });

  it("a normal 09:00–17:00 rule yields 8 CST slots on the fall-back day", () => {
    const slots = engine.getSlots(
      query({
        rules: [rule({ weekday: 0, startMinute: 540, endMinute: 1020 })],
        now: "2026-10-31T00:00:00.000Z",
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-02T00:00:00.000Z",
      }),
    );
    expect(slots).toHaveLength(8);
    expect(slots[0]?.start).toBe("2026-11-01T15:00:00.000Z"); // 09:00 CST (UTC-6)
    expect(slots[slots.length - 1]?.start).toBe("2026-11-01T22:00:00.000Z"); // 16:00 CST
  });
});

// ---------------------------------------------------------------------------
// Property-style monotonicity
// ---------------------------------------------------------------------------

describe("property: blackouts and narrowing windows can only remove slots", () => {
  const wide = query({
    rules: allWeekRules,
    now: "2026-01-04T00:00:00.000Z",
    from: "2026-01-05T00:00:00.000Z",
    to: "2026-01-12T00:00:00.000Z",
  });

  it("adding a blackout is a strict subset of the un-blacked-out slots", () => {
    const without = engine.getSlots(wide);
    const withBlackout = engine.getSlots({
      ...wide,
      blackouts: [blackout({ from: "2026-01-07", to: "2026-01-09" })],
    });
    const withoutStarts = new Set(without.map((s) => s.start));
    expect(withBlackout.length).toBeLessThan(without.length);
    // Every surviving slot existed before, with unchanged capacity.
    for (const s of withBlackout) {
      expect(withoutStarts.has(s.start)).toBe(true);
      expect(without.find((w) => w.start === s.start)?.remainingCapacity).toBe(s.remainingCapacity);
    }
  });

  it("narrowing a rule's effective window is a subset of the always-effective rule", () => {
    const alwaysRules = [1, 2, 3, 4, 5].map((weekday) => rule({ weekday, startMinute: 540, endMinute: 1020 }));
    const narrowedRules = [1, 2, 3, 4, 5].map((weekday) =>
      rule({ weekday, startMinute: 540, endMinute: 1020, effectiveFrom: "2026-01-07", effectiveTo: "2026-01-09" }),
    );
    const all = engine.getSlots({ ...wide, rules: alwaysRules });
    const narrowed = engine.getSlots({ ...wide, rules: narrowedRules });
    const allStarts = new Set(all.map((s) => s.start));
    expect(narrowed.length).toBeLessThan(all.length);
    for (const s of narrowed) expect(allStarts.has(s.start)).toBe(true);
  });
});
