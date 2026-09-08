import { z } from "zod";
import { TenantId } from "./tenant";

/**
 * AvailabilityContract v1
 *
 * Availability is authoritative and FAILS CLOSED: if the engine cannot prove
 * a slot is free (missing rules, unresolvable resources, clock skew, storage
 * error), the slot is unavailable. No financial commitment may occur against
 * unverified availability (Security Invariant 7).
 *
 * All rule times are minutes-from-midnight in the TENANT's timezone; slots
 * exchanged over APIs are UTC ISO instants.
 */

export const Weekday = z.number().int().min(0).max(6); // 0 = Sunday
export type Weekday = z.infer<typeof Weekday>;

export const AvailabilityRule = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  /** null = applies to all services of the tenant. */
  serviceId: z.string().uuid().nullable(),
  weekday: Weekday,
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  /** Concurrent bookings this window supports (crew count, bays, rooms…). */
  capacity: z.number().int().min(1).default(1),
  /**
   * OPTIONAL seasonal effective-date window (tenant-local calendar dates,
   * YYYY-MM-DD, inclusive on both ends). A rule is only effective on dates
   * within [effectiveFrom, effectiveTo]. Omitting either bound leaves that side
   * open; omitting both makes the rule always effective (today's behavior).
   */
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type AvailabilityRule = z.infer<typeof AvailabilityRule>;

export const AvailabilityOverride = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  serviceId: z.string().uuid().nullable(),
  /** Calendar date in tenant timezone, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["closed", "open"]),
  /** For kind=open: replacement window for that date. */
  startMinute: z.number().int().min(0).max(1439).optional(),
  endMinute: z.number().int().min(1).max(1440).optional(),
  capacity: z.number().int().min(1).optional(),
});
export type AvailabilityOverride = z.infer<typeof AvailabilityOverride>;

/**
 * AvailabilityBlackout — a first-class, multi-day and/or recurring closure.
 *
 * Blackouts are AUTHORITATIVE and FAIL CLOSED: any date a blackout covers has
 * its slots removed (full-day blackout) or the blacked-out minute window
 * clipped out of every window (partial-day blackout). Blackouts compose with
 * weekly rules AND overrides — even an `open` override loses to a blackout on
 * the same date, because availability must fail closed (the safer, closed
 * outcome wins).
 *
 * Scope: `serviceId === null` blacks out the whole tenant; a concrete
 * `serviceId` blacks out only that service.
 *
 * Recurrence:
 *   - "once"   → [from, to] are absolute inclusive calendar dates (YYYY-MM-DD);
 *                from === to is a single closed date, from < to a closed range.
 *   - "annual" → only the month+day of `from`/`to` matter and the closure
 *                repeats every year. A range may wrap the year end (e.g.
 *                from 12-24 … to 01-02) — handled by the engine.
 */
export const AvailabilityBlackout = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  /** null = applies to all services of the tenant. */
  serviceId: z.string().uuid().nullable().default(null),
  /** "once" = absolute dates; "annual" = same month+day every year. */
  recurrence: z.enum(["once", "annual"]).default("once"),
  /** Inclusive start of the closed range, tenant-local YYYY-MM-DD. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Inclusive end of the closed range, tenant-local YYYY-MM-DD. */
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * OPTIONAL partial-day window (minutes from tenant-local midnight). When both
   * are present, only [startMinute, endMinute) of each covered date is closed;
   * omitting them makes the blackout a full-day closure (the required case).
   */
  startMinute: z.number().int().min(0).max(1439).optional(),
  endMinute: z.number().int().min(1).max(1440).optional(),
  /** Optional human-readable reason (e.g. "Winter holiday"). */
  reason: z.string().optional(),
});
export type AvailabilityBlackout = z.infer<typeof AvailabilityBlackout>;

export const SchedulingPolicy = z.object({
  /** Minimum notice before a slot may start. */
  leadTimeMinutes: z.number().int().min(0).default(0),
  /** How far ahead booking is allowed. */
  horizonDays: z.number().int().min(1).default(60),
  /** Slot grid granularity. */
  slotIntervalMinutes: z.number().int().min(5).default(30),
});
export type SchedulingPolicy = z.infer<typeof SchedulingPolicy>;

export const Slot = z.object({
  /** UTC ISO instant of slot start. */
  start: z.string().datetime(),
  /** UTC ISO instant of slot end. */
  end: z.string().datetime(),
  remainingCapacity: z.number().int().min(1),
});
export type Slot = z.infer<typeof Slot>;

/** An existing commitment that consumes capacity. */
export const CapacityHold = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});
export type CapacityHold = z.infer<typeof CapacityHold>;

export interface AvailabilityQuery {
  tenantTimezone: string;
  serviceId: string;
  durationMinutes: number;
  policy: SchedulingPolicy;
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  /**
   * OPTIONAL ranged/recurring closures. Treated as `[]` when omitted, so
   * existing callers are unchanged. Authoritative and fail-closed.
   */
  blackouts?: AvailabilityBlackout[];
  existing: CapacityHold[];
  /** UTC ISO instant "now" — injected, never read from a wall clock inside the engine. */
  now: string;
  /** Inclusive UTC ISO range to search. */
  from: string;
  to: string;
}

export interface AvailabilityEngine {
  /** Returns available slots; empty array whenever availability cannot be proven. */
  getSlots(query: AvailabilityQuery): Slot[];
  /** True only if the exact [start,end) window is provably available now. */
  isSlotAvailable(query: AvailabilityQuery, start: string): boolean;
}
