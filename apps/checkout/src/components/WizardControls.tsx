import type { Service } from "@lumin/contracts";
import { getService } from "../config/demoTenant";
import { useCheckout, type Step } from "../state/checkout";
import { hasConfiguration, validateCustomerDraft, validateSelection } from "../state/validation";

export const STEP_LABELS: Record<Step, string> = {
  service: "Service",
  configure: "Options",
  summary: "Summary",
  slot: "Time",
  customer: "Details",
  payment: "Payment",
  confirmation: "Done",
};

/** The wizard skips "configure" for services with nothing to configure. */
export function visibleStepsFor(service: Service | null): Step[] {
  const configure: Step[] = service && !hasConfiguration(service) ? [] : ["configure"];
  return ["service", ...configure, "summary", "slot", "customer", "payment", "confirmation"];
}

/**
 * Shared Back/Continue footer. Continue stays clickable while invalid so a
 * press can surface the step's inline validation (aria-disabled signals the
 * state to assistive tech); Back is disabled on the first step.
 * Payment and Confirmation render their own controls.
 */
export function WizardControls() {
  const { state, dispatch } = useCheckout();
  const service = getService(state.selection?.serviceId);
  const steps = visibleStepsFor(service);
  const index = steps.indexOf(state.step);

  if (state.step === "payment" || state.step === "confirmation") return null;

  const valid = (() => {
    switch (state.step) {
      case "service":
        return state.selection != null;
      case "configure":
      case "summary":
        return (
          service != null &&
          state.selection != null &&
          validateSelection(service, state.selection).length === 0
        );
      case "slot":
        return state.slot != null;
      case "customer":
        return validateCustomerDraft(state.customerDraft).ok;
      default:
        return false;
    }
  })();

  function onBack() {
    const prev = index > 0 ? steps[index - 1] : undefined;
    if (prev) dispatch({ type: "GOTO", step: prev });
  }

  function onContinue() {
    if (!valid) {
      dispatch({ type: "ATTEMPT", step: state.step });
      return;
    }
    if (state.step === "customer") {
      const result = validateCustomerDraft(state.customerDraft);
      if (!result.ok || !result.customer) {
        dispatch({ type: "ATTEMPT", step: state.step });
        return;
      }
      dispatch({ type: "CONFIRM_CUSTOMER", customer: result.customer, address: result.address });
    }
    const next = index >= 0 ? steps[index + 1] : undefined;
    if (next) dispatch({ type: "GOTO", step: next });
  }

  return (
    <div className="wizard-controls">
      <button type="button" className="btn secondary" onClick={onBack} disabled={index <= 0}>
        Back
      </button>
      <button
        type="button"
        className="btn primary"
        onClick={onContinue}
        aria-disabled={!valid}
      >
        Continue
      </button>
    </div>
  );
}
