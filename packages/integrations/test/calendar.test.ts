import { describe, expect, it } from "vitest";
import {
  createMockGoogleCalendarAdapter,
  createMockMicrosoftCalendarAdapter,
  mergeBusy,
  type BusyWindow,
  type RichCalendarAdapter,
  type TimeRange,
} from "../src/calendar";
import { TENANT_A, TENANT_B } from "./fixtures";

const DAY: TimeRange = { start: "2026-09-07T00:00:00.000Z", end: "2026-09-08T00:00:00.000Z" };

function event(start: string, end: string, bookingId = "bk1") {
  return {
    tenantId: TENANT_A,
    bookingId,
    title: "Booking",
    start,
    end,
  };
}

describe("mock calendar adapters: create / read / cancel", () => {
  it("createEvent then cancelEvent removes it (Google mock)", async () => {
    const cal = createMockGoogleCalendarAdapter();
    const { eventId } = await cal.createEvent(event("2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"));
    expect(cal.listEvents()).toHaveLength(1);
    await cal.cancelEvent(TENANT_A, eventId);
    expect(cal.listEvents()).toHaveLength(0);
    expect(cal.cancelledEventIds()).toEqual([eventId]);
  });

  it("updateEvent patches an existing event", async () => {
    const cal = createMockMicrosoftCalendarAdapter();
    const { eventId } = await cal.createEvent(event("2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"));
    await cal.updateEvent(TENANT_A, eventId, { title: "Rescheduled" });
    expect(cal.listEvents()[0]?.title).toBe("Rescheduled");
  });

  it("a tenant cannot cancel another tenant's event", async () => {
    const cal = createMockGoogleCalendarAdapter();
    const { eventId } = await cal.createEvent(event("2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"));
    await cal.cancelEvent(TENANT_B, eventId);
    expect(cal.listEvents()).toHaveLength(1); // untouched
  });
});

describe("different provider capabilities through ONE code path", () => {
  // A single consumer that only knows the RichCalendarAdapter interface.
  async function busyCount(adapter: RichCalendarAdapter): Promise<number> {
    const windows = await adapter.readBusy(TENANT_A, DAY);
    return windows.length;
  }

  it("Google answers a native free/busy query (seeded busy, ignores written events)", async () => {
    const seedBusy: BusyWindow[] = [
      { start: "2026-09-07T13:00:00.000Z", end: "2026-09-07T14:00:00.000Z", source: "external" },
    ];
    const google = createMockGoogleCalendarAdapter({ seedBusy });
    expect(google.capabilities.freeBusyQuery).toBe(true);
    expect(google.capabilities.eventList).toBe(false);

    // Writing an event does NOT change Google's free/busy answer (it comes from the query).
    await google.createEvent(event("2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"));
    expect(await busyCount(google)).toBe(1);
  });

  it("Microsoft derives busy windows from its EVENTS (no free/busy endpoint)", async () => {
    const microsoft = createMockMicrosoftCalendarAdapter();
    expect(microsoft.capabilities.eventList).toBe(true);
    expect(microsoft.capabilities.freeBusyQuery).toBe(false);

    // With no events there is no busy time...
    expect(await busyCount(microsoft)).toBe(0);
    // ...writing an event makes it appear in readBusy (derived from events).
    await microsoft.createEvent(event("2026-09-07T09:00:00.000Z", "2026-09-07T10:00:00.000Z"));
    expect(await busyCount(microsoft)).toBe(1);
  });

  it("readBusy honors the query range", async () => {
    const microsoft = createMockMicrosoftCalendarAdapter();
    await microsoft.createEvent(event("2026-09-10T09:00:00.000Z", "2026-09-10T10:00:00.000Z"));
    // Event is outside the single-day range → not busy.
    expect((await microsoft.readBusy(TENANT_A, DAY)).length).toBe(0);
  });
});

describe("mergeBusy: internal + external union, internal authoritative", () => {
  it("unions overlapping internal and external windows, tagging the span internal", () => {
    const internal: BusyWindow[] = [
      { start: "2026-09-07T09:00:00.000Z", end: "2026-09-07T10:00:00.000Z", source: "internal" },
    ];
    const external: BusyWindow[] = [
      { start: "2026-09-07T09:30:00.000Z", end: "2026-09-07T11:00:00.000Z", source: "external" },
    ];
    const merged = mergeBusy(internal, external);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.start).toBe("2026-09-07T09:00:00.000Z");
    expect(merged[0]?.end).toBe("2026-09-07T11:00:00.000Z");
    // Internal provenance wins where they overlap.
    expect(merged[0]?.source).toBe("internal");
  });

  it("keeps disjoint windows separate and sorted", () => {
    const internal: BusyWindow[] = [
      { start: "2026-09-07T15:00:00.000Z", end: "2026-09-07T16:00:00.000Z", source: "internal" },
    ];
    const external: BusyWindow[] = [
      { start: "2026-09-07T09:00:00.000Z", end: "2026-09-07T10:00:00.000Z", source: "external" },
    ];
    const merged = mergeBusy(internal, external);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.start).toBe("2026-09-07T09:00:00.000Z"); // sorted
    expect(merged[0]?.source).toBe("external");
    expect(merged[1]?.source).toBe("internal");
  });

  it("every internal hold's time is still covered after merge (internal authoritative)", () => {
    const internal: BusyWindow[] = [
      { start: "2026-09-07T09:00:00.000Z", end: "2026-09-07T09:30:00.000Z", source: "internal" },
    ];
    // An external window that fully CONTAINS the internal hold must not erase it —
    // the merged span still covers the internal interval and is tagged internal.
    const external: BusyWindow[] = [
      { start: "2026-09-07T08:00:00.000Z", end: "2026-09-07T12:00:00.000Z", source: "external" },
    ];
    const merged = mergeBusy(internal, external);
    expect(merged).toHaveLength(1);
    expect(Date.parse(merged[0]!.start)).toBeLessThanOrEqual(Date.parse("2026-09-07T09:00:00.000Z"));
    expect(Date.parse(merged[0]!.end)).toBeGreaterThanOrEqual(Date.parse("2026-09-07T09:30:00.000Z"));
    expect(merged[0]?.source).toBe("internal");
    // The input arrays were not mutated.
    expect(internal[0]?.source).toBe("internal");
  });
});

describe("adapter health / reconnect", () => {
  it("reports health and reconnects", async () => {
    const google = createMockGoogleCalendarAdapter();
    expect((await google.health()).healthy).toBe(true);
    const reconnected = await google.reconnect();
    expect(reconnected.status).toBe("connected");
    expect(reconnected.provider).toBe("google");
  });

  it("sync reports the count of external windows in range", async () => {
    const seedBusy: BusyWindow[] = [
      { start: "2026-09-07T13:00:00.000Z", end: "2026-09-07T14:00:00.000Z", source: "external" },
      { start: "2026-09-10T13:00:00.000Z", end: "2026-09-10T14:00:00.000Z", source: "external" },
    ];
    const google = createMockGoogleCalendarAdapter({ seedBusy });
    const result = await google.sync(TENANT_A, DAY);
    expect(result.externalWindows).toBe(1); // only the in-range window
    expect(result.provider).toBe("google");
  });
});
