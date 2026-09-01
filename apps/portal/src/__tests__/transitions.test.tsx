import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BOOKING_TRANSITIONS, BookingState } from "@lumin/contracts";
import { BookingDrawer } from "../components/BookingDrawer";
import { PortalProvider } from "../components/PortalProvider";
import { getBookingHistory, listBookings } from "../data/api";
import { createStore, demoContext } from "../data/mockTenant";

afterEach(cleanup);

const ALL_STATES = Object.keys(BOOKING_TRANSITIONS) as BookingState[];

function renderDrawerForState(state: BookingState) {
  const store = createStore();
  // Force a known state on a booking the demo tenant owns.
  const booking = listBookings(demoContext, {}, store)[0]!;
  booking.state = state;
  const utils = render(
    <PortalProvider ctx={demoContext} store={store}>
      <BookingDrawer bookingId={booking.id} onClose={() => {}} />
    </PortalProvider>,
  );
  return { store, booking, ...utils };
}

describe("BookingDrawer transition buttons", () => {
  it.each(ALL_STATES)("renders exactly the legal transitions for state %s", (state) => {
    const { container } = renderDrawerForState(state);
    const rendered = Array.from(container.querySelectorAll("[data-transition-to]")).map((el) =>
      el.getAttribute("data-transition-to"),
    );
    expect(new Set(rendered)).toEqual(new Set(BOOKING_TRANSITIONS[state]));
    expect(rendered).toHaveLength(BOOKING_TRANSITIONS[state].length);

    if (BOOKING_TRANSITIONS[state].length === 0) {
      expect(screen.getByText(/terminal state/i)).toBeInTheDocument();
    }
  });

  it("never renders a button for an illegal transition target", () => {
    const { container } = renderDrawerForState("confirmed");
    const targets = Array.from(container.querySelectorAll("[data-transition-to]")).map((el) =>
      el.getAttribute("data-transition-to"),
    );
    // confirmed → completed | cancelled | refunded; never draft/pending_payment/failed.
    expect(targets).not.toContain("draft");
    expect(targets).not.toContain("pending_payment");
    expect(targets).not.toContain("failed");
  });

  it("clicking a transition updates the store, appends history, and re-renders", () => {
    const { container, store, booking } = renderDrawerForState("confirmed");
    const historyBefore = getBookingHistory(demoContext, booking.id, store).length;

    fireEvent.click(screen.getByRole("button", { name: /mark completed/i }));

    expect(booking.state).toBe("completed");
    const history = getBookingHistory(demoContext, booking.id, store);
    expect(history).toHaveLength(historyBefore + 1);
    expect(history[history.length - 1]).toMatchObject({ from: "confirmed", to: "completed" });

    // The drawer now shows completed's legal transitions only (refunded).
    const targets = Array.from(container.querySelectorAll("[data-transition-to]")).map((el) =>
      el.getAttribute("data-transition-to"),
    );
    expect(targets).toEqual(["refunded"]);
  });
});
