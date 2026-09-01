/**
 * Tenant-scoped data access for the Business Portal.
 *
 * EVERY function requires a TenantContext and filters by ctx.tenantId. This
 * mirrors the future RLS-backed API exactly: in production the DATABASE is
 * the real security boundary (deny-by-default RLS, Security Invariant 4) —
 * the filtering here is a convenience layer that keeps the UI honest about
 * tenant scoping, never the enforcement mechanism itself.
 *
 * All money math is integer minor units; formatting goes through
 * contracts' formatMoney only.
 */

import {
  BOOKING_TRANSITIONS,
  BookingError,
  TenancyError,
  money,
} from "@lumin/contracts";
import type {
  AuditEvent,
  AvailabilityOverride,
  AvailabilityRule,
  BookingRecord,
  BookingState,
  BookingStateChange,
  IntegrationConnection,
  Money,
  SchedulingPolicy,
  Service,
  Tenant,
  TenantContext,
} from "@lumin/contracts";
import type { CheckoutSettings, CustomerRecord, PortalStore, TenantMember } from "./mockTenant";
import { DAY_MS, appStore } from "./mockTenant";

interface TenantScoped {
  tenantId: string;
}

function scoped<T extends TenantScoped>(ctx: TenantContext, rows: readonly T[]): T[] {
  return rows.filter((r) => r.tenantId === ctx.tenantId);
}

/* ------------------------------------------------------------------ */
/* Tenant & settings                                                   */
/* ------------------------------------------------------------------ */

export function getTenant(ctx: TenantContext, store: PortalStore = appStore): Tenant {
  const tenant = store.tenants.find((t) => t.id === ctx.tenantId);
  if (!tenant) throw new TenancyError("TENANT_MISMATCH", "No such tenant in context");
  return tenant;
}

export function updateTenantSettings(
  ctx: TenantContext,
  patch: Partial<Pick<Tenant, "name" | "timezone" | "currency">>,
  store: PortalStore = appStore,
): Tenant {
  const tenant = getTenant(ctx, store);
  Object.assign(tenant, patch);
  store.events.push({
    id: `evt-${store.getVersion()}-${store.events.length}`,
    tenantId: ctx.tenantId,
    name: "tenant.settings_updated",
    data: { fields: Object.keys(patch) },
    at: store.now,
  });
  store.notify();
  return tenant;
}

export function listMembers(ctx: TenantContext, store: PortalStore = appStore): TenantMember[] {
  return scoped(ctx, store.members);
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export function listServices(ctx: TenantContext, store: PortalStore = appStore): Service[] {
  return scoped(ctx, store.services);
}

export function getService(ctx: TenantContext, serviceId: string, store: PortalStore = appStore): Service | null {
  return scoped(ctx, store.services).find((s) => s.id === serviceId) ?? null;
}

export function setServiceActive(
  ctx: TenantContext,
  serviceId: string,
  active: boolean,
  store: PortalStore = appStore,
): void {
  const service = getService(ctx, serviceId, store);
  if (!service) return;
  service.active = active;
  store.notify();
}

/** Lowest meaningful "from" price for a service card. Integer minor units. */
export function servicePriceFrom(service: Service): Money {
  if (service.archetype === "rental" && service.rental) {
    return money(service.rental.pricePerPeriod * service.rental.minPeriods, service.currency);
  }
  if (service.archetype === "cart" && service.items.length > 0) {
    const min = service.items.reduce((m, it) => Math.min(m, it.unitPrice), Number.MAX_SAFE_INTEGER);
    return money(min, service.currency);
  }
  return money(service.basePrice, service.currency);
}

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

export interface BookingFilter {
  state?: BookingState | "all";
  search?: string;
}

export function listBookings(
  ctx: TenantContext,
  filter: BookingFilter = {},
  store: PortalStore = appStore,
): BookingRecord[] {
  let rows = scoped(ctx, store.bookings);
  if (filter.state && filter.state !== "all") {
    rows = rows.filter((b) => b.state === filter.state);
  }
  const q = filter.search?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (b) =>
        b.reference.toLowerCase().includes(q) ||
        b.customer.name.toLowerCase().includes(q) ||
        b.customer.email.toLowerCase().includes(q),
    );
  }
  return [...rows].sort((a, b) => b.slotStart.localeCompare(a.slotStart));
}

export function getBooking(ctx: TenantContext, bookingId: string, store: PortalStore = appStore): BookingRecord | null {
  return scoped(ctx, store.bookings).find((b) => b.id === bookingId) ?? null;
}

export function getBookingHistory(
  ctx: TenantContext,
  bookingId: string,
  store: PortalStore = appStore,
): BookingStateChange[] {
  // History is only served for bookings the context can see.
  if (!getBooking(ctx, bookingId, store)) return [];
  return store.history.get(bookingId) ?? [];
}

/** Legal next states for a booking, straight from the shared state machine. */
export function legalNextStates(state: BookingState): readonly BookingState[] {
  return BOOKING_TRANSITIONS[state];
}

export function transitionBooking(
  ctx: TenantContext,
  bookingId: string,
  to: BookingState,
  reason?: string,
  store: PortalStore = appStore,
): BookingRecord {
  const booking = getBooking(ctx, bookingId, store);
  if (!booking) throw new BookingError("BOOKING_NOT_FOUND");
  if (!BOOKING_TRANSITIONS[booking.state].includes(to)) {
    throw new BookingError("ILLEGAL_TRANSITION", `${booking.state} → ${to} is not allowed`);
  }
  const change: BookingStateChange = {
    bookingId,
    from: booking.state,
    to,
    at: store.now,
    ...(reason ? { reason } : {}),
  };
  booking.state = to;
  booking.updatedAt = store.now;
  const history = store.history.get(bookingId) ?? [];
  history.push(change);
  store.history.set(bookingId, history);
  store.events.push({
    id: `evt-${store.getVersion()}-${store.events.length}`,
    tenantId: ctx.tenantId,
    name: `booking.${to}` as AuditEvent["name"],
    data: { bookingId, reference: booking.reference, state: to },
    at: store.now,
  });
  store.notify();
  return booking;
}

/* ------------------------------------------------------------------ */
/* Dashboard aggregates                                                */
/* ------------------------------------------------------------------ */

export function getUpcomingBookings(
  ctx: TenantContext,
  limit = 5,
  store: PortalStore = appStore,
): BookingRecord[] {
  return scoped(ctx, store.bookings)
    .filter(
      (b) =>
        (b.state === "confirmed" || b.state === "pending_payment") &&
        Date.parse(b.slotStart) >= Date.parse(store.now),
    )
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
    .slice(0, limit);
}

export function countUpcomingBookings(ctx: TenantContext, store: PortalStore = appStore): number {
  return scoped(ctx, store.bookings).filter(
    (b) =>
      (b.state === "confirmed" || b.state === "pending_payment") &&
      Date.parse(b.slotStart) >= Date.parse(store.now),
  ).length;
}

/** UTC start of the store's current day. */
function startOfDayUTC(iso: string): number {
  const ms = Date.parse(iso);
  return ms - (ms % DAY_MS);
}

/**
 * Confirmed revenue for the 7-day window starting at the beginning (UTC)
 * of the store's current day: sum of pricing.total in integer minor units.
 */
export function getWeekConfirmedRevenue(ctx: TenantContext, store: PortalStore = appStore): Money {
  const from = startOfDayUTC(store.now);
  const to = from + 7 * DAY_MS;
  const tenant = getTenant(ctx, store);
  let amount = 0;
  for (const b of scoped(ctx, store.bookings)) {
    if (b.state !== "confirmed") continue;
    const start = Date.parse(b.slotStart);
    if (start >= from && start < to) amount += b.pricing.total.amount;
  }
  return money(amount, tenant.currency);
}

export function getBookingStateCounts(
  ctx: TenantContext,
  store: PortalStore = appStore,
): Record<BookingState, number> {
  const counts: Record<BookingState, number> = {
    draft: 0,
    pending_payment: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    refunded: 0,
    failed: 0,
  };
  for (const b of scoped(ctx, store.bookings)) counts[b.state] += 1;
  return counts;
}

export function listRecentEvents(ctx: TenantContext, limit = 8, store: PortalStore = appStore): AuditEvent[] {
  return store.events
    .filter((e) => e.tenantId === ctx.tenantId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export function listCustomers(ctx: TenantContext, store: PortalStore = appStore): CustomerRecord[] {
  return [...scoped(ctx, store.customers)].sort((a, b) => a.details.name.localeCompare(b.details.name));
}

export function getCustomer(ctx: TenantContext, customerId: string, store: PortalStore = appStore): CustomerRecord | null {
  return scoped(ctx, store.customers).find((c) => c.id === customerId) ?? null;
}

export function listCustomerBookings(
  ctx: TenantContext,
  customerId: string,
  store: PortalStore = appStore,
): BookingRecord[] {
  const customer = getCustomer(ctx, customerId, store);
  if (!customer) return [];
  return scoped(ctx, store.bookings)
    .filter((b) => b.customer.email === customer.details.email)
    .sort((a, b) => b.slotStart.localeCompare(a.slotStart));
}

/** Lifetime value: sum of totals for confirmed + completed bookings. Integer minor units. */
export function customerLifetimeValue(
  ctx: TenantContext,
  customerId: string,
  store: PortalStore = appStore,
): Money {
  const tenant = getTenant(ctx, store);
  let amount = 0;
  for (const b of listCustomerBookings(ctx, customerId, store)) {
    if (b.state === "confirmed" || b.state === "completed") amount += b.pricing.total.amount;
  }
  return money(amount, tenant.currency);
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

export function listAvailabilityRules(ctx: TenantContext, store: PortalStore = appStore): AvailabilityRule[] {
  return scoped(ctx, store.rules);
}

export function listAvailabilityOverrides(ctx: TenantContext, store: PortalStore = appStore): AvailabilityOverride[] {
  return [...scoped(ctx, store.overrides)].sort((a, b) => a.date.localeCompare(b.date));
}

export function getSchedulingPolicy(ctx: TenantContext, store: PortalStore = appStore): SchedulingPolicy {
  return store.policies.get(ctx.tenantId) ?? { leadTimeMinutes: 0, horizonDays: 60, slotIntervalMinutes: 30 };
}

/* ------------------------------------------------------------------ */
/* Integrations & checkout settings                                    */
/* ------------------------------------------------------------------ */

export function listIntegrations(ctx: TenantContext, store: PortalStore = appStore): IntegrationConnection[] {
  return scoped(ctx, store.integrations);
}

export function getCheckoutSettings(ctx: TenantContext, store: PortalStore = appStore): CheckoutSettings {
  const settings = store.checkoutSettings.find((s) => s.tenantId === ctx.tenantId);
  if (!settings) throw new TenancyError("TENANT_MISMATCH", "No checkout settings for tenant");
  return settings;
}

export function updateCheckoutSettings(
  ctx: TenantContext,
  patch: Partial<Omit<CheckoutSettings, "tenantId">>,
  store: PortalStore = appStore,
): CheckoutSettings {
  const settings = getCheckoutSettings(ctx, store);
  Object.assign(settings, patch);
  store.notify();
  return settings;
}
