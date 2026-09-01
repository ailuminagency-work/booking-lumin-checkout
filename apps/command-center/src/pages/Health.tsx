import { Chart } from "../components/Chart";
import {
  adapterHealthSnapshots,
  apiFailureRateByMonth,
  months,
  recentFailures,
  shortMonthLabel,
} from "../data/api";
import { formatCount, formatTimestamp } from "../lib/format";

export default function Health() {
  const adapters = adapterHealthSnapshots();
  const failureRates = apiFailureRateByMonth();
  const labels = months().map(shortMonthLabel);
  const failures = recentFailures();
  const latestRate = failureRates[failureRates.length - 1];

  return (
    <section aria-labelledby="health-heading">
      <header className="page-header">
        <h1 id="health-heading">System health</h1>
        <p className="page-subtitle">Integration adapters, API reliability, and recent failures</p>
      </header>

      <div className="tile-grid">
        {adapters.map((a) => (
          <article key={a.kind} className={`tile adapter-card adapter-${a.status}`}>
            <h2 className="tile-label">{a.kind} adapter</h2>
            <p className="tile-value">
              <span className={`pill pill-${a.status}`}>
                <span className="pill-dot" aria-hidden="true" />
                {a.status}
              </span>
            </p>
            <p className="tile-caption">
              {a.provider} · {formatCount(a.errorCount24h)} errors (24h) · p95{" "}
              {formatCount(a.p95LatencyMs)} ms
            </p>
          </article>
        ))}
      </div>

      <article className="panel">
        <h2 className="panel-title">API failure rate by month</h2>
        <Chart
          variant="line"
          labels={labels}
          formatValue={(v) => `${v.toFixed(2)}%`}
          padLeft={56}
          series={[
            {
              name: "API failure rate",
              values: failureRates.map((r) => r.ratePct),
              color: "#dc2626",
            },
          ]}
          ariaLabel={`Line chart of monthly API failure rate in percent over 12 months, latest ${latestRate ? latestRate.ratePct.toFixed(2) : "0"} percent`}
        />
      </article>

      <article className="panel">
        <h2 className="panel-title">Recent failures</h2>
        <p className="panel-note">
          Last {failures.length} platform failures. Booking references only — customer identity is
          never surfaced here.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Business</th>
                <th>Type</th>
                <th>Code</th>
                <th>Booking ref</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id} className={`sev-row-${f.severity}`}>
                  <td>{formatTimestamp(f.timestamp)}</td>
                  <td>{f.tenantName}</td>
                  <td>{f.kind.replace(/_/g, " ")}</td>
                  <td>
                    <code className="code-chip">{f.code}</code>
                  </td>
                  <td>{f.bookingReference ?? "—"}</td>
                  <td>
                    <span className={`pill sev-${f.severity}`}>
                      <span className="pill-dot" aria-hidden="true" />
                      {f.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
