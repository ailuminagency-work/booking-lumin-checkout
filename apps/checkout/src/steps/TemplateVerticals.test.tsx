import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Service } from "@lumin/contracts";
import { carDetailingService, tentRentalService } from "../config/demoTenant";
import { checkoutReducer, CheckoutProvider, createFreshState } from "../state/checkout";
import { Configurator } from "./Configurator";

/**
 * templates wiring: two distinct verticals are materialized from
 * @lumin/templates archetypes and rendered by the SAME Configurator from
 * template data alone — no per-vertical component code.
 */
function renderConfigFor(service: Service) {
  let state = createFreshState();
  state = checkoutReducer(state, { type: "SELECT_SERVICE", service });
  render(
    <CheckoutProvider initialState={state}>
      <Configurator />
    </CheckoutProvider>,
  );
}

describe("template-driven Configurator (two verticals)", () => {
  it("renders the car-detailing (configurable) vertical, with the workflow hiding vehicle first", () => {
    renderConfigFor(carDetailingService);
    expect(screen.getByText("Detail package")).toBeInTheDocument();
    expect(screen.getByLabelText(/Basic wash & vac/)).toBeInTheDocument();
    // The workflow keeps the vehicle question hidden until a package is chosen.
    expect(screen.queryByText("Vehicle type")).not.toBeInTheDocument();
  });

  it("renders the tent/event (cart) vertical from template item + add-on data", () => {
    renderConfigFor(tentRentalService);
    expect(screen.getByText(/10x10 tent/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery & setup/)).toBeInTheDocument();
    // This vertical also opts into the mock photo upload (media wiring).
    expect(screen.getByRole("button", { name: /Attach a photo/i })).toBeInTheDocument();
  });
});
