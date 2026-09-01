import { useState } from "react";
import { formatMoney } from "@lumin/contracts";
import { tenant } from "../config/demoTenant";
import { formatDateTime } from "../lib/datetime";
import { useCheckout } from "../state/checkout";

export function Confirmation() {
  const { state, dispatch } = useCheckout();
  const [calendarSaved, setCalendarSaved] = useState(false);
  const booking = state.booking;

  if (!booking) {
    return (
      <section aria-labelledby="confirm-heading">
        <h2 id="confirm-heading">No booking found</h2>
        <p className="empty">We couldn't find a confirmed booking in this session.</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => dispatch({ type: "RESET" })}
        >
          Start a new booking
        </button>
      </section>
    );
  }

  return (
    <section className="receipt" aria-labelledby="confirm-heading">
      <div className="receipt-check" aria-hidden="true">
        ✓
      </div>
      <h2 id="confirm-heading">Booking confirmed</h2>
      <p className="receipt-reference">
        Reference <strong>{booking.reference}</strong>
      </p>

      <dl className="receipt-details">
        <div className="receipt-row">
          <dt>When</dt>
          <dd>{formatDateTime(booking.slotStart, tenant.timezone)}</dd>
        </div>
        <div className="receipt-row">
          <dt>Name</dt>
          <dd>{booking.customer.name}</dd>
        </div>
        <div className="receipt-row">
          <dt>Email</dt>
          <dd>{booking.customer.email}</dd>
        </div>
        {booking.address && (
          <div className="receipt-row">
            <dt>Address</dt>
            <dd>
              {booking.address.line1}
              {booking.address.line2 ? `, ${booking.address.line2}` : ""}, {booking.address.city}
            </dd>
          </div>
        )}
      </dl>

      <div className="price-breakdown">
        <ul className="price-lines">
          {booking.pricing.lines.map((line, i) => (
            <li key={`${line.code}-${i}`} className="price-line">
              <span>
                {line.label}
                {line.quantity > 1 && <span className="muted"> × {line.quantity}</span>}
              </span>
              <span>{formatMoney(line.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="price-totals">
          <div className="price-total-row">
            <dt>Subtotal</dt>
            <dd>{formatMoney(booking.pricing.subtotal)}</dd>
          </div>
          <div className="price-total-row">
            <dt>Tax</dt>
            <dd>{formatMoney(booking.pricing.tax)}</dd>
          </div>
          {booking.pricing.deposit.amount > 0 && (
            <div className="price-total-row">
              <dt>Deposit</dt>
              <dd>{formatMoney(booking.pricing.deposit)}</dd>
            </div>
          )}
          <div className="price-total-row grand">
            <dt>Paid</dt>
            <dd>{formatMoney(booking.pricing.total)}</dd>
          </div>
        </dl>
      </div>

      <p className="muted">A receipt was sent to {booking.customer.email} (simulated).</p>

      <div className="receipt-actions">
        <button
          type="button"
          className="btn secondary"
          onClick={() => setCalendarSaved(true)}
          aria-live="polite"
        >
          {calendarSaved ? "Added to calendar ✓" : "Add to calendar"}
        </button>
        <button type="button" className="btn primary" onClick={() => dispatch({ type: "RESET" })}>
          Start a new booking
        </button>
      </div>
    </section>
  );
}
