import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { BusinessProfile } from "@lumin/contracts";
import { PortalProvider } from "../components/PortalProvider";
import { ServicesPage } from "../pages/Services";
import { CheckoutConfigPage } from "../pages/CheckoutConfig";
import { createStore, demoContext, DEMO_TENANT_ID } from "../data/mockTenant";

afterEach(cleanup);

/** A store whose demo tenant has the given profile activated (or none). */
function storeWithProfile(profile: BusinessProfile | null) {
  const store = createStore();
  const tenant = store.tenants.find((t) => t.id === DEMO_TENANT_ID)!;
  tenant.profileKey = profile;
  return store;
}

function renderServices(profile: BusinessProfile | null) {
  return render(
    <PortalProvider ctx={demoContext} store={storeWithProfile(profile)}>
      <MemoryRouter>
        <ServicesPage />
      </MemoryRouter>
    </PortalProvider>,
  );
}

function renderEmbed(profile: BusinessProfile | null) {
  return render(
    <PortalProvider ctx={demoContext} store={storeWithProfile(profile)}>
      <MemoryRouter>
        <CheckoutConfigPage />
      </MemoryRouter>
    </PortalProvider>,
  );
}

describe("Services page profile gating", () => {
  it("a CLEANING tenant sees only cleaning archetypes", () => {
    renderServices("CLEANING");
    const catalog = screen.getByTestId("template-catalog");
    // Cleaning-oriented templates are present…
    expect(within(catalog).getByTestId("template-housekeeping")).toBeInTheDocument();
    expect(within(catalog).getByTestId("template-pressure-washing")).toBeInTheDocument();
    // …and detailing / rental archetypes are NOT.
    expect(within(catalog).queryByTestId("template-car-detailing")).not.toBeInTheDocument();
    expect(within(catalog).queryByTestId("template-vehicle-rental")).not.toBeInTheDocument();
    expect(within(catalog).queryByTestId("template-tent-event-rental")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-scope-note")).toHaveTextContent("Cleaning");
    expect(screen.queryByTestId("profile-activation-prompt")).not.toBeInTheDocument();
  });

  it("a VEHICLE_RENTAL tenant sees rental archetypes, not cleaning", () => {
    renderServices("VEHICLE_RENTAL");
    const catalog = screen.getByTestId("template-catalog");
    expect(within(catalog).getByTestId("template-vehicle-rental")).toBeInTheDocument();
    expect(within(catalog).queryByTestId("template-housekeeping")).not.toBeInTheDocument();
    expect(within(catalog).queryByTestId("template-car-detailing")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-scope-note")).toHaveTextContent("Vehicle Rental");
  });

  it("a null profile shows the activation prompt and the full catalog (existing UI)", () => {
    renderServices(null);
    expect(screen.getByTestId("profile-activation-prompt")).toBeInTheDocument();
    const catalog = screen.getByTestId("template-catalog");
    // Unchanged behavior: all verticals still visible.
    expect(within(catalog).getByTestId("template-car-detailing")).toBeInTheDocument();
    expect(within(catalog).getByTestId("template-vehicle-rental")).toBeInTheDocument();
    expect(within(catalog).getByTestId("template-housekeeping")).toBeInTheDocument();
  });
});

describe("Embed Builder profile gating", () => {
  it("renders the active profile's embed flow and terminology (CLEANING)", () => {
    renderEmbed("CLEANING");
    const flow = screen.getByTestId("embed-flow");
    expect(within(flow).getByTestId("embed-step-service")).toBeInTheDocument();
    expect(within(flow).getByTestId("embed-step-configure")).toBeInTheDocument();
    expect(within(flow).getByTestId("embed-step-confirmation")).toBeInTheDocument();
    // Cleaning uses customer terminology.
    expect(screen.getByTestId("embed-profile-note")).toHaveTextContent("customer");
    expect(screen.queryByTestId("embed-activation-prompt")).not.toBeInTheDocument();
  });

  it("a rental profile drops the configure step and switches terminology to renter", () => {
    renderEmbed("VEHICLE_RENTAL");
    const flow = screen.getByTestId("embed-flow");
    expect(within(flow).getByTestId("embed-step-slot")).toBeInTheDocument();
    expect(within(flow).queryByTestId("embed-step-configure")).not.toBeInTheDocument();
    expect(screen.getByTestId("embed-profile-note")).toHaveTextContent("renter");
  });

  it("a null profile shows the embed activation prompt", () => {
    renderEmbed(null);
    expect(screen.getByTestId("embed-activation-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("embed-flow")).not.toBeInTheDocument();
  });
});
