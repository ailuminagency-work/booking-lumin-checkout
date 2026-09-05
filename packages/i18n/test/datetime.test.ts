import { describe, expect, it } from "vitest";
import { formatDateTime, formatDateOnly, formatTimeOnly, zonedParts } from "../src/datetime";

/**
 * One fixed UTC instant renders at the correct WALL CLOCK in each timezone.
 * The timezone is a required, explicit input — the host machine's zone is never
 * assumed. Locale is independent and affects only presentation.
 */
describe("formatDateTime — one instant, three zones", () => {
  const instant = "2025-03-09T07:30:00Z";

  it("America/Chicago (CDT, UTC-5 after spring-forward) → 01:30 local", () => {
    expect(formatDateTime(instant, "America/Chicago", "en-US")).toBe("Mar 9, 2025, 01:30 AM");
  });

  it("Europe/Amsterdam (CET, UTC+1) → 08:30 local, Dutch presentation", () => {
    expect(formatDateTime(instant, "Europe/Amsterdam", "nl-NL")).toBe("9 mrt 2025, 08:30");
  });

  it("Asia/Tokyo (JST, UTC+9) → 16:30 local", () => {
    expect(formatDateTime(instant, "Asia/Tokyo", "ja-JP")).toBe("2025年3月9日 16:30");
    expect(formatDateTime(instant, "Asia/Tokyo", "en-US")).toBe("Mar 9, 2025, 04:30 PM");
  });

  it("date-only and time-only honor the given zone", () => {
    expect(formatDateOnly(instant, "America/Chicago", "en-US")).toBe("Mar 9, 2025");
    expect(formatTimeOnly(instant, "America/Chicago", "en-US")).toBe("01:30 AM");
    // Same instant is already the next calendar hour band in Tokyo.
    expect(formatTimeOnly(instant, "Asia/Tokyo", "en-US")).toBe("04:30 PM");
  });
});

describe("zonedParts — wall-clock components per zone", () => {
  const instant = "2025-03-09T07:30:00Z";

  it("decomposes the instant correctly in each zone", () => {
    expect(zonedParts(instant, "America/Chicago")).toEqual({ year: 2025, month: 3, day: 9, hour: 1, minute: 30 });
    expect(zonedParts(instant, "Europe/Amsterdam")).toEqual({ year: 2025, month: 3, day: 9, hour: 8, minute: 30 });
    expect(zonedParts(instant, "Asia/Tokyo")).toEqual({ year: 2025, month: 3, day: 9, hour: 16, minute: 30 });
  });
});

/**
 * DST boundaries are handled by Intl, not by hand. At the US spring-forward on
 * 2025-03-09, local time jumps 02:00 → 03:00, so 01:59 and 03:00 local are one
 * UTC minute apart with NO 02:xx in between.
 */
describe("zonedParts — DST boundary correctness", () => {
  it("US spring-forward: 07:59Z is 01:59 CST, 08:00Z is 03:00 CDT (02:xx skipped)", () => {
    expect(zonedParts("2025-03-09T07:59:00Z", "America/Chicago")).toEqual({
      year: 2025,
      month: 3,
      day: 9,
      hour: 1,
      minute: 59,
    });
    expect(zonedParts("2025-03-09T08:00:00Z", "America/Chicago")).toEqual({
      year: 2025,
      month: 3,
      day: 9,
      hour: 3,
      minute: 0,
    });
  });

  it("EU spring-forward: 00:59Z is 01:59 CET, 01:00Z is 03:00 CEST (02:xx skipped)", () => {
    expect(zonedParts("2025-03-30T00:59:00Z", "Europe/Amsterdam")).toEqual({
      year: 2025,
      month: 3,
      day: 30,
      hour: 1,
      minute: 59,
    });
    expect(zonedParts("2025-03-30T01:00:00Z", "Europe/Amsterdam")).toEqual({
      year: 2025,
      month: 3,
      day: 30,
      hour: 3,
      minute: 0,
    });
  });

  it("the same UTC instant shows a DST-shifted wall clock across the boundary date", () => {
    // Standard time (winter): Chicago is UTC-6.
    expect(zonedParts("2025-01-15T12:00:00Z", "America/Chicago").hour).toBe(6);
    // Daylight time (summer): Chicago is UTC-5.
    expect(zonedParts("2025-07-15T12:00:00Z", "America/Chicago").hour).toBe(7);
  });
});

describe("datetime — input validation", () => {
  it("rejects an invalid UTC instant", () => {
    expect(() => formatDateTime("not-a-date", "America/Chicago", "en-US")).toThrow(/invalid UTC ISO/);
    expect(() => zonedParts("not-a-date", "Asia/Tokyo")).toThrow(/invalid UTC ISO/);
  });
});
