import { formatMoney } from "@lumin/contracts";
import {
  getBooking,
  getBookingHistory,
  getService,
  legalNextStates,
  transitionBooking,
} from "../data/api";
import { usePortal } from "./PortalProvider";
import { STATE_LABELS, StateBadge, formatInstant, formatSlot } from "./ui";

/**
 * Booking detail: full price breakdown, state history, and action buttons
 * for the LEGAL next transitions only — driven directly by the shared
 * BOOKING_TRANSITIONS state machine in @lumin/contracts.
 */
export function BookingDrawer({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { ctx, store } = usePortal();
  const booking = getBooking(ctx, bookingId, store);
  if (!booking) return null;
  const service = getService(ctx, booking.selection.serviceId, store);
  const history = getBookingHistory(ctx, bookingId, store);
  const nextStates = legalNextStates(booking.state);

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-label={`Booking ${booking.reference}`}>
      <div className="drawer-header">
        <div>
          <h2 className="drawer-title">{booking.reference}</h2>
          <StateBadge state={booking.state} />
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close booking detail">
          ✕
        </button>
      </div>

      <dl className="drawer-meta">
        <div>
          <dt>Customer</dt>
          <dd>
            {booking.customer.name}
            <br />
            <span className="muted">{booking.customer.email}</span>
          </dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>{service?.name ?? "—"}</dd>
        </div>
        <div>
          <dt>Slot</dt>
          <dd>{formatSlot(booking.slotStart, booking.slotEnd)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatInstant(booking.createdAt)}</dd>
        </div>
      </dl>

      <section aria-labelledby={`bd-breakdown-${booking.id}`}>
        <h3 id={`bd-breakdown-${booking.id}`}>Price breakdown</h3>
        <table className="mini-table">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {booking.pricing.lines.map((line) => (
              <tr key={line.code}>
                <td>{line.label}</td>
                <td className="num">{line.quantity}</td>
                <td className="num">{formatMoney(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Subtotal
              </th>
              <td className="num">{formatMoney(booking.pricing.subtotal)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={2}>
                Tax
              </th>
              <td className="num">{formatMoney(booking.pricing.tax)}</td>
            </tr>
            {booking.pricing.deposit.amount > 0 ? (
              <tr>
                <th scope="row" colSpan={2}>
                  Deposit
                </th>
                <td className="num">{formatMoney(booking.pricing.deposit)}</td>
              </tr>
            ) : null}
            <tr className="total-row">
              <th scope="row" colSpan={2}>
                Total
              </th>
              <td className="num">{formatMoney(booking.pricing.total)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section aria-labelledby={`bd-history-${booking.id}`}>
        <h3 id={`bd-history-${booking.id}`}>State history</h3>
        {history.length === 0 ? (
          <p className="muted">No transitions yet — still in draft.</p>
        ) : (
          <ol className="history-list">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="history-states">
                  {STATE_LABELS[h.from]} → {STATE_LABELS[h.to]}
                </span>
                <span className="muted">{formatInstant(h.at)}</span>
                {h.reason ? <span className="history-reason">{h.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby={`bd-actions-${booking.id}`} className="drawer-actions">
        <h3 id={`bd-actions-${booking.id}`}>Actions</h3>
        {nextStates.length === 0 ? (
          <p className="muted">This booking is in a terminal state — no further transitions.</p>
        ) : (
          <div className="action-row" data-testid="transition-actions">
            {nextStates.map((to) => (
              <button
                key={to}
                type="button"
                className={`btn ${to === "confirmed" || to === "completed" ? "btn-primary" : "btn-secondary"}`}
                data-transition-to={to}
                onClick={() => transitionBooking(ctx, booking.id, to, "Portal action", store)}
              >
                Mark {STATE_LABELS[to].toLowerCase()}
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
