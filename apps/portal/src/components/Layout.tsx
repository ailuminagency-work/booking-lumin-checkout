import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { getTenant } from "../data/api";
import { usePortal } from "./PortalProvider";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", glyph: "▦", end: true },
  { to: "/bookings", label: "Bookings", glyph: "🗓" },
  { to: "/calendar", label: "Calendar", glyph: "◷" },
  { to: "/workers", label: "Workers", glyph: "♙" },
  { to: "/customers", label: "Customers", glyph: "☺" },
  { to: "/services", label: "Services", glyph: "✦" },
  { to: "/pricing", label: "Pricing", glyph: "$" },
  { to: "/invoices", label: "Invoices", glyph: "▤" },
  { to: "/embed", label: "Embed Builder", glyph: "▣" },
  { to: "/media", label: "Media", glyph: "▨" },
  { to: "/integrations", label: "Integrations", glyph: "⇄" },
  { to: "/settings", label: "Settings", glyph: "⚙" },
] as const;

/** Presentation only: connected mode never reads the demo tenant store. */
export function PortalShell({ children, tenantName, roleLabel, mode }: {
  children: ReactNode; tenantName: string; roleLabel?: string; mode: "demo" | "connected";
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={navOpen}
          aria-controls="portal-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
        <span className="topbar-brand">Booking Lumin</span>
        <span className="topbar-tenant">{tenantName}</span>
      </header>
      <div className="shell-body">
        <nav id="portal-nav" className={`sidebar ${navOpen ? "open" : ""}`} aria-label="Portal sections">
          <div className="sidebar-brand" aria-hidden="true">
            <span className="sidebar-logo">BL</span>
            <span className="sidebar-brand-text">
              Booking Lumin
              <small>Business Portal</small>
            </span>
          </div>
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={"end" in item ? item.end : false}
                  className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                  onClick={() => setNavOpen(false)}
                >
                  <span className="nav-glyph" aria-hidden="true">
                    {item.glyph}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="sidebar-footer">
            <span className="role-badge">{roleLabel ?? "Signed out"}</span>
            <span className="sidebar-tenant">{tenantName}</span>
          </div>
        </nav>
        <main id="main-content" className="content">
          <p className="note-banner" role="note">{mode === "demo" ? "Demo workspace — sample data stays in this app and is not synchronized." : "Connected workspace — available records come from the business database. Payments and external providers remain inactive."}</p>
          {children}
        </main>
      </div>
    </div>
  );
}


export function Layout({children}: {children: ReactNode}) {
  const {ctx, store} = usePortal();
  const tenant = getTenant(ctx, store);
  return <PortalShell tenantName={tenant.name} roleLabel={ctx.role === "BUSINESS_OWNER" ? "Owner" : "Staff"} mode="demo">{children}</PortalShell>;
}
