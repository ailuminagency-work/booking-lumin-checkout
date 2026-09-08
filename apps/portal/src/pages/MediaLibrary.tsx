import { MOBILE_OPTIMIZATION_NOTE } from "@lumin/media";
import { PageHeader } from "../components/ui";
import { portalMediaLibrary } from "../data/media";

/** Mock media library view (via @lumin/media). */
export function MediaLibraryPage() {
  return (
    <div>
      <PageHeader
        title="Media Library"
        subtitle="Tenant images and their responsive variant plan (mock storage, no processing)."
      />
      <p className="muted">{MOBILE_OPTIMIZATION_NOTE}</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Dimensions</th>
              <th scope="col" className="num">
                Responsive variants
              </th>
              <th scope="col">Storage key</th>
            </tr>
          </thead>
          <tbody>
            {portalMediaLibrary.map((e) => (
              <tr key={e.asset.id} data-testid={`asset-${e.asset.id}`}>
                <td>{e.label}</td>
                <td>
                  {e.asset.width}×{e.asset.height}
                </td>
                <td className="num" data-testid={`variants-${e.asset.id}`}>
                  {e.variantCount}
                </td>
                <td>
                  <code>{e.asset.storageKey}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
