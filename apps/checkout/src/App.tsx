import { HostedFlow } from "./flows/HostedFlow";
import { useStagingInstallEscape } from "./staging-install-escape";
import { Component, Suspense, lazy, useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { STEP_LABELS, visibleStepsFor, WizardControls } from "./components/WizardControls";
import { branding, getService } from "./config/demoTenant";
import { CheckoutProvider, useCheckout } from "./state/checkout";
import { readPublicRuntimeConfig } from "@lumin/runtime-client";
import { Configurator } from "./steps/Configurator";
import { Confirmation } from "./steps/Confirmation";
import { CustomerForm } from "./steps/CustomerForm";
import { Payment } from "./steps/Payment";
import { ServicePicker } from "./steps/ServicePicker";
import { SlotPicker } from "./steps/SlotPicker";
import { Summary } from "./steps/Summary";

const HostedDetailingFlow = lazy(() => import("./flows/HostedDetailingFlow").then(module => ({ default: module.HostedDetailingFlow })));
const HostedJourneyCustomerFieldFlow = lazy(() => import("./flows/HostedJourneyCustomerFieldFlow").then(module => ({ default: module.HostedJourneyCustomerFieldFlow })));
const HostedJourneyFlow = lazy(() => import("./flows/HostedJourneyFlow").then(module => ({ default: module.HostedJourneyFlow })));
const ConnectedCheckout = lazy(() => import("./connected/ConnectedCheckout").then(module => ({ default: module.ConnectedCheckout })));

// A missing route chunk says nothing about an earlier booking or payment attempt.
class RouteLoadingBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render(): ReactNode {
    if (this.state.failed) return <main className="checkout-card" role="alert">
      <h1>Checkout could not be loaded</h1>
      <p>Booking and payment status have not been checked. If you already submitted a request, contact the business with your booking reference before starting another booking.</p>
    </main>;
    return this.props.children;
  }
}

function RouteLoading() {
  return <main className="checkout-card" aria-busy="true"><p role="status">Loading checkout…</p></main>;
}

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

export function HostedInstallationFlow(props:{installationId:string;apiUrl:string;localHarness?:boolean}) {
  useStagingInstallEscape();
  const [detailing,setDetailing]=useState(false);
  const unsupported=useCallback(()=>setDetailing(true),[]);
  return detailing ? <RouteLoadingBoundary><Suspense fallback={<RouteLoading />}><HostedDetailingFlow {...props}/></Suspense></RouteLoadingBoundary> : <HostedFlow {...props} onUnsupportedConfig={unsupported}/>;
}

export default function App() {
  const runtime = readPublicRuntimeConfig(import.meta.env);
  const relativePath = location.pathname.startsWith("/checkout/flow/") || location.pathname.startsWith("/checkout/journey/flow/") || location.pathname.startsWith("/checkout/journey-fields/flow/") ? location.pathname.slice("/checkout/".length) : location.pathname.startsWith(import.meta.env.BASE_URL) ? location.pathname.slice(import.meta.env.BASE_URL.length) : location.pathname.replace(/^\/checkout\//, "");
  const hostedMatch = /^flow\/([^/]+)\/?$/.exec(relativePath.replace(/^\//, ""));
  const journeyMatch = /^journey\/flow\/([^/]+)\/?$/.exec(relativePath.replace(/^\//, ""));
  const customerFieldsMatch = /^journey-fields\/flow\/([^/]+)\/?$/.exec(relativePath.replace(/^\//, ""));
  if (customerFieldsMatch) return <ErrorBoundary><RouteLoadingBoundary><Suspense fallback={<RouteLoading />}><HostedJourneyCustomerFieldFlow key={customerFieldsMatch[1]!+runtime.flowApiOrigin} installationId={customerFieldsMatch[1]!} config={runtime} /></Suspense></RouteLoadingBoundary></ErrorBoundary>;
  if (relativePath.replace(/^\//, "").startsWith("journey-fields/")) return <main className="checkout-card" role="alert"><h1>Published form preview unavailable</h1><p>This staging presentation URL is invalid. Booking and payment status have not been checked.</p></main>;
  if (journeyMatch) return <ErrorBoundary><RouteLoadingBoundary><Suspense fallback={<RouteLoading />}><HostedJourneyFlow key={journeyMatch[1]!+runtime.flowApiOrigin} installationId={journeyMatch[1]!} config={runtime} /></Suspense></RouteLoadingBoundary></ErrorBoundary>;
  if (hostedMatch) return <ErrorBoundary><HostedInstallationFlow key={hostedMatch[1]!+runtime.flowApiOrigin} installationId={hostedMatch[1]!} apiUrl={runtime.flowApiOrigin ?? ""} localHarness={import.meta.env.VITE_FLOW_LOCAL_HARNESS === "true"} /></ErrorBoundary>;
  if (runtime.mode === "supabase") {
    return <ErrorBoundary><RouteLoadingBoundary><Suspense fallback={<RouteLoading />}><ConnectedCheckout config={{
      url: runtime.supabaseUrl,
      publishableKey: runtime.supabasePublishableKey,
      tenantId: runtime.tenantId,
    }} /></Suspense></RouteLoadingBoundary></ErrorBoundary>;
  }
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
