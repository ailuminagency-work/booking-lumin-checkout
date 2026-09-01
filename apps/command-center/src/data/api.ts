import {
  MONTHS,
  PLATFORM_DATASET,
  type AdapterHealthSnapshot,
  type FailureEvent,
  type MonthKey,
  type PlatformRevenueMonth,
  type TenantInfo,
} from "./platformData";

/**
 * Typed selectors over the platform aggregate dataset.
 *
 * INVARIANT (D-010): GMV is merchant volume; platform revenue is Lumin's
 * income. No selector in this module ever returns the two added together.
 */

export interface MonthTotals {
  month: MonthKey;
  bookings: number;
  cancellations: number;
  refunds: number;
  gmvMinorUnits: number;
}

export interface RatePoint {
  month: MonthKey;
  ratePct: number;
}

export interface TenantDirectoryRow {
  tenant: TenantInfo;
  bookings30d: number;
  gmv30dMinorUnits: number;
  bookingsSeries: number[];
}

export interface TenantBreakdownRow {
  tenant: TenantInfo;
  bookings12mo: number;
  cancellations12mo: number;
  refunds12mo: number;
  cancellationRatePct: number | null;
  gmv12moMinorUnits: number;
}

export interface BookingStateTotals {
  total: number;
  completed: number;
  cancelled: number;
  refunded: number;
}

export interface RevenueTotals {
  subscriptionRevenueMinorUnits: number;
  transactionRevenueMinorUnits: number;
}

const D = PLATFORM_DATASET;

export function months(): readonly MonthKey[] {
  return D.months;
}

export function latestMonth(): MonthKey {
  const m = D.months[D.months.length - 1];
  if (!m) throw new Error("empty month range");
  return m;
}

export function totalsForMonth(month: MonthKey): MonthTotals {
  const rows = D.tenantMonthly.filter((r) => r.month === month);
  return {
    month,
    bookings: rows.reduce((s, r) => s + r.bookings, 0),
    cancellations: rows.reduce((s, r) => s + r.cancellations, 0),
    refunds: rows.reduce((s, r) => s + r.refunds, 0),
    gmvMinorUnits: rows.reduce((s, r) => s + r.gmvMinorUnits, 0),
  };
}

export function monthlyTotals(): MonthTotals[] {
  return D.months.map((m) => totalsForMonth(m));
}

/**
 * Month-over-month growth in percent, computed from integer counts.
 * Returns null when the previous value is zero (growth undefined).
 */
export function growthPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function momOf(select: (t: MonthTotals) => number): number | null {
  const series = monthlyTotals();
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  if (!cur || !prev) return null;
  return growthPct(select(cur), select(prev));
}

export function bookingsMoMGrowthPct(): number | null {
  return momOf((t) => t.bookings);
}

export function gmvMoMGrowthPct(): number | null {
  return momOf((t) => t.gmvMinorUnits);
}

/** Display helper: one decimal, explicit sign, em dash when undefined. */
export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function activeTenantCount(): number {
  return D.tenants.filter((t) => t.status === "active").length;
}

export function inactiveTenantCount(): number {
  return D.tenants.filter((t) => t.status === "inactive").length;
}

export function tenantDirectory(): TenantDirectoryRow[] {
  const last = latestMonth();
  return D.tenants.map((tenant) => {
    const rows = D.tenantMonthly.filter((r) => r.tenantId === tenant.id);
    const lastRow = rows.find((r) => r.month === last);
    return {
      tenant,
      bookings30d: lastRow?.bookings ?? 0,
      gmv30dMinorUnits: lastRow?.gmvMinorUnits ?? 0,
      bookingsSeries: D.months.map(
        (m) => rows.find((r) => r.month === m)?.bookings ?? 0,
      ),
    };
  });
}

/**
 * Aggregate booking-state totals across all tenants and months.
 * Derived from aggregate counts only — never from customer records.
 */
export function bookingStateTotals(): BookingStateTotals {
  const total = D.tenantMonthly.reduce((s, r) => s + r.bookings, 0);
  const cancelled = D.tenantMonthly.reduce((s, r) => s + r.cancellations, 0);
  const refunded = D.tenantMonthly.reduce((s, r) => s + r.refunds, 0);
  return { total, completed: total - cancelled - refunded, cancelled, refunded };
}

export function cancellationRateByMonth(): RatePoint[] {
  return monthlyTotals().map((t) => ({
    month: t.month,
    ratePct: t.bookings === 0 ? 0 : (t.cancellations / t.bookings) * 100,
  }));
}

export function refundRateByMonth(): RatePoint[] {
  return monthlyTotals().map((t) => ({
    month: t.month,
    ratePct: t.bookings === 0 ? 0 : (t.refunds / t.bookings) * 100,
  }));
}

export function tenantBreakdown(): TenantBreakdownRow[] {
  return D.tenants.map((tenant) => {
    const rows = D.tenantMonthly.filter((r) => r.tenantId === tenant.id);
    const bookings12mo = rows.reduce((s, r) => s + r.bookings, 0);
    const cancellations12mo = rows.reduce((s, r) => s + r.cancellations, 0);
    return {
      tenant,
      bookings12mo,
      cancellations12mo,
      refunds12mo: rows.reduce((s, r) => s + r.refunds, 0),
      cancellationRatePct: bookings12mo === 0 ? null : (cancellations12mo / bookings12mo) * 100,
      gmv12moMinorUnits: rows.reduce((s, r) => s + r.gmvMinorUnits, 0),
    };
  });
}

export function platformRevenueByMonth(): PlatformRevenueMonth[] {
  return [...D.platformRevenue];
}

export function platformRevenueForMonth(month: MonthKey): RevenueTotals {
  const row = D.platformRevenue.find((r) => r.month === month);
  return {
    subscriptionRevenueMinorUnits: row?.subscriptionRevenueMinorUnits ?? 0,
    transactionRevenueMinorUnits: row?.transactionRevenueMinorUnits ?? 0,
  };
}

export function revenueTotals(): RevenueTotals {
  return {
    subscriptionRevenueMinorUnits: D.platformRevenue.reduce(
      (s, r) => s + r.subscriptionRevenueMinorUnits,
      0,
    ),
    transactionRevenueMinorUnits: D.platformRevenue.reduce(
      (s, r) => s + r.transactionRevenueMinorUnits,
      0,
    ),
  };
}

/**
 * Total platform revenue (subscription + transaction) for a month.
 * Both components are Lumin revenue — GMV is never part of this figure.
 */
export function totalPlatformRevenueForMonth(month: MonthKey): number {
  const r = platformRevenueForMonth(month);
  return r.subscriptionRevenueMinorUnits + r.transactionRevenueMinorUnits;
}

/** Average booking value across the trailing 12 months (GMV / bookings). */
export function averageBookingValueMinorUnits(): number | null {
  const totals = monthlyTotals();
  const bookings = totals.reduce((s, t) => s + t.bookings, 0);
  const gmv = totals.reduce((s, t) => s + t.gmvMinorUnits, 0);
  return bookings === 0 ? null : Math.round(gmv / bookings);
}

export function apiFailureRateByMonth(): RatePoint[] {
  return D.apiMonthly.map((r) => ({
    month: r.month,
    ratePct: r.requests === 0 ? 0 : (r.errors / r.requests) * 100,
  }));
}

export function adapterHealthSnapshots(): AdapterHealthSnapshot[] {
  return [...D.adapterHealth];
}

export function recentFailures(): FailureEvent[] {
  return [...D.failureFeed];
}

const MONTH_NAMES: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sep",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
};

export function shortMonthLabel(month: string): string {
  const part = month.slice(5, 7);
  return MONTH_NAMES[part] ?? month;
}

export { MONTHS };
