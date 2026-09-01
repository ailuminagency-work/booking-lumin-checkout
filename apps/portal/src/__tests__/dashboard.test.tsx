import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { formatMoney, money } from "@lumin/contracts";
import { PortalProvider } from "../components/PortalProvider";
import { DashboardPage } from "../pages/Dashboard";
import { DAY_MS, DEMO_TENANT_ID, createStore, demoContext } from "../data/mockTenant";

afterEach(cleanup);

function renderDashboard(store = createStore()) {
  render(
    <PortalProvider ctx={demoContext} store={store}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </PortalProvider>,
  );
  return store;
}

describe("Dashboard revenue stat", () => {
  it("equals the hand-computed integer sum for the seeded data, formatted via formatMoney", () => {
    const store = createStore();

    // Hand-compute the expected sum straight from the seeded store:
    // confirmed bookings whose slotStart falls in the 7-day window starting
    // at the UTC start of the store's fixed "now" day. Integer minor units.
    const nowMs = Date.parse(store.now);
    const windowStart = nowMs - (nowMs % DAY_MS);
    const windowEnd = windowStart + 7 * DAY_MS;
    let expectedMinorUnits = 0;
    for (const b of store.bookings) {
      if (b.tenantId !== DEMO_TENANT_ID) continue;
      if (b.state !== "confirmed") continue;
      const start = Date.parse(b.slotStart);
      if (start >= windowStart && start < windowEnd) expectedMinorUnits += b.pricing.total.amount;
    }

    // Deterministic seed guarantees revenue in the window; guard the test's teeth.
    expect(expectedMinorUnits).toBeGreaterThan(0);
    expect(Number.isSafeInteger(expectedMinorUnits)).toBe(true);

    renderDashboard(store);

    // Assert the FORMATTING path too: the on-screen string must be exactly
    // what contracts' formatMoney produces for the integer sum.
    const expectedText = formatMoney(money(expectedMinorUnits, "USD"));
    expect(expectedText).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(screen.getByTestId("stat-week-revenue")).toHaveTextContent(expectedText);
  });

  it("shows the upcoming count and per-state counts matching the store", () => {
    const store = createStore();
    const nowMs = Date.parse(store.now);
    const demoBookings = store.bookings.filter((b) => b.tenantId === DEMO_TENANT_ID);
    const expectedUpcoming = demoBookings.filter(
      (b) => (b.state === "confirmed" || b.state === "pending_payment") && Date.parse(b.slotStart) >= nowMs,
    ).length;
    const expectedConfirmed = demoBookings.filter((b) => b.state === "confirmed").length;

    renderDashboard(store);

    expect(screen.getByTestId("stat-upcoming")).toHaveTextContent(String(expectedUpcoming));
    if (expectedConfirmed > 0) {
      expect(screen.getByTestId("count-confirmed")).toHaveTextContent(String(expectedConfirmed));
    }
  });
});
