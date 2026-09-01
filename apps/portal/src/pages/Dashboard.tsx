import { formatMoney } from "@lumin/contracts";
import { Link } from "react-router-dom";
import { usePortal } from "../components/PortalProvider";
import { EmptyState, PageHeader, STATE_LABELS, StateBadge, formatInstant, formatSlot } from "../components/ui";
import {
  countUpcomingBookings,
  getBookingStateCounts,
  getService,
  getTenant,
  getUpcomingBookings,
  getWeekConfirmedRevenue,
  listRecentEvents,
} from "../data/api";

const EVENT_LABELS: Record<string, string> = {
  "booking.created": "Booking created",
  "booking.pending_payment": "Awaiting payment",
  "booking.confirmed": "Booking confirmed",
  "booking.completed": "Booking completed",
  "booking.cancelled": "Booking cancelled",
  "booking.refunded": "Booking refunded",
  "booking.failed": "Booking failed",
  "tenant.settings_updated": "Settings updated",
};

export function DashboardPage() {
  const { ctx, store } = usePortal();
  const tenant = getTenant(ctx, store);
  const upcomingCount = countUpcomingBookings(ctx, store);
  const weekRevenue = getWeekConfirmedRevenue(ctx, store);
  const counts = getBookingStateCounts(ctx, store);
  const upcoming = getUpcomingBookings(ctx, 5, store);
  const events = listRecentEvents(ctx, 8, store);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Overview for ${tenant.name}`} />

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Upcoming bookings</span>
          <span className="stat-value" data-testid="stat-upcoming">
            {upcomingCount}
          </span>
          <span className="stat-hint">confirmed or awaiting payment</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Confirmed revenue (7 days)</span>
          <span className="stat-value" data-testid="stat-week-revenue">
            {formatMoney(weekRevenue)}
          </span>
          <span className="stat-hint">from booking totals, minor units</span>
        </div>
        <div className="stat-card stat-card-wide">
          <span className="stat-label">Bookings by state</span>
          <ul className="state-count-list">
            {(Object.keys(counts) as Array<keyof typeof counts>)
              .filter((s) => counts[s] > 0)
              .map((s) => (
                <li key={s}>
                  <StateBadge state={s} />
                  <span className="state-count" data-testid={`count-${s}`}>
                    {counts[s]}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      </div>

      <div className="dashboard-columns">
        <section className="panel" aria-labelledby="dash-upcoming">
          <div className="panel-header">
            <h2 id="dash-upcoming">Next 5 upcoming</h2>
            <Link className="panel-link" to="/bookings">
              All bookings →
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming bookings" hint="New checkout bookings will appear here." />
          ) : (
            <ul className="upcoming-list">
              {upcoming.map((b) => (
                <li key={b.id}>
                  <div>
                    <span className="upcoming-ref">{b.reference}</span>
                    <span className="muted"> · {b.customer.name}</span>
                    <div className="muted">
                      {getService(ctx, b.selection.serviceId, store)?.name ?? "—"} · {formatSlot(b.slotStart, b.slotEnd)}
                    </div>
                  </div>
                  <div className="upcoming-right">
                    <StateBadge state={b.state} />
                    <span className="upcoming-total">{formatMoney(b.pricing.total)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="dash-activity">
          <div className="panel-header">
            <h2 id="dash-activity">Recent activity</h2>
          </div>
          {events.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="activity-list">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="activity-name">{EVENT_LABELS[e.name] ?? e.name}</span>
                  {typeof e.data["reference"] === "string" && e.data["reference"] ? (
                    <span className="activity-ref">{String(e.data["reference"])}</span>
                  ) : null}
                  {typeof e.data["state"] === "string" && e.data["state"] in STATE_LABELS ? null : null}
                  <span className="muted activity-at">{formatInstant(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
