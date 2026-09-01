import { ERROR_CODES, type ErrorCode, type IntegrationKind } from "@lumin/contracts";

/**
 * Deterministic mock aggregates for the Lumin Command Center.
 *
 * PLATFORM RULES (docs/ARCHITECTURE.md, docs/SECURITY_INVARIANTS.md SI-9, D-010):
 *  - Aggregates only. No customer PII ever appears here: no emails, phones,
 *    addresses, or customer names. Failures reference bookings by their
 *    human-facing reference code only.
 *  - GMV (merchant volume) and platform revenue are SEPARATE metrics
 *    end-to-end. They are never summed or conflated anywhere.
 *  - All money is integer minor units (MoneyContract v1), USD.
 */

/** mulberry32 — tiny seeded PRNG, deterministic across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DATASET_SEED = 20260901;

/** Twelve trailing months, oldest first. */
export const MONTHS = [
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
] as const;
export type MonthKey = (typeof MONTHS)[number];

export type TenantStatus = "active" | "inactive";
export type AdapterStatus = "ok" | "degraded" | "down";
export type FailureKind = "booking_failed" | "webhook_rejected" | "function_error";
export type Severity = "high" | "medium" | "low";

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  /** ISO date (day precision) the business joined the platform. */
  joinedAt: string;
  currency: "USD";
}

export interface TenantMonthStat {
  tenantId: string;
  month: MonthKey;
  bookings: number;
  cancellations: number;
  refunds: number;
  /** Merchant volume processed for this tenant this month. NOT Lumin revenue. */
  gmvMinorUnits: number;
  currency: "USD";
}

/** Lumin's own revenue. Kept entirely separate from tenant GMV. */
export interface PlatformRevenueMonth {
  month: MonthKey;
  subscriptionRevenueMinorUnits: number;
  transactionRevenueMinorUnits: number;
  currency: "USD";
}

export interface AdapterHealthSnapshot {
  kind: IntegrationKind;
  provider: string;
  status: AdapterStatus;
  errorCount24h: number;
  p95LatencyMs: number;
  checkedAt: string;
}

export interface FailureEvent {
  id: string;
  timestamp: string;
  tenantName: string;
  kind: FailureKind;
  code: ErrorCode;
  /** Human-facing booking reference (e.g. LMN-4K7Q2M) — never customer identity. */
  bookingReference: string | null;
  severity: Severity;
}

export interface ApiMonthStat {
  month: MonthKey;
  requests: number;
  errors: number;
}

export interface PlatformDataset {
  months: readonly MonthKey[];
  tenants: TenantInfo[];
  tenantMonthly: TenantMonthStat[];
  platformRevenue: PlatformRevenueMonth[];
  adapterHealth: AdapterHealthSnapshot[];
  failureFeed: FailureEvent[];
  apiMonthly: ApiMonthStat[];
}

interface TenantSpec {
  name: string;
  /** Month index (into MONTHS) the tenant joined. */
  join: number;
  /** Month index activity stopped, or null while still active. */
  churn: number | null;
}

/** Fourteen fictitious businesses. No real companies, no legacy clients. */
const TENANT_SPECS: TenantSpec[] = [
  { name: "Aurora Cleaning Co", join: 0, churn: null },
  { name: "Northlake Detailing", join: 0, churn: null },
  { name: "Cedar & Pine Hauling Co", join: 0, churn: null },
  { name: "Bluebird Pet Grooming", join: 1, churn: null },
  { name: "Harborline Boat Care", join: 0, churn: 9 },
  { name: "Summit Lawn Services", join: 2, churn: null },
  { name: "Willow Massage Studio", join: 2, churn: null },
  { name: "Ironhorse Bike Repair", join: 1, churn: 6 },
  { name: "Coastal Window Washing", join: 3, churn: null },
  { name: "Maple Grove Photography", join: 4, churn: null },
  { name: "Redstone Pressure Washing", join: 4, churn: null },
  { name: "Lantern Yoga Collective", join: 5, churn: null },
  { name: "Foxglove Florals", join: 3, churn: 8 },
  { name: "Granite Peak Movers", join: 6, churn: null },
];

const SUBSCRIPTION_PLANS_MINOR_UNITS = [4900, 9900, 19900] as const;
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pseudoUuid(rng: () => number): string {
  const hex = () => Math.floor(rng() * 16).toString(16);
  const run = (n: number) => Array.from({ length: n }, hex).join("");
  // RFC-4122 v4 shaped, deterministically generated.
  return `${run(8)}-${run(4)}-4${run(3)}-a${run(3)}-${run(12)}`;
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

function bookingReference(rng: () => number): string {
  let out = "LMN-";
  for (let i = 0; i < 6; i++) out += pick(rng, REFERENCE_ALPHABET.split(""));
  return out;
}

const code = (c: ErrorCode): ErrorCode => {
  if (!ERROR_CODES.includes(c)) throw new Error(`unknown error code ${c}`);
  return c;
};

const FAILURE_TEMPLATES: ReadonlyArray<{
  kind: FailureKind;
  codes: readonly ErrorCode[];
  hasReference: boolean;
  severity: Severity;
}> = [
  {
    kind: "booking_failed",
    codes: [code("PAYMENT_FAILED"), code("PAYMENT_AMOUNT_MISMATCH"), code("DUPLICATE_BOOKING")],
    hasReference: true,
    severity: "high",
  },
  {
    kind: "booking_failed",
    codes: [code("SLOT_UNAVAILABLE"), code("AVAILABILITY_UNVERIFIABLE"), code("LEAD_TIME_VIOLATION")],
    hasReference: true,
    severity: "medium",
  },
  {
    kind: "webhook_rejected",
    codes: [code("WEBHOOK_UNVERIFIED")],
    hasReference: false,
    severity: "high",
  },
  {
    kind: "function_error",
    codes: [code("PROVIDER_UNAVAILABLE"), code("INTEGRATION_NOT_CONNECTED")],
    hasReference: false,
    severity: "medium",
  },
  {
    kind: "function_error",
    codes: [code("ILLEGAL_TRANSITION"), code("INVALID_REQUEST")],
    hasReference: true,
    severity: "low",
  },
];

function buildDataset(seed: number): PlatformDataset {
  const rng = mulberry32(seed);

  interface TenantGen extends TenantInfo {
    join: number;
    churn: number | null;
    base: number;
    growth: number;
    avgTicketMinorUnits: number;
    planMinorUnits: number;
  }

  const tenants: TenantGen[] = TENANT_SPECS.map((spec) => {
    const id = pseudoUuid(rng);
    const joinMonth = MONTHS[spec.join];
    if (!joinMonth) throw new Error("join month out of range");
    const joinDay = String(1 + Math.floor(rng() * 27)).padStart(2, "0");
    return {
      id,
      name: spec.name,
      slug: slugify(spec.name),
      status: spec.churn === null ? "active" : "inactive",
      joinedAt: `${joinMonth}-${joinDay}`,
      currency: "USD",
      join: spec.join,
      churn: spec.churn,
      base: 18 + Math.floor(rng() * 102),
      growth: -0.02 + rng() * 0.12,
      avgTicketMinorUnits: 8000 + Math.floor(rng() * 37000),
      planMinorUnits: pick(rng, SUBSCRIPTION_PLANS_MINOR_UNITS),
    };
  });

  const tenantMonthly: TenantMonthStat[] = [];
  for (const t of tenants) {
    for (const [m, month] of MONTHS.entries()) {
      const live = m >= t.join && (t.churn === null || m < t.churn);
      if (!live) {
        tenantMonthly.push({
          tenantId: t.id,
          month,
          bookings: 0,
          cancellations: 0,
          refunds: 0,
          gmvMinorUnits: 0,
          currency: "USD",
        });
        // Keep the PRNG stream aligned regardless of liveness.
        rng();
        rng();
        rng();
        rng();
        continue;
      }
      const trend = 1 + t.growth * (m - t.join);
      const bookings = Math.max(1, Math.round(t.base * trend * (0.85 + rng() * 0.3)));
      let cancellations = Math.round(bookings * (0.03 + rng() * 0.07));
      let refunds = Math.round(bookings * (0.01 + rng() * 0.04));
      if (cancellations + refunds > bookings) {
        cancellations = Math.floor(bookings / 2);
        refunds = Math.max(0, bookings - cancellations - 1);
      }
      const gmvMinorUnits = Math.round(bookings * t.avgTicketMinorUnits * (0.9 + rng() * 0.2));
      tenantMonthly.push({
        tenantId: t.id,
        month,
        bookings,
        cancellations,
        refunds,
        gmvMinorUnits,
        currency: "USD",
      });
    }
  }

  // Platform revenue — Lumin's own income, generated and stored separately.
  const platformRevenue: PlatformRevenueMonth[] = MONTHS.map((month, m) => {
    const liveTenants = tenants.filter((t) => m >= t.join && (t.churn === null || m < t.churn));
    const subscriptionRevenueMinorUnits = liveTenants.reduce((sum, t) => sum + t.planMinorUnits, 0);
    const monthRows = tenantMonthly.filter((r) => r.month === month);
    const monthBookings = monthRows.reduce((sum, r) => sum + r.bookings, 0);
    const monthGmv = monthRows.reduce((sum, r) => sum + r.gmvMinorUnits, 0);
    // Take-rate on processed volume plus a fixed per-booking fee.
    const transactionRevenueMinorUnits = Math.round(monthGmv * 0.018) + monthBookings * 25;
    return { month, subscriptionRevenueMinorUnits, transactionRevenueMinorUnits, currency: "USD" };
  });

  const apiMonthly: ApiMonthStat[] = MONTHS.map((month) => {
    const monthBookings = tenantMonthly
      .filter((r) => r.month === month)
      .reduce((sum, r) => sum + r.bookings, 0);
    const requests = monthBookings * 47 + Math.floor(rng() * 500);
    const errors = Math.round(requests * (0.002 + rng() * 0.01));
    return { month, requests, errors };
  });

  const adapterHealth: AdapterHealthSnapshot[] = [
    {
      kind: "payment",
      provider: "mock-pay",
      status: "ok",
      errorCount24h: Math.floor(rng() * 3),
      p95LatencyMs: 240 + Math.floor(rng() * 180),
      checkedAt: "2026-09-01T07:05:00.000Z",
    },
    {
      kind: "calendar",
      provider: "mock-calendar",
      status: "degraded",
      errorCount24h: 12 + Math.floor(rng() * 28),
      p95LatencyMs: 900 + Math.floor(rng() * 500),
      checkedAt: "2026-09-01T07:05:00.000Z",
    },
    {
      kind: "notification",
      provider: "mock-notify",
      status: "ok",
      errorCount24h: Math.floor(rng() * 5),
      p95LatencyMs: 310 + Math.floor(rng() * 220),
      checkedAt: "2026-09-01T07:05:00.000Z",
    },
    {
      kind: "webhook",
      provider: "mock-webhook-out",
      status: "down",
      errorCount24h: 60 + Math.floor(rng() * 80),
      p95LatencyMs: 2400 + Math.floor(rng() * 2200),
      checkedAt: "2026-09-01T07:05:00.000Z",
    },
  ];

  const activeTenants = tenants.filter((t) => t.status === "active");
  const failureFeed: FailureEvent[] = [];
  let minutesBack = 12 + Math.floor(rng() * 50);
  for (let i = 0; i < 20; i++) {
    const template = pick(rng, FAILURE_TEMPLATES);
    const tenant = pick(rng, activeTenants);
    const at = new Date(Date.UTC(2026, 7, 31, 23, 59, 0) - minutesBack * 60_000);
    minutesBack += 45 + Math.floor(rng() * 700);
    failureFeed.push({
      id: `evt-${pseudoUuid(rng).slice(0, 8)}`,
      timestamp: at.toISOString(),
      tenantName: tenant.name,
      kind: template.kind,
      code: pick(rng, template.codes),
      bookingReference: template.hasReference ? bookingReference(rng) : null,
      severity: template.severity,
    });
  }

  return {
    months: MONTHS,
    tenants: tenants.map(({ id, name, slug, status, joinedAt, currency }) => ({
      id,
      name,
      slug,
      status,
      joinedAt,
      currency,
    })),
    tenantMonthly,
    platformRevenue,
    adapterHealth,
    failureFeed,
    apiMonthly,
  };
}

export const PLATFORM_DATASET: PlatformDataset = buildDataset(DATASET_SEED);
