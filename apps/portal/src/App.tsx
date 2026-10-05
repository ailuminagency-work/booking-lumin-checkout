/// <reference types="vite/client" />
import { Component, lazy, Suspense } from "react";
const FlowPortal = lazy(() => import("./flows/FlowPortal").then(module => ({ default: module.FlowPortal })));
const ModeOwnerPortal = lazy(() => import("./flows/ModeOwnerPortal").then(module => ({ default: module.ModeOwnerPortal })));
const ConnectedPortal = lazy(() => import("./connected/ConnectedPortal").then(module => ({ default: module.ConnectedPortal })));
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PortalProvider } from "./components/PortalProvider";
import { LegacyRedirects, PortalRoutes } from "./components/PortalRoutes";
import { readPublicRuntimeConfig } from "@lumin/runtime-client";

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    // Boundary-owned code only: errors and component stacks may contain private data.
    console.error("PORTAL_RENDER_ERROR");
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="error-screen" role="alert">
          <h1>Something went wrong</h1>
          <p>The portal could not display this page. This does not tell us whether your last action was saved.</p>
          <p>Reload the portal, then open the selected booking and check its current details before retrying any action. Reloading does not cancel or repeat your last action.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload portal
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PortalModeLoading({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" aria-live="polite">Loading portal…</p>}>{children}</Suspense>;
}

/** Shared route context; mode determines data access, never a fallback to demo. */
export function PortalApplication() {
  const runtime = readPublicRuntimeConfig(import.meta.env);
  return <><LegacyRedirects />{import.meta.env.VITE_MODE_OWNER_LOCAL_HARNESS === "true" ? <ModeOwnerPortal ownerApiUrl={import.meta.env.VITE_MODE_OWNER_API_URL ?? ""} draftApiUrl={import.meta.env.VITE_MODE_OWNER_DRAFT_API_URL ?? ""} /> : import.meta.env.VITE_FLOW_LOCAL_HARNESS === "true" ? <FlowPortal apiUrl={runtime.flowApiOrigin ?? ""} /> : runtime.mode === "supabase" ?
    <ConnectedPortal config={{
      url: runtime.supabaseUrl,
      publishableKey: runtime.supabasePublishableKey,
      tenantId: runtime.tenantId,
      bookingApiOrigin: runtime.flowApiOrigin,
    }} staging={runtime.environment === 'staging'} /> : <PortalProvider><Layout><PortalRoutes mode="demo" /></Layout></PortalProvider>}</>;
}

export function App() {
  return <ErrorBoundary><BrowserRouter basename={import.meta.env.BASE_URL}><PortalModeLoading><PortalApplication /></PortalModeLoading></BrowserRouter></ErrorBoundary>;
}
