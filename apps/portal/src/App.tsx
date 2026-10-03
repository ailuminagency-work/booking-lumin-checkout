/// <reference types="vite/client" />
import { Component } from "react";
import { FlowPortal } from "./flows/FlowPortal";
import { ModeOwnerPortal } from "./flows/ModeOwnerPortal";
import { ConnectedPortal } from "./connected/ConnectedPortal";
import type { ErrorInfo, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PortalProvider } from "./components/PortalProvider";
import { LegacyRedirects, PortalRoutes } from "./components/PortalRoutes";
import { readPublicRuntimeConfig } from "@lumin/runtime-client";

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never log sensitive payloads (SI-11); message + component stack only.
    console.error("Portal render error:", error.message, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="error-screen" role="alert">
          <h1>Something went wrong</h1>
          <p>The portal hit an unexpected error. Reloading usually fixes it.</p>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Shared route context; mode determines data access, never a fallback to demo. */
export function PortalApplication() {
  const runtime = readPublicRuntimeConfig(import.meta.env);
  return <><LegacyRedirects />{import.meta.env.VITE_MODE_OWNER_LOCAL_HARNESS === "true" ? <ModeOwnerPortal ownerApiUrl={import.meta.env.VITE_MODE_OWNER_API_URL ?? ""} draftApiUrl={import.meta.env.VITE_MODE_OWNER_DRAFT_API_URL ?? ""} /> : import.meta.env.VITE_FLOW_LOCAL_HARNESS === "true" ? <FlowPortal apiUrl={runtime.flowApiOrigin ?? ""} /> : runtime.mode === "supabase" ?
    <ConnectedPortal config={{
      url: runtime.supabaseUrl,
      publishableKey: runtime.supabasePublishableKey,
      tenantId: runtime.tenantId,
    }} /> : <PortalProvider><Layout><PortalRoutes mode="demo" /></Layout></PortalProvider>}</>;
}

export function App() {
  return <ErrorBoundary><BrowserRouter basename={import.meta.env.BASE_URL}><PortalApplication /></BrowserRouter></ErrorBoundary>;
}
