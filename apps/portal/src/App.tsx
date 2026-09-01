import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PortalProvider } from "./components/PortalProvider";
import { AvailabilityPage } from "./pages/Availability";
import { BookingsPage } from "./pages/Bookings";
import { CheckoutConfigPage } from "./pages/CheckoutConfig";
import { CustomersPage } from "./pages/Customers";
import { DashboardPage } from "./pages/Dashboard";
import { IntegrationsPage } from "./pages/Integrations";
import { ServiceDetailPage, ServicesPage } from "./pages/Services";
import { SettingsPage } from "./pages/Settings";

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

export function App() {
  return (
    <ErrorBoundary>
      <PortalProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="services/:serviceId" element={<ServiceDetailPage />} />
              <Route path="availability" element={<AvailabilityPage />} />
              <Route path="checkout" element={<CheckoutConfigPage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="*"
                element={
                  <div className="empty-state" role="status">
                    <p className="empty-state-title">Page not found</p>
                  </div>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </PortalProvider>
    </ErrorBoundary>
  );
}
