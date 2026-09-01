import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { cartService } from "../config/demoTenant";
import { checkoutReducer, CheckoutProvider, createFreshState } from "../state/checkout";
import { Summary } from "./Summary";

describe("Summary", () => {
  it("shows the engine-computed totals for a known cart fixture", () => {
    // Fixture (hand-computed minor units):
    //   2 × Small item  @ 2500 = 5000
    //   1 × Large item  @ 7500 = 7500
    //   Curbside carry-out add-on = 1500
    //   subtotal = 14000  → $140.00
    //   tax @ 8.25% (825bp) = 1155 → $11.55
    //   total = 15155 → $151.55
    let state = createFreshState();
    state = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    state = checkoutReducer(state, {
      type: "SET_SELECTION",
      selection: {
        serviceId: cartService.id,
        itemQuantities: { "item-small": 2, "item-large": 1 },
        addonIds: ["addon-carry"],
        answers: {},
      },
    });
    state = { ...state, step: "summary" as const };

    render(
      <CheckoutProvider initialState={state}>
        <Summary />
      </CheckoutProvider>,
    );

    expect(screen.getByTestId("summary-subtotal")).toHaveTextContent("$140.00");
    expect(screen.getByTestId("summary-tax")).toHaveTextContent("$11.55");
    expect(screen.getByTestId("summary-total")).toHaveTextContent("$151.55");
  });
});
