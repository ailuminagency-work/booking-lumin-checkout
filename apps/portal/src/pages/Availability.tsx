import { usePortal } from "../components/PortalProvider";
import { EmptyState, PageHeader, WEEKDAY_NAMES, minuteLabel } from "../components/ui";
import {
  getService,
  getSchedulingPolicy,
  listAvailabilityOverrides,
  listAvailabilityRules,
} from "../data/api";

/** The visualized day spans 7:00–20:00; blocks are positioned by minute. */
const GRID_START = 420;
const GRID_END = 1200;
const GRID_SPAN = GRID_END - GRID_START;

export function AvailabilityPage() {
  const { ctx, store } = usePortal();
  const rules = listAvailabilityRules(ctx, store);
  const overrides = listAvailabilityOverrides(ctx, store);
  const policy = getSchedulingPolicy(ctx, store);

  return (
    <div>
      <PageHeader
        title="Availability"
        subtitle="Weekly booking windows in the business timezone. Availability always fails closed."
      />

      <section className="panel" aria-label="Scheduling policy">
        <div className="panel-header">
          <h2>Policy</h2>
        </div>
        <dl className="policy-grid">
          <div>
            <dt>Lead time</dt>
            <dd>{policy.leadTimeMinutes} minutes</dd>
          </div>
          <div>
            <dt>Booking horizon</dt>
            <dd>{policy.horizonDays} days</dd>
          </div>
          <div>
            <dt>Slot interval</dt>
            <dd>{policy.slotIntervalMinutes} minutes</dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-label="Weekly availability grid">
        <div className="panel-header">
          <h2>Weekly windows</h2>
        </div>
        {rules.length === 0 ? (
          <EmptyState title="No availability rules" hint="Without rules, no slots are offered (fail closed)." />
        ) : (
          <div className="table-wrap">
            <div className="week-grid" role="img" aria-label="Weekly availability windows by day">
              {WEEKDAY_NAMES.map((name, weekday) => {
                const dayRules = rules.filter((r) => r.weekday === weekday);
                return (
                  <div key={name} className="week-day">
                    <div className="week-day-name">{name.slice(0, 3)}</div>
                    <div className="week-day-track">
                      {dayRules.map((r) => {
                        const top = ((Math.max(r.startMinute, GRID_START) - GRID_START) / GRID_SPAN) * 100;
                        const height =
                          ((Math.min(r.endMinute, GRID_END) - Math.max(r.startMinute, GRID_START)) / GRID_SPAN) * 100;
                        const serviceName = r.serviceId ? getService(ctx, r.serviceId, store)?.name : null;
                        return (
                          <div
                            key={r.id}
                            className={`window-block ${r.serviceId ? "window-service" : ""}`}
                            style={{ top: `${top}%`, height: `${height}%` }}
                            title={`${minuteLabel(r.startMinute)}–${minuteLabel(r.endMinute)} · capacity ${r.capacity}`}
                          >
                            <span className="window-time">
                              {minuteLabel(r.startMinute)}–{minuteLabel(r.endMinute)}
                            </span>
                            <span className="window-cap">cap {r.capacity}</span>
                            {serviceName ? <span className="window-svc">{serviceName}</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-label="Date overrides">
        <div className="panel-header">
          <h2>Date overrides</h2>
        </div>
        {overrides.length === 0 ? (
          <EmptyState title="No overrides" hint="Closed days and special hours appear here." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Window</th>
                  <th scope="col" className="num">
                    Capacity
                  </th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id}>
                    <td>{o.date}</td>
                    <td>
                      <span className={`badge override-${o.kind}`}>{o.kind === "closed" ? "Closed" : "Special hours"}</span>
                    </td>
                    <td>
                      {o.kind === "open" && o.startMinute !== undefined && o.endMinute !== undefined
                        ? `${minuteLabel(o.startMinute)}–${minuteLabel(o.endMinute)}`
                        : "—"}
                    </td>
                    <td className="num">{o.capacity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
