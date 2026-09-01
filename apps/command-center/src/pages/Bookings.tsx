import { Chart } from "../components/Chart";
import {
  bookingStateTotals,
  cancellationRateByMonth,
  formatPct,
  months,
  refundRateByMonth,
  shortMonthLabel,
  tenantBreakdown,
} from "../data/api";
import { formatCount, usd } from "../lib/format";

export default function Bookings() {
  const states = bookingStateTotals();
  const cancelRates = cancellationRateByMonth();
  const refundRates = refundRateByMonth();
  const labels = months().map(shortMonthLabel);
  const breakdown = [...tenantBreakdown()].sort((a, b) => b.bookings12mo - a.bookings12mo);

  const latestCancel = cancelRates[cancelRates.length - 1];
  const latestRefund = refundRates[refundRates.length - 1];

  return (
    <section aria-labelledby="bookings-heading">
      <header className="page-header">
        <h1 id="bookings-heading">Bookings</h1>
        <p className="page-subtitle">
          Platform-wide aggregates over 12 months — no individual customer data
        </p>
      </header>

      <div className="tile-grid">
        <article className="tile">
          <h2 className="tile-label">Total bookings</h2>
          <p className="tile-value">{formatCount(states.total)}</p>
          <p className="tile-caption">trailing 12 months</p>
        </article>
        <article className="tile">
          <h2 className="tile-label">Completed</h2>
          <p className="tile-value">{formatCount(states.completed)}</p>
          <p className="tile-caption">delivered without cancellation or refund</p>
        </article>
        <article className="tile">
          <h2 className="tile-label">Cancelled</h2>
          <p className="tile-value">{formatCount(states.cancelled)}</p>
          <p className="tile-caption">
            {latestCancel ? `${latestCancel.ratePct.toFixed(1)}% rate this month` : "—"}
          </p>
        </article>
        <article className="tile">
          <h2 className="tile-label">Refunded</h2>
          <p className="tile-value">{formatCount(states.refunded)}</p>
          <p className="tile-caption">
            {latestRefund ? `${latestRefund.ratePct.toFixed(1)}% rate this month` : "—"}
          </p>
        </article>
      </div>

      <article className="panel">
        <h2 className="panel-title">Cancellation &amp; refund rates by month</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="swatch" style={{ background: "#d97706" }} aria-hidden="true" /> Cancellation rate
          </span>
          <span className="legend-item">
            <span className="swatch" style={{ background: "#dc2626" }} aria-hidden="true" /> Refund rate
          </span>
        </div>
        <Chart
          variant="line"
          labels={labels}
          formatValue={(v) => `${v.toFixed(1)}%`}
          padLeft={56}
          series={[
            { name: "Cancellation rate", values: cancelRates.map((r) => r.ratePct), color: "#d97706" },
            { name: "Refund rate", values: refundRates.map((r) => r.ratePct), color: "#dc2626" },
          ]}
          ariaLabel={`Line chart of monthly cancellation and refund rates in percent over 12 months, latest cancellation rate ${formatPct(latestCancel?.ratePct ?? null)} and refund rate ${formatPct(latestRefund?.ratePct ?? null)}`}
        />
      </article>

      <article className="panel">
        <h2 className="panel-title">Per-business breakdown (12 months)</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Business</th>
                <th className="num">Bookings</th>
                <th className="num">Cancellations</th>
                <th className="num">Refunds</th>
                <th className="num">Cancel rate</th>
                <th className="num">GMV</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr key={row.tenant.id}>
                  <td>{row.tenant.name}</td>
                  <td className="num">{formatCount(row.bookings12mo)}</td>
                  <td className="num">{formatCount(row.cancellations12mo)}</td>
                  <td className="num">{formatCount(row.refunds12mo)}</td>
                  <td className="num">
                    {row.cancellationRatePct === null ? "—" : `${row.cancellationRatePct.toFixed(1)}%`}
                  </td>
                  <td className="num">{usd(row.gmv12moMinorUnits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
