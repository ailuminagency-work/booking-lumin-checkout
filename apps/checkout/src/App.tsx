import type { CSSProperties } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { STEP_LABELS, visibleStepsFor, WizardControls } from "./components/WizardControls";
import { branding, getService } from "./config/demoTenant";
import { CheckoutProvider, useCheckout } from "./state/checkout";
import { Configurator } from "./steps/Configurator";
import { Confirmation } from "./steps/Confirmation";
import { CustomerForm } from "./steps/CustomerForm";
import { Payment } from "./steps/Payment";
import { ServicePicker } from "./steps/ServicePicker";
import { SlotPicker } from "./steps/SlotPicker";
import { Summary } from "./steps/Summary";

function StepBody() {
  const { state } = useCheckout();
  switch (state.step) {
    case "service":
      return <ServicePicker />;
    case "configure":
      return <Configurator />;
    case "summary":
      return <Summary />;
    case "slot":
      return <SlotPicker />;
    case "customer":
      return <CustomerForm />;
    case "payment":
      return <Payment />;
    case "confirmation":
      return <Confirmation />;
    default:
      return null;
  }
}

function Shell() {
  const { state } = useCheckout();
  const service = getService(state.selection?.serviceId);
  const steps = visibleStepsFor(service);
  const activeIndex = steps.indexOf(state.step);

  return (
    <main className="checkout-card">
      <header className="checkout-header">
        <span className="logo" aria-hidden="true">
          {branding.logoText}
        </span>
        <h1>{branding.businessName}</h1>
      </header>

      <nav aria-label="Checkout progress">
        <ol className="progress">
          {steps.map((step, i) => (
            <li
              key={step}
              aria-current={step === state.step ? "step" : undefined}
              className={i < activeIndex ? "done" : ""}
            >
              {STEP_LABELS[step]}
            </li>
          ))}
        </ol>
      </nav>

      {state.stepMessage && state.stepMessage.step === state.step && (
        <p className="step-message" role="alert">
          {state.stepMessage.text}
        </p>
      )}

      <StepBody />
      <WizardControls />
    </main>
  );
}

export default function App() {
  // White-label: branding flows in via CSS custom properties, so swapping
  // the tenant config restyles the whole checkout.
  const brandStyle = { "--accent": branding.accentColor } as CSSProperties;
  return (
    <ErrorBoundary>
      <CheckoutProvider>
        <div className="checkout-root" style={brandStyle}>
          <Shell />
        </div>
      </CheckoutProvider>
    </ErrorBoundary>
  );
}
