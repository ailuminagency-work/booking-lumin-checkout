import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WizardControls } from "../components/WizardControls";
import { configurableService } from "../config/demoTenant";
import {
  checkoutReducer,
  CheckoutProvider,
  createFreshState,
  useCheckout,
} from "../state/checkout";
import { Configurator } from "./Configurator";

function StepProbe() {
  const { state } = useCheckout();
  return <output data-testid="current-step">{state.step}</output>;
}

function renderConfigureStep() {
  let state = createFreshState();
  state = checkoutReducer(state, { type: "SELECT_SERVICE", service: configurableService });
  expect(state.step).toBe("configure");
  render(
    <CheckoutProvider initialState={state}>
      <Configurator />
      <WizardControls />
      <StepProbe />
    </CheckoutProvider>,
  );
}

describe("Configurator", () => {
  it("blocks Continue with an inline message until the required question is answered", () => {
    renderConfigureStep();

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toHaveAttribute("aria-disabled", "true");

    // Attempting to continue keeps the user on the step and surfaces the error.
    fireEvent.click(continueBtn);
    expect(screen.getByTestId("current-step")).toHaveTextContent("configure");
    expect(screen.getByText("Please choose an option.")).toBeInTheDocument();

    // Answering the required single-choice question unblocks progress.
    fireEvent.click(screen.getByLabelText(/Medium/));
    expect(screen.queryByText("Please choose an option.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("current-step")).toHaveTextContent("summary");
  });

  it("quantity stepper respects its max and min bounds", () => {
    renderConfigureStep();

    const increase = screen.getByRole("button", {
      name: "Increase Extra rooms beyond the standard package",
    });
    const decrease = screen.getByRole("button", {
      name: "Decrease Extra rooms beyond the standard package",
    });

    // min is 0 → decrease starts disabled.
    expect(decrease).toBeDisabled();

    // max is 5 → increase becomes disabled after five presses.
    for (let i = 0; i < 5; i++) fireEvent.click(increase);
    expect(increase).toBeDisabled();
    for (let i = 0; i < 5; i++) fireEvent.click(decrease);
    expect(decrease).toBeDisabled();
  });
});
