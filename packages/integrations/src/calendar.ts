import type { CalendarEventInput, CalendarProvider, TenantId } from "@lumin/contracts";
import type { ConnectionHealth } from "./connection";
import { mockHealth } from "./connection";

/**
 * Richer calendar adapters over the existing `CalendarProvider` contract.
 *
 * SOURCE OF TRUTH. An external calendar (Google, Microsoft) MIRRORS Booking
 * Lumin availability and BLOCKS times the owner is busy elsewhere — but Booking
 * Lumin's own database remains authoritative. External busy windows are merged
 * in for DISPLAY only (`mergeBusy`); a conflict never silently overrides an
 * internal hold. Writes to the external calendar are best-effort projections of
 * internal bookings, not the system of record.
 *
 * The abstraction is proved by two mock adapters with DIFFERENT capabilities
 * that satisfy ONE interface: the Google mock answers a free/busy query
 * directly, the Microsoft mock returns events and derives busy windows from
 * them. Calling code uses `adapter.readBusy(...)` without knowing which.
 */

/** A half-open [start, end) busy interval, UTC ISO strings. */
export interface BusyWindow {
  start: string;
  end: string;
  /** Where the window came from — internal holds are authoritative. */
  source: "internal" | "external";
}

export interface TimeRange {
  start: string; // UTC ISO
  end: string; // UTC ISO
}

/** What an adapter can do — lets callers branch without hardcoding provider names. */
export interface CalendarCapabilities {
  /** Provider answers a native free/busy query (e.g. Google FreeBusy). */
  freeBusyQuery: boolean;
  /** Provider returns event objects that must be reduced to busy windows (e.g. Microsoft Graph). */
  eventList: boolean;
  /** Provider accepts event writes (create/update/cancel). */
  writeEvents: boolean;
}

export interface SyncResult {
  provider: string;
  /** Number of external busy windows observed at sync time. */
  externalWindows: number;
  syncedAt: string;
}

/**
 * The richer adapter port. Extends the base `CalendarProvider` (createEvent /
 * deleteEvent) with availability reads, updates/cancels, sync, and health.
 */
export interface RichCalendarAdapter extends CalendarProvider {
  readonly capabilities: CalendarCapabilities;
  /** External busy windows in a range — however the provider computes them. */
  readBusy(tenantId: TenantId, range: TimeRange): Promise<BusyWindow[]>;
  updateEvent(
    tenantId: TenantId,
    eventId: string,
    patch: Partial<Omit<CalendarEventInput, "tenantId" | "bookingId">>,
  ): Promise<{ eventId: string }>;
  /** Cancel an event (semantic alias of the contract's deleteEvent). */
  cancelEvent(tenantId: TenantId, eventId: string): Promise<void>;
  sync(tenantId: TenantId, range: TimeRange): Promise<SyncResult>;
  health(): Promise<ConnectionHealth>;
  reconnect(): Promise<ConnectionHealth>;
}

/** Inspection surface for tests/tooling. */
export interface MockCalendarAdapter extends RichCalendarAdapter {
  listEvents(): (CalendarEventInput & { eventId: string })[];
  cancelledEventIds(): string[];
}

// ---------------------------------------------------------------------------
// mergeBusy — union external + internal windows for DISPLAY (internal wins)
// ---------------------------------------------------------------------------

/**
 * Union internal holds with external busy windows into a normalized, sorted,
 * overlap-merged list for DISPLAY. Internal data is authoritative: every
 * internal hold is preserved in the output (its interval is never dropped), and
 * where an external window merely overlaps an internal one the merged span is
 * tagged `internal`. External-only spans keep `external`. The result is what a
 * calendar view renders; it never mutates the internal holds it was given.
 */
export function mergeBusy(internalHolds: BusyWindow[], externalBusy: BusyWindow[]): BusyWindow[] {
  const internal = internalHolds.map((w) => ({ ...w, source: "internal" as const }));
  const external = externalBusy.map((w) => ({ ...w, source: "external" as const }));
  const all = [...internal, ...external]
    .filter((w) => Date.parse(w.end) > Date.parse(w.start))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const merged: BusyWindow[] = [];
  for (const w of all) {
    const last = merged[merged.length - 1];
    if (last && Date.parse(w.start) <= Date.parse(last.end)) {
      // Overlap/adjacency: extend the span; internal provenance wins the tag.
      if (Date.parse(w.end) > Date.parse(last.end)) last.end = w.end;
      if (w.source === "internal" || last.source === "internal") last.source = "internal";
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Shared adapter internals
// ---------------------------------------------------------------------------

function overlaps(aStart: string, aEnd: string, range: TimeRange): boolean {
  return Date.parse(aStart) < Date.parse(range.end) && Date.parse(aEnd) > Date.parse(range.start);
}

interface AdapterOptions {
  /** Seed external free/busy or events so mocks are deterministic. */
  seedBusy?: BusyWindow[];
  /** Force health state for tests (default healthy/connected). */
  health?: ConnectionHealth;
}

function makeAdapter(
  providerName: string,
  capabilities: CalendarCapabilities,
  readBusyImpl: (
    tenantId: TenantId,
    range: TimeRange,
    ctx: {
      events: Map<string, CalendarEventInput & { eventId: string }>;
      seed: BusyWindow[];
    },
  ) => BusyWindow[],
  opts: AdapterOptions,
): MockCalendarAdapter {
  const events = new Map<string, CalendarEventInput & { eventId: string }>();
  const cancelled: string[] = [];
  const seed = (opts.seedBusy ?? []).map((w) => ({ ...w, source: "external" as const }));
  let counter = 0;
  let currentHealth: ConnectionHealth = opts.health ?? mockHealth(providerName, "connected");

  return {
    providerName,
    capabilities,

    async createEvent(input) {
      counter += 1;
      const eventId = `${providerName}_ev_${counter}`;
      events.set(eventId, { ...input, eventId });
      return { eventId };
    },

    async updateEvent(tenantId, eventId, patch) {
      const existing = events.get(eventId);
      if (existing && existing.tenantId === tenantId) {
        events.set(eventId, { ...existing, ...patch, eventId });
      }
      return { eventId };
    },

    async deleteEvent(tenantId, eventId) {
      const existing = events.get(eventId);
      if (existing && existing.tenantId === tenantId) {
        events.delete(eventId);
        cancelled.push(eventId);
      }
    },

    async cancelEvent(tenantId, eventId) {
      await this.deleteEvent(tenantId, eventId);
    },

    async readBusy(tenantId, range) {
      return readBusyImpl(tenantId, range, { events, seed });
    },

    async sync(_tenantId, range) {
      const windows = seed.filter((w) => overlaps(w.start, w.end, range));
      return { provider: providerName, externalWindows: windows.length, syncedAt: range.start };
    },

    async health() {
      return currentHealth;
    },

    async reconnect() {
      currentHealth = mockHealth(providerName, "connected");
      return currentHealth;
    },

    listEvents() {
      return [...events.values()].map((e) => ({ ...e }));
    },

    cancelledEventIds() {
      return [...cancelled];
    },
  };
}

// ---------------------------------------------------------------------------
// Google mock — native free/busy query capability
// ---------------------------------------------------------------------------

/**
 * Google-style mock: supports a native free/busy query. `readBusy` returns the
 * seeded external busy windows intersecting the range directly (as Google's
 * FreeBusy API would), independent of any events written through the adapter.
 */
export function createMockGoogleCalendarAdapter(opts: AdapterOptions = {}): MockCalendarAdapter {
  return makeAdapter(
    "google",
    { freeBusyQuery: true, eventList: false, writeEvents: true },
    (_tenantId, range, ctx) =>
      ctx.seed
        .filter((w) => overlaps(w.start, w.end, range))
        .map((w) => ({ start: w.start, end: w.end, source: "external" as const })),
    opts,
  );
}

// ---------------------------------------------------------------------------
// Microsoft mock — event-list capability (busy DERIVED from events)
// ---------------------------------------------------------------------------

/**
 * Microsoft-style mock: has no free/busy endpoint in this model; it returns
 * EVENTS and busy windows are DERIVED from them. `readBusy` reduces the events
 * written through the adapter (plus any seeded events) to busy windows. This
 * exercises a different capability through the identical `readBusy` signature.
 */
export function createMockMicrosoftCalendarAdapter(opts: AdapterOptions = {}): MockCalendarAdapter {
  return makeAdapter(
    "microsoft",
    { freeBusyQuery: false, eventList: true, writeEvents: true },
    (tenantId, range, ctx) => {
      const fromEvents: BusyWindow[] = [...ctx.events.values()]
        .filter((e) => e.tenantId === tenantId && overlaps(e.start, e.end, range))
        .map((e) => ({ start: e.start, end: e.end, source: "external" as const }));
      const fromSeed = ctx.seed
        .filter((w) => overlaps(w.start, w.end, range))
        .map((w) => ({ start: w.start, end: w.end, source: "external" as const }));
      return [...fromSeed, ...fromEvents];
    },
    opts,
  );
}
