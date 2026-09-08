import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflowEngine } from "@lumin/workflow";
import { PortalProvider } from "../components/PortalProvider";
import { CheckoutConfigPage } from "../pages/CheckoutConfig";
import { createStore, demoContext } from "../data/mockTenant";
import { PREVIEW_QUESTION_ID, previewFlow } from "../data/workflows";

afterEach(cleanup);

/** workflow wiring: the CheckoutConfig page previews the conditional flow. */
describe("CheckoutConfig workflow preview", () => {
  it("ships a valid flow and reacts conditionally", () => {
    const engine = createWorkflowEngine();
    expect(engine.validate(previewFlow)).toEqual([]);

    // No warning for a compact car; a truck triggers the time warning.
    expect(engine.nextState(previewFlow, { [PREVIEW_QUESTION_ID]: "c-compact" }).warnings).toHaveLength(0);
    const truck = engine.nextState(previewFlow, { [PREVIEW_QUESTION_ID]: "c-truck" });
    expect(truck.warnings.length).toBeGreaterThan(0);
    expect(truck.recommendations.some((r) => r.addonKey === "ad-ceramic")).toBe(true);
  });

  it("renders the preview and surfaces a warning when a truck is chosen", () => {
    render(
      <PortalProvider ctx={demoContext} store={createStore()}>
        <CheckoutConfigPage />
      </PortalProvider>,
    );
    expect(screen.getByTestId("flow-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-warning")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Truck / Van" }));
    expect(screen.getByTestId("flow-warning")).toBeInTheDocument();
  });
});
