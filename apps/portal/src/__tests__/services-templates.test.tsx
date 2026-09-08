import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PortalProvider } from "../components/PortalProvider";
import { ServicesPage } from "../pages/Services";
import { createStore, demoContext } from "../data/mockTenant";

afterEach(cleanup);

/** templates wiring: the Services page can preview any @lumin/templates
 *  archetype configured for this tenant. */
describe("Services template catalog", () => {
  it("renders template previews for multiple verticals", () => {
    render(
      <PortalProvider ctx={demoContext} store={createStore()}>
        <MemoryRouter>
          <ServicesPage />
        </MemoryRouter>
      </PortalProvider>,
    );
    expect(screen.getByTestId("template-catalog")).toBeInTheDocument();
    // Two distinct verticals, different archetypes, straight from the registry.
    expect(screen.getByTestId("template-car-detailing")).toBeInTheDocument();
    expect(screen.getByTestId("template-tent-event-rental")).toBeInTheDocument();
    expect(screen.getByText("Car Detailing")).toBeInTheDocument();
  });
});
