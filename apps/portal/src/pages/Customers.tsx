import { useState } from "react";
import { formatMoney } from "@lumin/contracts";
import { usePortal } from "../components/PortalProvider";
import { EmptyState, PageHeader, StateBadge, formatSlot } from "../components/ui";
import {
  customerLifetimeValue,
  getCustomer,
  getService,
  listCustomerBookings,
  listCustomers,
} from "../data/api";

export function CustomersPage() {
  const { ctx, store } = usePortal();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const customers = listCustomers(ctx, store);
  const selected = selectedId ? getCustomer(ctx, selectedId, store) : null;

  return (
    <div className={selected ? "with-drawer" : ""}>
      <div className="page-main">
        <PageHeader title="Customers" subtitle={`${customers.length} customers have booked with this business.`} />

        {customers.length === 0 ? (
          <EmptyState title="No customers yet" hint="Customers appear after their first checkout." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col" className="num">
                    Bookings
                  </th>
                  <th scope="col" className="num">
                    Lifetime value
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const bookingCount = listCustomerBookings(ctx, c.id, store).length;
                  return (
                    <tr key={c.id} className={selectedId === c.id ? "row-selected" : ""}>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setSelectedId(c.id)}
                          aria-label={`Open customer ${c.details.name}`}
                        >
                          {c.details.name}
                        </button>
                      </td>
                      <td>{c.details.email}</td>
                      <td>{c.details.phone ?? "—"}</td>
                      <td className="num">{bookingCount}</td>
                      <td className="num">{formatMoney(customerLifetimeValue(ctx, c.id, store))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? (
        <aside className="drawer" role="dialog" aria-modal="false" aria-label={`Customer ${selected.details.name}`}>
          <div className="drawer-header">
            <div>
              <h2 className="drawer-title">{selected.details.name}</h2>
              <span className="muted">{selected.details.email}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelectedId(null)}
              aria-label="Close customer detail"
            >
              ✕
            </button>
          </div>
          <dl className="drawer-meta">
            <div>
              <dt>Phone</dt>
              <dd>{selected.details.phone ?? "—"}</dd>
            </div>
            <div>
              <dt>Lifetime value</dt>
              <dd>{formatMoney(customerLifetimeValue(ctx, selected.id, store))}</dd>
            </div>
          </dl>
          <section aria-label="Customer bookings">
            <h3>Bookings</h3>
            {listCustomerBookings(ctx, selected.id, store).length === 0 ? (
              <p className="muted">No bookings yet.</p>
            ) : (
              <ul className="upcoming-list">
                {listCustomerBookings(ctx, selected.id, store).map((b) => (
                  <li key={b.id}>
                    <div>
                      <span className="upcoming-ref">{b.reference}</span>
                      <div className="muted">
                        {getService(ctx, b.selection.serviceId, store)?.name ?? "—"} ·{" "}
                        {formatSlot(b.slotStart, b.slotEnd)}
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
        </aside>
      ) : null}
    </div>
  );
}
