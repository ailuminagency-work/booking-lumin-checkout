import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { getTenant } from "../data/api";
import { usePortal } from "./PortalProvider";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", glyph: "▦", end: true },
  { to: "/bookings", label: "Bookings", glyph: "🗓" },
  { to: "/customers", label: "Customers", glyph: "☺" },
  { to: "/services", label: "Services", glyph: "✦" },
  { to: "/availability", label: "Availability", glyph: "◷" },
  { to: "/checkout", label: "Checkout Config", glyph: "▣" },
  { to: "/integrations", label: "Integrations", glyph: "⇄" },
  { to: "/settings", label: "Settings", glyph: "⚙" },
] as const;

export function Layout() {
  const { ctx, store } = usePortal();
  const tenant = getTenant(ctx, store);
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
        <span className="topbar-tenant">{tenant.name}</span>
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
            <span className="role-badge">{ctx.role === "BUSINESS_OWNER" ? "Owner" : "Staff"}</span>
            <span className="sidebar-tenant">{tenant.name}</span>
          </div>
        </nav>
        <main id="main-content" className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
