import { Component, type ErrorInfo, type ReactNode } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import Bookings from "./pages/Bookings";
import Businesses from "./pages/Businesses";
import Economics from "./pages/Economics";
import Health from "./pages/Health";
import Overview from "./pages/Overview";

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Aggregate-level logging only; never log tenant or customer payloads.
    console.error("Command Center render error", error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <h1>Something went wrong</h1>
          <p>The Command Center hit an unexpected rendering error.</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/businesses", label: "Businesses", end: false },
  { to: "/bookings", label: "Bookings", end: false },
  { to: "/economics", label: "Economics", end: false },
  { to: "/health", label: "Health", end: false },
];

export default function App() {
  return (
    <ErrorBoundary>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              ◍
            </span>
            <div>
              <span className="brand-name">LUMIN</span>
              <span className="brand-sub">Command Center</span>
            </div>
          </div>
          <nav aria-label="Primary">
            <ul className="nav-list">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <footer className="sidebar-footer">
            <span className="pill pill-muted">PLATFORM_ADMIN</span>
            <p>Aggregates only — no customer PII.</p>
          </footer>
        </aside>
        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/businesses" element={<Businesses />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/economics" element={<Economics />} />
            <Route path="/health" element={<Health />} />
            <Route
              path="*"
              element={
                <section className="page-header">
                  <h1>Not found</h1>
                  <p className="page-subtitle">That page does not exist in the Command Center.</p>
                </section>
              }
            />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  );
}
