import { formatMoney } from "@lumin/contracts";
import { Link, useParams } from "react-router-dom";
import { usePortal } from "../components/PortalProvider";
import { EmptyState, PageHeader } from "../components/ui";
import { getService, listServices, servicePriceFrom, setServiceActive } from "../data/api";

const ARCHETYPE_LABELS = {
  simple: "Simple",
  cart: "Cart",
  configurable: "Configurable",
  rental: "Rental",
} as const;

export function ServicesPage() {
  const { ctx, store } = usePortal();
  const services = listServices(ctx, store);

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="What customers can book. Archetypes are flow presets over one shared service model."
      />
      {services.length === 0 ? (
        <EmptyState title="No services configured" hint="Service creation ships with the backend." />
      ) : (
        <div className="card-grid">
          {services.map((s) => (
            <article key={s.id} className={`service-card ${s.active ? "" : "service-inactive"}`}>
              <div className="service-card-top">
                <span className={`badge archetype-${s.archetype}`}>{ARCHETYPE_LABELS[s.archetype]}</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => setServiceActive(ctx, s.id, e.target.checked, store)}
                    aria-label={`${s.name} active`}
                  />
                  <span className="toggle-track" aria-hidden="true" />
                  <span className="toggle-label">{s.active ? "Active" : "Inactive"}</span>
                </label>
              </div>
              <h2 className="service-name">
                <Link to={`/services/${s.id}`}>{s.name}</Link>
              </h2>
              <p className="muted service-desc">{s.description || "No description."}</p>
              <div className="service-card-bottom">
                <span className="service-price">
                  from <strong>{formatMoney(servicePriceFrom(s))}</strong>
                </span>
                <span className="muted">{s.durationMinutes} min</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function ServiceDetailPage() {
  const { ctx, store } = usePortal();
  const { serviceId } = useParams();
  const service = serviceId ? getService(ctx, serviceId, store) : null;

  if (!service) {
    return (
      <div>
        <PageHeader title="Service not found" />
        <p>
          <Link to="/services">← Back to services</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={service.name} subtitle={service.description || undefined}>
        <Link className="btn btn-secondary" to="/services">
          ← All services
        </Link>
      </PageHeader>

      <p className="note-banner" role="note">
        Read-only preview — service editing ships with the backend.
      </p>

      <dl className="drawer-meta detail-meta">
        <div>
          <dt>Archetype</dt>
          <dd>
            <span className={`badge archetype-${service.archetype}`}>{ARCHETYPE_LABELS[service.archetype]}</span>
          </dd>
        </div>
        <div>
          <dt>Base price</dt>
          <dd>{formatMoney({ amount: service.basePrice, currency: service.currency })}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{service.durationMinutes} minutes</dd>
        </div>
        <div>
          <dt>Tax rate</dt>
          <dd>{service.taxRateBp} bp</dd>
        </div>
      </dl>

      {service.items.length > 0 ? (
        <section className="panel" aria-label="Items">
          <div className="panel-header">
            <h2>Items</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">
                    Unit price
                  </th>
                  <th scope="col" className="num">
                    Qty range
                  </th>
                </tr>
              </thead>
              <tbody>
                {service.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td className="num">{formatMoney({ amount: it.unitPrice, currency: service.currency })}</td>
                    <td className="num">
                      {it.minQty}–{it.maxQty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {service.addons.length > 0 ? (
        <section className="panel" aria-label="Add-ons">
          <div className="panel-header">
            <h2>Add-ons</h2>
          </div>
          <ul className="plain-list">
            {service.addons.map((ad) => (
              <li key={ad.id}>
                {ad.name} — {formatMoney({ amount: ad.price, currency: service.currency })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {service.questions.length > 0 ? (
        <section className="panel" aria-label="Questions">
          <div className="panel-header">
            <h2>Questions</h2>
          </div>
          <ul className="plain-list">
            {service.questions.map((q) => (
              <li key={q.id}>
                <strong>{q.prompt}</strong> <span className="muted">({q.kind.replace("_", " ")}{q.required ? ", required" : ""})</span>
                {q.choices.length > 0 ? (
                  <ul className="plain-list nested">
                    {q.choices.map((c) => (
                      <li key={c.id}>
                        {c.label}
                        {c.priceDelta !== 0
                          ? ` · +${formatMoney({ amount: c.priceDelta, currency: service.currency })}`
                          : ""}
                        {c.priceMultiplierBp !== 10000 ? ` · ×${c.priceMultiplierBp} bp` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {q.kind === "quantity" && q.unitPrice !== undefined ? (
                  <span className="muted">
                    {" "}
                    {formatMoney({ amount: q.unitPrice, currency: service.currency })} per unit
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {service.rental ? (
        <section className="panel" aria-label="Rental configuration">
          <div className="panel-header">
            <h2>Rental</h2>
          </div>
          <dl className="drawer-meta detail-meta">
            <div>
              <dt>Period</dt>
              <dd>{service.rental.periodMinutes} min</dd>
            </div>
            <div>
              <dt>Price / period</dt>
              <dd>{formatMoney({ amount: service.rental.pricePerPeriod, currency: service.currency })}</dd>
            </div>
            <div>
              <dt>Periods</dt>
              <dd>
                {service.rental.minPeriods}–{service.rental.maxPeriods}
              </dd>
            </div>
            <div>
              <dt>Deposit</dt>
              <dd>{formatMoney({ amount: service.rental.depositAmount, currency: service.currency })}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
