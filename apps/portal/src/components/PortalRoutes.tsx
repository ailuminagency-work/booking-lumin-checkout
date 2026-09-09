import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AvailabilityPage } from "../pages/Availability";
import { BookingsPage } from "../pages/Bookings";
import { CheckoutConfigPage } from "../pages/CheckoutConfig";
import { CustomersPage } from "../pages/Customers";
import { DashboardPage } from "../pages/Dashboard";
import { IntegrationsPage } from "../pages/Integrations";
import { MediaLibraryPage } from "../pages/MediaLibrary";
import { ResourcesPage } from "../pages/Resources";
import { ServiceDetailPage, ServicesPage } from "../pages/Services";
import { SettingsPage } from "../pages/Settings";

const LEGACY: Readonly<Record<string, string>> = {
  "/availability": "/calendar/availability",
  "/resources": "/services/resources",
  "/checkout": "/embed",
};

/** Kept outside mode-specific content so login/error paths also honor old links. */
export function LegacyRedirects() {
  const location = useLocation();
  const destination = LEGACY[location.pathname.replace(/\/$/, "")];
  return destination ? <Navigate replace to={{ pathname: destination, search: location.search, hash: location.hash }} /> : null;
}

export function UnavailablePage({ title, children }: { title: string; children?: ReactNode }) {
  return <section><h1>{title}</h1><p role="status">This section is not available yet.</p><p>No changes can be made here. Existing bookings and settings are unchanged.</p>{children}</section>;
}

export function PortalRoutes({ mode, bookings, services, embed, workers }: { mode: "demo" | "connected"; bookings?: ReactNode; services?: ReactNode; embed?: ReactNode; workers?: ReactNode }) {
  const demo = mode === "demo";
  const page = (title: string, content: ReactNode) => demo ? content : <UnavailablePage title={title} />;
  return <Routes>
    <Route index element={demo ? <DashboardPage /> : <section><h1>Dashboard</h1><p>Use Bookings to review unconfirmed requests or Services to manage the connected simple-service catalog. Dashboard metrics are not available yet.</p><p><Link to="/bookings">View requests</Link> · <Link to="/services">View services</Link></p></section>} />
    <Route path="bookings" element={demo ? <BookingsPage /> : bookings} />
    <Route path="bookings/:bookingId" element={<UnavailablePage title="Booking detail" />} />
    <Route path="calendar" element={<UnavailablePage title="Calendar">{demo && <p><Link to="/calendar/availability">View demo availability settings</Link></p>}</UnavailablePage>} />
    <Route path="calendar/availability" element={page("Availability settings", <AvailabilityPage />)} />
    <Route path="calendar/*" element={<UnavailablePage title="Calendar" />} />
    <Route path="workers/*" element={workers ?? <UnavailablePage title="Workers" />} />
    <Route path="customers" element={page("Customers", <CustomersPage />)} />
    <Route path="customers/:customerId" element={<UnavailablePage title="Customer detail" />} />
    <Route path="services" element={demo ? <><p><Link to="/services/resources">Resources</Link> · <Link to="/services/templates">Templates</Link></p><ServicesPage /></> : services} />
    {/* Static destinations must not be mistaken for a service identifier. */}
    <Route path="services/resources" element={page("Resources", <ResourcesPage />)} />
    <Route path="services/templates" element={page("Templates", <ServicesPage />)} />
    <Route path="services/new" element={<UnavailablePage title="Create service" />} />
    <Route path="services/:serviceId" element={page("Service detail", <ServiceDetailPage />)} />
    <Route path="pricing/*" element={<UnavailablePage title="Pricing" />} />
    <Route path="invoices/*" element={<UnavailablePage title="Invoices" />} />
    <Route path="embed" element={demo ? <CheckoutConfigPage /> : embed ?? <UnavailablePage title="Embed Builder" />} />
    <Route path="embed/*" element={<UnavailablePage title="Embed Builder" />} />
    <Route path="media" element={page("Media", <MediaLibraryPage />)} />
    <Route path="integrations" element={page("Integrations", <IntegrationsPage />)} />
    <Route path="integrations/*" element={<UnavailablePage title="Integrations" />} />
    <Route path="settings" element={page("Settings", <SettingsPage />)} />
    <Route path="settings/business" element={page("Business settings", <SettingsPage />)} />
    <Route path="settings/*" element={<UnavailablePage title="Settings" />} />
    <Route path="*" element={<section><h1>Page not found</h1><Link to="/">Return to Dashboard</Link></section>} />
  </Routes>;
}
