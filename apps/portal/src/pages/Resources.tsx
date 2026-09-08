import { effectiveCapacity, resourceAvailability } from "@lumin/resources";
import { PageHeader } from "../components/ui";
import {
  SAMPLE_NOW,
  SAMPLE_SLOT,
  portalReservations,
  portalResources,
} from "../data/resources";

const KIND_LABELS: Record<string, string> = {
  vehicle: "Vehicle",
  crew: "Crew",
  technician: "Technician",
  trailer: "Trailer",
  equipment: "Equipment",
  room: "Room",
  generic: "Generic",
};

/** Resource management view (mock, via @lumin/resources). */
export function ResourcesPage() {
  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Bookable units and pools. Exclusive units are capacity 1; pools carry N."
      />
      <p className="muted">
        Availability shown for a sample slot ({SAMPLE_SLOT.start.slice(0, 16).replace("T", " ")} UTC).
        The database is authoritative at runtime; this preview composes the same overlap semantics.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Resource</th>
              <th scope="col">Kind</th>
              <th scope="col">Mode</th>
              <th scope="col" className="num">
                Capacity
              </th>
              <th scope="col" className="num">
                Available (sample slot)
              </th>
            </tr>
          </thead>
          <tbody>
            {portalResources.map((r) => {
              const capacity = effectiveCapacity(r);
              const remaining = resourceAvailability(r, portalReservations, SAMPLE_SLOT, SAMPLE_NOW);
              return (
                <tr key={r.id} data-testid={`resource-${r.id}`}>
                  <td>{r.name}</td>
                  <td>{KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td>{r.mode === "exclusive" ? "Exclusive" : "Pooled"}</td>
                  <td className="num">{capacity}</td>
                  <td className="num" data-testid={`avail-${r.id}`}>
                    {remaining}/{capacity}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
