import { useMemo, useState } from "react";
import { Chart } from "../components/Chart";
import { tenantDirectory, type TenantDirectoryRow } from "../data/api";
import { formatCount, formatDate, usd } from "../lib/format";

type SortKey = "name" | "status" | "bookings30d" | "gmv30d" | "joined";
type StatusFilter = "all" | "active" | "inactive";

const sortValue = (row: TenantDirectoryRow, key: SortKey): string | number => {
  switch (key) {
    case "name":
      return row.tenant.name.toLowerCase();
    case "status":
      return row.tenant.status;
    case "bookings30d":
      return row.bookings30d;
    case "gmv30d":
      return row.gmv30dMinorUnits;
    case "joined":
      return row.tenant.joinedAt;
  }
};

export default function Businesses() {
  const [sortKey, setSortKey] = useState<SortKey>("gmv30d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const rows = useMemo(() => {
    const all = tenantDirectory().filter(
      (r) => filter === "all" || r.tenant.status === filter,
    );
    return [...all].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [sortKey, sortDir, filter]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const headers: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
    { key: "name", label: "Business" },
    { key: "status", label: "Status" },
    { key: "bookings30d", label: "Bookings (30d)", numeric: true },
    { key: "gmv30d", label: "GMV (30d)", numeric: true },
    { key: "joined", label: "Joined" },
  ];

  return (
    <section aria-labelledby="businesses-heading">
      <header className="page-header">
        <h1 id="businesses-heading">Businesses</h1>
        <p className="page-subtitle">Tenant directory — usage aggregates only</p>
      </header>

      <div className="toolbar" role="group" aria-label="Filter businesses by status">
        {(["all", "active", "inactive"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-btn ${filter === f ? "is-active" : ""}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "active" ? "Active" : "Inactive"}
          </button>
        ))}
        <span className="toolbar-note">{rows.length} shown</span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h.key} className={h.numeric ? "num" : undefined} aria-sort={
                  h.key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }>
                  <button type="button" className="th-sort" onClick={() => toggleSort(h.key)}>
                    {h.label}
                    {sortIndicator(h.key)}
                  </button>
                </th>
              ))}
              <th>12-month trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenant.id}>
                <td>
                  <span className="tenant-name">{r.tenant.name}</span>
                  <span className="tenant-slug">{r.tenant.slug}</span>
                </td>
                <td>
                  <span className={`pill pill-${r.tenant.status === "active" ? "ok" : "muted"}`}>
                    <span className="pill-dot" aria-hidden="true" />
                    {r.tenant.status}
                  </span>
                </td>
                <td className="num">{formatCount(r.bookings30d)}</td>
                <td className="num">{usd(r.gmv30dMinorUnits)}</td>
                <td>{formatDate(r.tenant.joinedAt)}</td>
                <td>
                  <Chart
                    variant="sparkline"
                    series={[{ name: "Bookings", values: r.bookingsSeries, color: "#2563eb" }]}
                    ariaLabel={`Sparkline of monthly bookings for ${r.tenant.name} over 12 months, latest ${r.bookings30d}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
