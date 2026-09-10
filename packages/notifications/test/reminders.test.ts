import { describe, expect, it } from "vitest";
import { dueReminders } from "../src/index";
import { baseConfig, bookingContext } from "./fixtures";

// slotStart = 2026-03-20T15:00:00Z. Rules: r-24h (email, 1440m) fires at
// 2026-03-19T15:00:00Z ; r-1h (sms, 60m) fires at 2026-03-20T14:00:00Z.

describe("dueReminders: window boundaries", () => {
  it("no reminders due long before either fire time", () => {
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-10T12:00:00Z", 60);
    expect(out).toEqual([]);
  });

  it("the 24h reminder is due exactly at its fire time (at/after now, inclusive)", () => {
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-19T15:00:00Z", 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.reminderId).toBe("r-24h");
    expect(out[0]!.channel).toBe("email");
    expect(out[0]!.trigger).toBe("reminder");
    expect(out[0]!.providerTemplate).toBe("booking_reminder");
  });

  it("a reminder whose fire time is just before now is NOT due", () => {
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-19T15:01:00Z", 5);
    expect(out.map((n) => n.reminderId)).not.toContain("r-24h");
  });

  it("a reminder just past the horizon end is NOT due", () => {
    // now=..14:00, horizon 59m -> ends 14:59, r-24h fires next day: not in window
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-20T13:30:00Z", 25);
    // r-1h fires at 14:00 which is within [13:30, 13:55]? 14:00 > 13:55 -> not due
    expect(out).toEqual([]);
  });

  it("the 1h reminder is due when the horizon reaches its fire time", () => {
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-20T13:30:00Z", 30);
    expect(out).toHaveLength(1);
    expect(out[0]!.reminderId).toBe("r-1h");
    expect(out[0]!.channel).toBe("sms");
  });

  it("a wide horizon catches both reminders", () => {
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-19T00:00:00Z", 60 * 48);
    expect(out.map((n) => n.reminderId).sort()).toEqual(["r-1h", "r-24h"]);
  });
});

describe("dueReminders: only confirmed bookings", () => {
  it("a pending booking gets no reminders", () => {
    const out = dueReminders(bookingContext({ state: "pending_payment" }), baseConfig(), "2026-03-19T15:00:00Z", 60);
    expect(out).toEqual([]);
  });

  it("a cancelled booking gets no reminders", () => {
    const out = dueReminders(bookingContext({ state: "cancelled" }), baseConfig(), "2026-03-19T15:00:00Z", 60);
    expect(out).toEqual([]);
  });
});

describe("dueReminders: DST-agnostic instant math", () => {
  it("fire time is offset on the ISO instant regardless of a DST transition", () => {
    // US DST began 2026-03-08. A slot after the transition still fires exactly
    // offsetMinutes earlier on the INSTANT timeline (no local-time drift).
    const ctx = bookingContext({ slotStart: "2026-03-20T15:00:00Z", slotEnd: "2026-03-20T16:00:00Z" });
    const atFire = dueReminders(ctx, baseConfig(), "2026-03-19T15:00:00Z", 0);
    expect(atFire.map((n) => n.reminderId)).toEqual(["r-24h"]);
    const oneMinEarly = dueReminders(ctx, baseConfig(), "2026-03-19T14:59:00Z", 0);
    expect(oneMinEarly).toEqual([]); // fire time is 1 min past horizon end (=now)
  });

  it("renders the reminder body with booking vars", () => {
    const out = dueReminders(bookingContext(), baseConfig(), "2026-03-19T15:00:00Z", 1);
    expect(out[0]!.body).toContain("Dana Rivera");
    expect(out[0]!.dedupeKey).toContain("r-24h");
  });
});
