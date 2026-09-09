/// <reference types="vite/client" />
import { Component } from "react";
import { ConnectedPortal } from "./connected/ConnectedPortal";
import type { ErrorInfo, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PortalProvider } from "./components/PortalProvider";
import { LegacyRedirects, PortalRoutes } from "./components/PortalRoutes";

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
  return <><LegacyRedirects />{import.meta.env.VITE_RUNTIME_MODE === "supabase" ?
    <ConnectedPortal config={{
      url: import.meta.env.VITE_SUPABASE_URL ?? "",
      publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      tenantId: import.meta.env.VITE_TENANT_ID ?? "",
    }} /> : <PortalProvider><Layout><PortalRoutes mode="demo" /></Layout></PortalProvider>}</>;
}

export function App() {
  return <ErrorBoundary><BrowserRouter basename={import.meta.env.BASE_URL}><PortalApplication /></BrowserRouter></ErrorBoundary>;
}
