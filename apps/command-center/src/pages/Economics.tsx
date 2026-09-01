import { Chart } from "../components/Chart";
import {
  averageBookingValueMinorUnits,
  monthlyTotals,
  months,
  platformRevenueByMonth,
  revenueTotals,
  shortMonthLabel,
} from "../data/api";
import { usd } from "../lib/format";

export default function Economics() {
  const totals = monthlyTotals();
  const revenue = platformRevenueByMonth();
  const labels = months().map(shortMonthLabel);
  const avgBooking = averageBookingValueMinorUnits();
  const split = revenueTotals();
  const splitTotal =
    split.subscriptionRevenueMinorUnits + split.transactionRevenueMinorUnits;
  const subSharePct =
    splitTotal === 0 ? null : (split.subscriptionRevenueMinorUnits / splitTotal) * 100;

  return (
    <section aria-labelledby="economics-heading">
      <header className="page-header">
        <h1 id="economics-heading">Economics</h1>
        <p className="page-subtitle">Merchant volume and Lumin revenue, tracked separately</p>
      </header>

      <article className="panel">
        <h2 className="panel-title">GMV vs platform revenue by month</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="swatch" style={{ background: "#0d9488" }} aria-hidden="true" /> GMV (merchant volume)
          </span>
          <span className="legend-item">
            <span className="swatch" style={{ background: "#2563eb" }} aria-hidden="true" /> Platform revenue (Lumin)
          </span>
          <span className="legend-note">GMV is merchant volume, not Lumin revenue — the two are never combined.</span>
        </div>
        <div className="chart-pair">
          <div>
            <h3 className="chart-caption">GMV (merchant volume)</h3>
            <Chart
              variant="bar"
              labels={labels}
              padLeft={92}
              formatValue={(v) => usd(v)}
              series={[{ name: "GMV", values: totals.map((t) => t.gmvMinorUnits), color: "#0d9488" }]}
              ariaLabel="Bar chart of monthly gross merchant volume across all businesses for the last 12 months"
            />
          </div>
          <div>
            <h3 className="chart-caption">Platform revenue (Lumin)</h3>
            <Chart
              variant="bar"
              labels={labels}
              padLeft={92}
              formatValue={(v) => usd(v)}
              series={[
                {
                  name: "Subscription revenue",
                  values: revenue.map((r) => r.subscriptionRevenueMinorUnits),
                  color: "#2563eb",
                },
                {
                  name: "Transaction revenue",
                  values: revenue.map((r) => r.transactionRevenueMinorUnits),
                  color: "#7c3aed",
                },
              ]}
              ariaLabel="Bar chart of monthly Lumin platform revenue split into subscription and transaction revenue for the last 12 months"
            />
            <div className="legend">
              <span className="legend-item">
                <span className="swatch" style={{ background: "#2563eb" }} aria-hidden="true" /> Subscription
              </span>
              <span className="legend-item">
                <span className="swatch" style={{ background: "#7c3aed" }} aria-hidden="true" /> Transaction
              </span>
            </div>
          </div>
        </div>
      </article>

      <div className="tile-grid">
        <article className="tile">
          <h2 className="tile-label">Average booking value</h2>
          <p className="tile-value">{avgBooking === null ? "—" : usd(avgBooking)}</p>
          <p className="tile-caption">GMV / bookings, trailing 12 months</p>
        </article>
        <article className="tile">
          <h2 className="tile-label">Subscription revenue (12mo)</h2>
          <p className="tile-value">{usd(split.subscriptionRevenueMinorUnits)}</p>
          <p className="tile-caption">
            {subSharePct === null ? "—" : `${subSharePct.toFixed(1)}% of platform revenue`}
          </p>
        </article>
        <article className="tile">
          <h2 className="tile-label">Transaction revenue (12mo)</h2>
          <p className="tile-value">{usd(split.transactionRevenueMinorUnits)}</p>
          <p className="tile-caption">
            {subSharePct === null ? "—" : `${(100 - subSharePct).toFixed(1)}% of platform revenue`}
          </p>
        </article>
      </div>
    </section>
  );
}
