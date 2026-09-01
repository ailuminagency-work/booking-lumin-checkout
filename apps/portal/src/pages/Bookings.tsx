import { useState } from "react";
import { BookingState, formatMoney } from "@lumin/contracts";
import { BookingDrawer } from "../components/BookingDrawer";
import { usePortal } from "../components/PortalProvider";
import { EmptyState, PageHeader, STATE_LABELS, StateBadge, formatSlot } from "../components/ui";
import { getService, listBookings } from "../data/api";

const FILTER_TABS: Array<BookingState | "all"> = [
  "all",
  "confirmed",
  "pending_payment",
  "completed",
  "cancelled",
  "refunded",
  "failed",
  "draft",
];

export function BookingsPage() {
  const { ctx, store } = usePortal();
  const [stateFilter, setStateFilter] = useState<BookingState | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bookings = listBookings(ctx, { state: stateFilter, search }, store);

  return (
    <div className={selectedId ? "with-drawer" : ""}>
      <div className="page-main">
        <PageHeader title="Bookings" subtitle="Every booking for this business, newest slot first." />

        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter by state">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={stateFilter === tab}
                className={`tab ${stateFilter === tab ? "tab-active" : ""}`}
                onClick={() => setStateFilter(tab)}
              >
                {tab === "all" ? "All" : STATE_LABELS[tab]}
              </button>
            ))}
          </div>
          <label className="search-field">
            <span className="visually-hidden">Search bookings</span>
            <input
              type="search"
              placeholder="Search reference, customer, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        {bookings.length === 0 ? (
          <EmptyState
            title="No bookings match"
            hint={search ? "Try a different search term." : "Bookings in this state will appear here."}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Service</th>
                  <th scope="col">Slot</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr
                    key={b.id}
                    className={selectedId === b.id ? "row-selected" : ""}
                  >
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setSelectedId(b.id)}
                        aria-label={`Open booking ${b.reference}`}
                      >
                        {b.reference}
                      </button>
                    </td>
                    <td>
                      {b.customer.name}
                      <div className="muted">{b.customer.email}</div>
                    </td>
                    <td>{getService(ctx, b.selection.serviceId, store)?.name ?? "—"}</td>
                    <td>{formatSlot(b.slotStart, b.slotEnd)}</td>
                    <td>
                      <StateBadge state={b.state} />
                    </td>
                    <td className="num">{formatMoney(b.pricing.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedId ? <BookingDrawer bookingId={selectedId} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}
