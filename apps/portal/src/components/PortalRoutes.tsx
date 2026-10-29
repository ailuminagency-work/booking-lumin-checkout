import { lazy, Suspense, type ReactNode } from "react";
import { Link, Route, Routes } from "react-router-dom";
const AvailabilityPage = lazy(() => import("../pages/Availability").then(module => ({ default: module.AvailabilityPage })));
const BookingsPage = lazy(() => import("../pages/Bookings").then(module => ({ default: module.BookingsPage })));
const CheckoutConfigPage = lazy(() => import("../pages/CheckoutConfig").then(module => ({ default: module.CheckoutConfigPage })));
const CustomersPage = lazy(() => import("../pages/Customers").then(module => ({ default: module.CustomersPage })));
const DashboardPage = lazy(() => import("../pages/Dashboard").then(module => ({ default: module.DashboardPage })));
const IntegrationsPage = lazy(() => import("../pages/Integrations").then(module => ({ default: module.IntegrationsPage })));
const MediaLibraryPage = lazy(() => import("../pages/MediaLibrary").then(module => ({ default: module.MediaLibraryPage })));
const ResourcesPage = lazy(() => import("../pages/Resources").then(module => ({ default: module.ResourcesPage })));
const ServiceDetailPage = lazy(() => import("../pages/Services").then(module => ({ default: module.ServiceDetailPage })));
const ServicesPage = lazy(() => import("../pages/Services").then(module => ({ default: module.ServicesPage })));
const SettingsPage = lazy(() => import("../pages/Settings").then(module => ({ default: module.SettingsPage })));

export function UnavailablePage({ title, children }: { title: string; children?: ReactNode }) {
  return <section><h1>{title}</h1><p role="status">This section is not available yet.</p><p>No changes can be made here. Existing bookings and settings are unchanged.</p>{children}</section>;
}

export function PortalRoutes({ mode, bookings, bookingDetail, services, embed, workers, settings }: { mode: "demo" | "connected"; bookings?: ReactNode; bookingDetail?: ReactNode; services?: ReactNode; embed?: ReactNode; workers?: ReactNode; settings?: ReactNode }) {
  const demo = mode === "demo";
  const page = (title: string, content: ReactNode) => demo ? content : <UnavailablePage title={title} />;
  return <Suspense fallback={<p role="status" aria-live="polite">Loading page…</p>}><Routes>
    <Route index element={demo ? <DashboardPage /> : <section><h1>Dashboard</h1><p>Use Bookings to review bookings and requests or Services to manage the connected simple-service catalog. Dashboard metrics are not available yet.</p><p><Link to="/bookings">View bookings</Link> · <Link to="/services">View services</Link></p></section>} />
    <Route path="bookings" element={demo ? <BookingsPage /> : bookings} />
    <Route path="bookings/:bookingId" element={!demo&&bookingDetail?bookingDetail:<UnavailablePage title="Booking detail" />} />
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
    <Route path="settings" element={demo?<SettingsPage />:settings??<UnavailablePage title="Settings" />} />
    <Route path="settings/business" element={demo?<SettingsPage />:settings??<UnavailablePage title="Business settings" />} />
    <Route path="settings/*" element={!demo&&settings?settings:<UnavailablePage title="Settings" />} />
    <Route path="*" element={<section><h1>Page not found</h1><Link to="/">Return to Dashboard</Link></section>} />
  </Routes></Suspense>;
}
