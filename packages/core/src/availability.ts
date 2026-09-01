import {
  AvailabilityEngine,
  AvailabilityOverride,
  AvailabilityQuery,
  AvailabilityRule,
  Slot,
} from "@lumin/contracts";

/**
 * Pure, clock-free availability engine. `now` is always injected via the
 * query. FAILS CLOSED: any internal error, invalid timezone, or missing
 * rules yields zero slots (and therefore "unavailable").
 *
 * Rule times are minutes-from-midnight in the TENANT timezone; slots are
 * exchanged as UTC ISO instants. Timezone conversion uses Intl only.
 */
export function createAvailabilityEngine(): AvailabilityEngine {
  return {
    getSlots(query: AvailabilityQuery): Slot[] {
      try {
        return computeSlots(query);
      } catch {
        return []; // fail closed
      }
    },
    isSlotAvailable(query: AvailabilityQuery, start: string): boolean {
      try {
        const target = new Date(start).getTime();
        if (!Number.isFinite(target)) return false;
        return computeSlots(query).some((s) => new Date(s.start).getTime() === target);
      } catch {
        return false; // fail closed
      }
    },
  };
}

// ---------------------------------------------------------------------------
// timezone helpers (Intl-based; DST-safe by computing the offset per instant)
// ---------------------------------------------------------------------------

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

/** Offset (ms) such that wallClock = utc + offset for the given instant. */
function tzOffsetMs(timeZone: string, utcMs: number): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing ${type} part`);
    return Number(part.value);
  };
  let hour = get("hour");
  if (hour === 24) hour = 0; // some ICU versions render midnight as 24
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return wall - utcMs;
}

/** Convert a tenant-local calendar date + minute-of-day to a UTC epoch ms. */
export function localMinuteToUtcMs(timeZone: string, y: number, m: number, d: number, minuteOfDay: number): number {
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0) + minuteOfDay * 60_000;
  // First guess assumes offset at the wall instant, then re-derive at the guess
  // so DST transition days resolve to the correct offset.
  let utc = wall - tzOffsetMs(timeZone, wall);
  utc = wall - tzOffsetMs(timeZone, utc);
  return utc;
}

/** Tenant-local calendar date of a UTC instant. */
function localDateOfInstant(timeZone: string, utcMs: number): { y: number; m: number; d: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing ${type} part`);
    return Number(part.value);
  };
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Weekday (0=Sunday) of a calendar date — timezone-independent. */
function weekdayOfDate(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// slot computation
// ---------------------------------------------------------------------------

interface Window {
  startMinute: number;
  endMinute: number;
  capacity: number;
}

function windowsForDate(query: AvailabilityQuery, y: number, m: number, d: number): Window[] {
  const weekday = weekdayOfDate(y, m, d);
  const date = isoDate(y, m, d);

  // Overrides for this date: service-specific take precedence over tenant-wide.
  const applicableOverrides = query.overrides.filter(
    (o: AvailabilityOverride) => o.date === date && (o.serviceId === null || o.serviceId === query.serviceId),
  );
  const serviceOverrides = applicableOverrides.filter((o) => o.serviceId === query.serviceId);
  const effectiveOverrides = serviceOverrides.length > 0 ? serviceOverrides : applicableOverrides;

  if (effectiveOverrides.some((o) => o.kind === "closed")) return [];
  const openOverrides = effectiveOverrides.filter((o) => o.kind === "open");
  if (openOverrides.length > 0) {
    return openOverrides.map((o) => {
      if (o.startMinute === undefined || o.endMinute === undefined || o.startMinute >= o.endMinute) {
        // malformed open override: fail closed for this day
        return { startMinute: 0, endMinute: 0, capacity: 0 };
      }
      return { startMinute: o.startMinute, endMinute: o.endMinute, capacity: o.capacity ?? 1 };
    });
  }

  // Weekly rules: if any service-specific rule exists for this weekday, use
  // only those; otherwise fall back to tenant-wide (serviceId null) rules.
  const dayRules = query.rules.filter(
    (r: AvailabilityRule) => r.weekday === weekday && (r.serviceId === null || r.serviceId === query.serviceId),
  );
  const serviceRules = dayRules.filter((r) => r.serviceId === query.serviceId);
  const effectiveRules = serviceRules.length > 0 ? serviceRules : dayRules;

  return effectiveRules
    .filter((r) => r.startMinute < r.endMinute)
    .map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute, capacity: r.capacity }));
}

function computeSlots(query: AvailabilityQuery): Slot[] {
  const { tenantTimezone, durationMinutes, policy } = query;

  // Validate inputs; anything unprovable means no slots (fail closed).
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return [];
  if (policy.slotIntervalMinutes < 5) return [];
  // Throws on invalid timezone → caught by the callers above.
  formatterFor(tenantTimezone);

  const nowMs = new Date(query.now).getTime();
  const fromMs = new Date(query.from).getTime();
  const toMs = new Date(query.to).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];

  const effFrom = Math.max(fromMs, nowMs + policy.leadTimeMinutes * 60_000);
  const effTo = Math.min(toMs, nowMs + policy.horizonDays * 86_400_000);
  if (effFrom > effTo) return [];

  if (query.rules.length === 0 && !query.overrides.some((o) => o.kind === "open")) return [];

  const holds = query.existing.map((h) => ({ start: new Date(h.start).getTime(), end: new Date(h.end).getTime() }));
  if (holds.some((h) => !Number.isFinite(h.start) || !Number.isFinite(h.end))) return [];

  // Iterate tenant-local calendar dates covering [effFrom, effTo] with one
  // day of margin on each side (timezone offsets never exceed a day).
  const first = localDateOfInstant(tenantTimezone, effFrom);
  let cursor = Date.UTC(first.y, first.m - 1, first.d) - 86_400_000;
  const last = localDateOfInstant(tenantTimezone, effTo);
  const lastMs = Date.UTC(last.y, last.m - 1, last.d) + 86_400_000;

  // capacity per slot start (windows on the same day may stack capacity)
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

  const durationMs = durationMinutes * 60_000;
  const slots: Slot[] = [];
  for (const [startMs, capacity] of [...capacityByStart.entries()].sort((a, b) => a[0] - b[0])) {
    const endMs = startMs + durationMs;
    const consumed = holds.filter((h) => h.start < endMs && h.end > startMs).length;
    const remaining = capacity - consumed;
    if (remaining >= 1) {
      slots.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        remainingCapacity: remaining,
      });
    }
  }
  return slots;
}
