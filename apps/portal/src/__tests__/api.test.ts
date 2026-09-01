import { describe, expect, it } from "vitest";
import { BookingError } from "@lumin/contracts";
import {
  countUpcomingBookings,
  customerLifetimeValue,
  getBookingHistory,
  getWeekConfirmedRevenue,
  listAvailabilityRules,
  listBookings,
  listCustomers,
  listIntegrations,
  listMembers,
  listRecentEvents,
  listServices,
  transitionBooking,
} from "../data/api";
import { DEMO_TENANT_ID, OTHER_TENANT_ID, createStore, demoContext, otherContext } from "../data/mockTenant";

describe("api.ts tenant isolation (mirrors the RLS boundary)", () => {
  it("every list function returns only rows for ctx.tenantId", () => {
    const store = createStore();

    for (const ctx of [demoContext, otherContext]) {
      for (const rows of [
        listBookings(ctx, {}, store),
        listServices(ctx, store),
        listCustomers(ctx, store),
        listIntegrations(ctx, store),
        listAvailabilityRules(ctx, store),
        listMembers(ctx, store),
      ]) {
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.tenantId).toBe(ctx.tenantId);
      }
      for (const ev of listRecentEvents(ctx, 100, store)) {
        expect(ev.tenantId).toBe(ctx.tenantId);
      }
    }
  });

  it("a second tenant's data never leaks into the first tenant's queries", () => {
    const store = createStore();

    const otherBookingIds = new Set(listBookings(otherContext, {}, store).map((b) => b.id));
    const otherCustomerEmails = new Set(listCustomers(otherContext, store).map((c) => c.details.email));
    expect(otherBookingIds.size).toBeGreaterThan(0);
    expect(otherCustomerEmails.size).toBeGreaterThan(0);

    for (const b of listBookings(demoContext, {}, store)) {
      expect(otherBookingIds.has(b.id)).toBe(false);
      expect(otherCustomerEmails.has(b.customer.email)).toBe(false);
    }
    for (const c of listCustomers(demoContext, store)) {
      expect(otherCustomerEmails.has(c.details.email)).toBe(false);
    }

    // Search cannot cross tenants either: search for an other-tenant customer.
    const otherCustomer = listCustomers(otherContext, store)[0]!;
    expect(listBookings(demoContext, { search: otherCustomer.details.email }, store)).toHaveLength(0);

    // Aggregates are tenant-scoped too.
    expect(DEMO_TENANT_ID).not.toBe(OTHER_TENANT_ID);
    const demoRevenue = getWeekConfirmedRevenue(demoContext, store);
    expect(demoRevenue.currency).toBe("USD");
    const otherRevenue = getWeekConfirmedRevenue(otherContext, store);
    expect(otherRevenue.currency).toBe("EUR");
    expect(countUpcomingBookings(demoContext, store)).toBeGreaterThanOrEqual(0);
  });

  it("cross-tenant record access by id behaves as not-found", () => {
    const store = createStore();
    const otherBooking = listBookings(otherContext, {}, store)[0]!;

    // Reading another tenant's booking history through my context yields nothing.
    expect(getBookingHistory(demoContext, otherBooking.id, store)).toHaveLength(0);

    // Transitioning another tenant's booking is indistinguishable from missing.
    expect(() => transitionBooking(demoContext, otherBooking.id, "completed", undefined, store)).toThrowError(
      BookingError,
    );

    // Lifetime value for a foreign customer is zero minor units (invisible).
    const otherCustomer = listCustomers(otherContext, store)[0]!;
    expect(customerLifetimeValue(demoContext, otherCustomer.id, store).amount).toBe(0);
  });

  it("every integration connection begins not_connected (SI-12)", () => {
    const store = createStore();
    for (const ctx of [demoContext, otherContext]) {
      const connections = listIntegrations(ctx, store);
      expect(connections.length).toBeGreaterThan(0);
      for (const c of connections) {
        expect(c.status).toBe("not_connected");
        expect(c.lastCheckAt).toBeNull();
        expect(c.lastError).toBeNull();
      }
    }
  });

  it("transitionBooking enforces the shared state machine and appends history", () => {
    const store = createStore();
    const confirmed = listBookings(demoContext, { state: "confirmed" }, store)[0]!;
    const before = getBookingHistory(demoContext, confirmed.id, store).length;

    const updated = transitionBooking(demoContext, confirmed.id, "completed", "done", store);
    expect(updated.state).toBe("completed");
    const history = getBookingHistory(demoContext, confirmed.id, store);
    expect(history).toHaveLength(before + 1);
    expect(history[history.length - 1]).toMatchObject({ from: "confirmed", to: "completed", reason: "done" });

    // completed → confirmed is illegal.
    expect(() => transitionBooking(demoContext, confirmed.id, "confirmed", undefined, store)).toThrowError(
      /ILLEGAL_TRANSITION|not allowed/,
    );
  });
});
