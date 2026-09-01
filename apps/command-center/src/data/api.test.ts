import { describe, expect, it } from "vitest";
import {
  activeTenantCount,
  adapterHealthSnapshots,
  apiFailureRateByMonth,
  averageBookingValueMinorUnits,
  bookingsMoMGrowthPct,
  bookingStateTotals,
  cancellationRateByMonth,
  formatPct,
  growthPct,
  inactiveTenantCount,
  latestMonth,
  monthlyTotals,
  months,
  platformRevenueByMonth,
  platformRevenueForMonth,
  recentFailures,
  refundRateByMonth,
  revenueTotals,
  tenantBreakdown,
  tenantDirectory,
  totalPlatformRevenueForMonth,
  totalsForMonth,
} from "./api";
import { DATASET_SEED, mulberry32, PLATFORM_DATASET } from "./platformData";

describe("seeded dataset determinism", () => {
  it("mulberry32 produces the pinned sequence for the dataset seed", () => {
    const rng = mulberry32(DATASET_SEED);
    expect(rng()).toBeCloseTo(0.723907511215657, 12);
    expect(rng()).toBeCloseTo(0.941750347148627, 12);
    expect(rng()).toBeCloseTo(0.5006567344535142, 12);
  });

  it("generates the pinned first tenant and first monthly row (hand-derived from seed 20260901)", () => {
    const first = PLATFORM_DATASET.tenants[0];
    expect(first?.name).toBe("Aurora Cleaning Co");
    expect(first?.slug).toBe("aurora-cleaning-co");
    expect(first?.joinedAt).toBe("2025-09-26");
    const row = PLATFORM_DATASET.tenantMonthly[0];
    expect(row).toMatchObject({
      month: "2025-09",
      bookings: 54,
      cancellations: 4,
      refunds: 1,
      gmvMinorUnits: 1371211,
      currency: "USD",
    });
  });
});

describe("totals and growth selectors", () => {
  it("computes monthly totals that match an independent reduction of the raw rows", () => {
    for (const t of monthlyTotals()) {
      const rows = PLATFORM_DATASET.tenantMonthly.filter((r) => r.month === t.month);
      expect(t.bookings).toBe(rows.reduce((s, r) => s + r.bookings, 0));
      expect(t.cancellations).toBe(rows.reduce((s, r) => s + r.cancellations, 0));
      expect(t.refunds).toBe(rows.reduce((s, r) => s + r.refunds, 0));
      expect(t.gmvMinorUnits).toBe(rows.reduce((s, r) => s + r.gmvMinorUnits, 0));
    }
  });

  it("matches the hand-derived totals for the latest two months of seed 20260901", () => {
    expect(latestMonth()).toBe("2026-08");
    expect(totalsForMonth("2026-08")).toEqual({
      month: "2026-08",
      bookings: 874,
      cancellations: 54,
      refunds: 23,
      gmvMinorUnits: 25370116,
    });
    expect(totalsForMonth("2026-07")).toMatchObject({
      bookings: 926,
      gmvMinorUnits: 27110903,
    });
  });

  it("computes month-over-month growth from integer counts", () => {
    // Hand-derived: (874 - 926) / 926 * 100.
    expect(bookingsMoMGrowthPct()).toBeCloseTo(((874 - 926) / 926) * 100, 10);
    expect(formatPct(bookingsMoMGrowthPct())).toBe("-5.6%");
    expect(growthPct(110, 100)).toBeCloseTo(10, 10);
    expect(formatPct(growthPct(110, 100))).toBe("+10.0%");
    expect(growthPct(5, 0)).toBeNull();
    expect(formatPct(null)).toBe("—");
  });

  it("counts active and inactive tenants", () => {
    expect(activeTenantCount()).toBe(11);
    expect(inactiveTenantCount()).toBe(3);
    expect(activeTenantCount() + inactiveTenantCount()).toBe(PLATFORM_DATASET.tenants.length);
  });

  it("aggregates booking state totals consistently", () => {
    const s = bookingStateTotals();
    expect(s).toEqual({ total: 9077, completed: 8240, cancelled: 588, refunded: 249 });
    expect(s.completed + s.cancelled + s.refunded).toBe(s.total);
  });

  it("computes average booking value from integer GMV and bookings", () => {
    const totals = monthlyTotals();
    const gmv = totals.reduce((s, t) => s + t.gmvMinorUnits, 0);
    const bookings = totals.reduce((s, t) => s + t.bookings, 0);
    expect(averageBookingValueMinorUnits()).toBe(Math.round(gmv / bookings));
    expect(averageBookingValueMinorUnits()).toBe(26192);
  });
});

describe("GMV vs platform revenue separation (D-010)", () => {
  const collectNumbers = (value: unknown, out: number[] = []): number[] => {
    if (typeof value === "number") out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
    else if (value && typeof value === "object") {
      Object.values(value).forEach((v) => collectNumbers(v, out));
    }
    return out;
  };

  it("no selector output ever equals GMV + platform revenue, per month or in total", () => {
    const everySelectorOutput: unknown[] = [
      monthlyTotals(),
      bookingStateTotals(),
      revenueTotals(),
      tenantDirectory(),
      tenantBreakdown(),
      platformRevenueByMonth(),
      averageBookingValueMinorUnits(),
      cancellationRateByMonth(),
      refundRateByMonth(),
      apiFailureRateByMonth(),
      adapterHealthSnapshots(),
      recentFailures(),
      months().map((m) => totalsForMonth(m)),
      months().map((m) => platformRevenueForMonth(m)),
      months().map((m) => totalPlatformRevenueForMonth(m)),
      bookingsMoMGrowthPct(),
    ];
    const numbers = new Set(collectNumbers(everySelectorOutput));

    let totalGmv = 0;
    let totalRevenue = 0;
    for (const t of monthlyTotals()) {
      const rev = platformRevenueForMonth(t.month);
      const monthRevenue =
        rev.subscriptionRevenueMinorUnits + rev.transactionRevenueMinorUnits;
      totalGmv += t.gmvMinorUnits;
      totalRevenue += monthRevenue;
      const forbiddenMonthlySum = t.gmvMinorUnits + monthRevenue;
      expect(numbers.has(forbiddenMonthlySum)).toBe(false);
    }
    expect(numbers.has(totalGmv + totalRevenue)).toBe(false);
  });

  it("keeps GMV and platform revenue in separate structures with no shared field", () => {
    const gmvKeys = Object.keys(totalsForMonth(latestMonth()));
    const revKeys = Object.keys(platformRevenueForMonth(latestMonth()));
    expect(gmvKeys).toContain("gmvMinorUnits");
    expect(gmvKeys.join()).not.toMatch(/revenue/i);
    expect(revKeys.join()).not.toMatch(/gmv/i);
  });
});

describe("PII minimization (SI-9 / SI-11)", () => {
  it("contains no email-like strings anywhere in the mock dataset", () => {
    const json = JSON.stringify(PLATFORM_DATASET);
    expect(json).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("contains no customer identity fields", () => {
    const json = JSON.stringify(PLATFORM_DATASET);
    expect(json).not.toMatch(/"(email|phone|address|customerName|customer)"/i);
  });

  it("failure feed carries booking references only, in the LMN format", () => {
    const feed = recentFailures();
    expect(feed).toHaveLength(20);
    for (const f of feed) {
      if (f.bookingReference !== null) {
        expect(f.bookingReference).toMatch(/^LMN-[A-Z2-9]{6}$/);
      }
      expect(["booking_failed", "webhook_rejected", "function_error"]).toContain(f.kind);
    }
  });
});
