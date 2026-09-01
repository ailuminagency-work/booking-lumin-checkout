import { Chart } from "../components/Chart";
import {
  activeTenantCount,
  adapterHealthSnapshots,
  bookingsMoMGrowthPct,
  formatPct,
  gmvMoMGrowthPct,
  latestMonth,
  monthlyTotals,
  months,
  platformRevenueForMonth,
  shortMonthLabel,
  totalsForMonth,
} from "../data/api";
import { formatCount, usd } from "../lib/format";

export default function Overview() {
  const last = latestMonth();
  const current = totalsForMonth(last);
  const revenue = platformRevenueForMonth(last);
  const platformRevenueThisMonth =
    revenue.subscriptionRevenueMinorUnits + revenue.transactionRevenueMinorUnits;
  const totals = monthlyTotals();
  const labels = months().map(shortMonthLabel);
  const bookingsGrowth = bookingsMoMGrowthPct();
  const gmvGrowth = gmvMoMGrowthPct();

  return (
    <section aria-labelledby="overview-heading">
      <header className="page-header">
        <h1 id="overview-heading">Platform overview</h1>
        <p className="page-subtitle">Cross-tenant aggregates · trailing 12 months · no customer data</p>
      </header>

      <div className="tile-grid">
        <article className="tile">
          <h2 className="tile-label">Active businesses</h2>
          <p className="tile-value">{formatCount(activeTenantCount())}</p>
          <p className="tile-caption">on the platform</p>
        </article>
        <article className="tile">
          <h2 className="tile-label">Bookings this month</h2>
          <p className="tile-value">{formatCount(current.bookings)}</p>
          <p className={`tile-caption growth ${bookingsGrowth !== null && bookingsGrowth < 0 ? "down" : "up"}`}>
            {formatPct(bookingsGrowth)} vs last month
          </p>
        </article>
        <article className="tile">
          <h2 className="tile-label">GMV this month</h2>
          <p className="tile-value">{usd(current.gmvMinorUnits)}</p>
          <p className="tile-caption">
            merchant volume — not Lumin revenue · {formatPct(gmvGrowth)} MoM
          </p>
        </article>
        <article className="tile tile-revenue">
          <h2 className="tile-label">Platform revenue this month</h2>
          <p className="tile-value">{usd(platformRevenueThisMonth)}</p>
          <p className="tile-caption">Lumin income (subscriptions + transaction fees)</p>
        </article>
      </div>

      <div className="panel-grid">
        <article className="panel">
          <h2 className="panel-title">Bookings per month</h2>
          <Chart
            variant="bar"
            labels={labels}
            series={[{ name: "Bookings", values: totals.map((t) => t.bookings), color: "#2563eb" }]}
            ariaLabel={`Bar chart of platform-wide bookings per month for the last 12 months, latest ${current.bookings} bookings in ${last}`}
          />
        </article>
        <article className="panel">
          <h2 className="panel-title">GMV per month (merchant volume)</h2>
          <Chart
            variant="line"
            labels={labels}
            padLeft={86}
            formatValue={(v) => usd(v)}
            series={[{ name: "GMV", values: totals.map((t) => t.gmvMinorUnits), color: "#0d9488" }]}
            ariaLabel={`Line chart of gross merchant volume per month for the last 12 months, latest ${usd(current.gmvMinorUnits)} in ${last}`}
          />
        </article>
      </div>

      <article className="panel">
        <h2 className="panel-title">System health</h2>
        <div className="health-strip">
          {adapterHealthSnapshots().map((a) => (
            <span key={a.kind} className={`pill pill-${a.status}`}>
              <span className="pill-dot" aria-hidden="true" />
              {a.kind}: {a.status}
            </span>
          ))}
        </div>
      </article>
    </section>
  );
}
