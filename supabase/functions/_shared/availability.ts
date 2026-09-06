// _shared/availability.ts — Deno-native mirror of packages/core/src/availability.ts.
//
// ⚠️ DELIBERATE DUPLICATION (same rationale as _shared/pricing.ts). Ported so the
// edge runtime can RE-VERIFY availability fail-closed (SI-7) before opening a
// payment intent, without importing the Node/browser @lumin/core package. FAILS
// CLOSED: any invalid input, bad timezone, or missing rules yields "unavailable".
// Keep behavior in lock-step with packages/core/src/availability.ts.

export type AvailabilityRule = {
  weekday: number; // 0=Sunday
  serviceId: string | null;
  startMinute: number;
  endMinute: number;
  capacity: number;
};

export type AvailabilityOverride = {
  date: string; // YYYY-MM-DD (tenant-local)
  serviceId: string | null;
  kind: "closed" | "open";
  startMinute?: number;
  endMinute?: number;
  capacity?: number;
};

export type SchedulingPolicy = {
  leadTimeMinutes: number;
  horizonDays: number;
  slotIntervalMinutes: number;
};

export type Hold = { start: string; end: string };

export type AvailabilityQuery = {
  tenantTimezone: string;
  serviceId: string;
  durationMinutes: number;
  policy: SchedulingPolicy;
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  existing: Hold[];
  now: string;
  from: string;
  to: string;
};

type Slot = { start: string; end: string; remainingCapacity: number };

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

function tzOffsetMs(timeZone: string, utcMs: number): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing ${type} part`);
    return Number(part.value);
  };
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return wall - utcMs;
}

function localMinuteToUtcMs(timeZone: string, y: number, m: number, d: number, minuteOfDay: number): number {
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0) + minuteOfDay * 60_000;
  let utc = wall - tzOffsetMs(timeZone, wall);
  utc = wall - tzOffsetMs(timeZone, utc);
  return utc;
}

function localDateOfInstant(timeZone: string, utcMs: number): { y: number; m: number; d: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing ${type} part`);
    return Number(part.value);
  };
  return { y: get("year"), m: get("month"), d: get("day") };
}

function weekdayOfDate(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface Window {
  startMinute: number;
  endMinute: number;
  capacity: number;
}

function windowsForDate(query: AvailabilityQuery, y: number, m: number, d: number): Window[] {
  const weekday = weekdayOfDate(y, m, d);
  const date = isoDate(y, m, d);

  const applicableOverrides = query.overrides.filter(
    (o) => o.date === date && (o.serviceId === null || o.serviceId === query.serviceId),
  );
  const serviceOverrides = applicableOverrides.filter((o) => o.serviceId === query.serviceId);
  const effectiveOverrides = serviceOverrides.length > 0 ? serviceOverrides : applicableOverrides;

  if (effectiveOverrides.some((o) => o.kind === "closed")) return [];
  const openOverrides = effectiveOverrides.filter((o) => o.kind === "open");
  if (openOverrides.length > 0) {
    return openOverrides.map((o) => {
      if (o.startMinute === undefined || o.endMinute === undefined || o.startMinute >= o.endMinute) {
        return { startMinute: 0, endMinute: 0, capacity: 0 };
      }
      return { startMinute: o.startMinute, endMinute: o.endMinute, capacity: o.capacity ?? 1 };
    });
  }

  const dayRules = query.rules.filter(
    (r) => r.weekday === weekday && (r.serviceId === null || r.serviceId === query.serviceId),
  );
  const serviceRules = dayRules.filter((r) => r.serviceId === query.serviceId);
  const effectiveRules = serviceRules.length > 0 ? serviceRules : dayRules;

  return effectiveRules
    .filter((r) => r.startMinute < r.endMinute)
    .map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute, capacity: r.capacity }));
}

/** The raw grid capacity (before holds) for each slot start in the window. */
function capacityByStartMap(query: AvailabilityQuery): Map<number, number> | null {
  const { tenantTimezone, durationMinutes, policy } = query;

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return null;
  if (policy.slotIntervalMinutes < 5) return null;
  formatterFor(tenantTimezone);

  const nowMs = new Date(query.now).getTime();
  const fromMs = new Date(query.from).getTime();
  const toMs = new Date(query.to).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;

  const effFrom = Math.max(fromMs, nowMs + policy.leadTimeMinutes * 60_000);
  const effTo = Math.min(toMs, nowMs + policy.horizonDays * 86_400_000);
  if (effFrom > effTo) return new Map();

  if (query.rules.length === 0 && !query.overrides.some((o) => o.kind === "open")) return new Map();

  const first = localDateOfInstant(tenantTimezone, effFrom);
  let cursor = Date.UTC(first.y, first.m - 1, first.d) - 86_400_000;
  const last = localDateOfInstant(tenantTimezone, effTo);
  const lastMs = Date.UTC(last.y, last.m - 1, last.d) + 86_400_000;

  const capacityByStart = new Map<number, number>();

  for (; cursor <= lastMs; cursor += 86_400_000) {
    const day = new Date(cursor);
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();

    for (const window of windowsForDate(query, y, m, d)) {
      if (window.capacity < 1) continue;
      for (
        let minute = window.startMinute;
        minute + durationMinutes <= window.endMinute;
        minute += policy.slotIntervalMinutes
      ) {
        const startMs = localMinuteToUtcMs(tenantTimezone, y, m, d, minute);
        if (startMs < effFrom || startMs > effTo) continue;
        capacityByStart.set(startMs, (capacityByStart.get(startMs) ?? 0) + window.capacity);
      }
    }
  }
  return capacityByStart;
}

function computeSlots(query: AvailabilityQuery): Slot[] {
  const capacityByStart = capacityByStartMap(query);
  if (capacityByStart === null) return [];

  const holds = query.existing.map((h) => ({ start: new Date(h.start).getTime(), end: new Date(h.end).getTime() }));
  if (holds.some((h) => !Number.isFinite(h.start) || !Number.isFinite(h.end))) return [];

  const durationMs = query.durationMinutes * 60_000;
  const slots: Slot[] = [];
  for (const [startMs, capacity] of [...capacityByStart.entries()].sort((a, b) => a[0] - b[0])) {
    const endMs = startMs + durationMs;
    const consumed = holds.filter((h) => h.start < endMs && h.end > startMs).length;
    const remaining = capacity - consumed;
    if (remaining >= 1) {
      slots.push({ start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), remainingCapacity: remaining });
    }
  }
  return slots;
}

/** Fail-closed: true only if the exact slot start is provably available. */
export function isSlotAvailable(query: AvailabilityQuery, start: string): boolean {
  try {
    const target = new Date(start).getTime();
    if (!Number.isFinite(target)) return false;
    return computeSlots(query).some((s) => new Date(s.start).getTime() === target);
  } catch {
    return false;
  }
}

/**
 * The AUTHORITATIVE grid capacity for the exact slot start (before any holds) —
 * the summed capacity of the availability windows covering that instant. This
 * is the `p_capacity` handed to the DB-authoritative reserve_capacity RPC (F1).
 * Returns 0 when the slot is not on the grid at all (fail-closed).
 */
export function slotCapacityAt(query: AvailabilityQuery, start: string): number {
  try {
    const target = new Date(start).getTime();
    if (!Number.isFinite(target)) return 0;
    const capacityByStart = capacityByStartMap(query);
    if (capacityByStart === null) return 0;
    return capacityByStart.get(target) ?? 0;
  } catch {
    return 0;
  }
}
