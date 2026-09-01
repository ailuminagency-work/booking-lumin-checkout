import { usePortal } from "../components/PortalProvider";
import { PageHeader } from "../components/ui";
import { getTenant, listMembers, updateTenantSettings } from "../data/api";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "BRL", "JPY"] as const;

export function SettingsPage() {
  const { ctx, store } = usePortal();
  const tenant = getTenant(ctx, store);
  const members = listMembers(ctx, store);

  return (
    <div>
      <PageHeader title="Business Settings" subtitle="Identity, locale, and team for this business." />

      <section className="panel" aria-label="Business identity">
        <div className="panel-header">
          <h2>Business</h2>
        </div>
        <div className="form-stack settings-form">
          <label className="field">
            <span>Business name</span>
            <input
              type="text"
              value={tenant.name}
              onChange={(e) => updateTenantSettings(ctx, { name: e.target.value }, store)}
            />
          </label>
          <label className="field">
            <span>Timezone (IANA)</span>
            <select
              value={tenant.timezone}
              onChange={(e) => updateTenantSettings(ctx, { timezone: e.target.value }, store)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
              {TIMEZONES.includes(tenant.timezone as (typeof TIMEZONES)[number]) ? null : (
                <option value={tenant.timezone}>{tenant.timezone}</option>
              )}
            </select>
          </label>
          <label className="field">
            <span>Currency (ISO 4217)</span>
            <select
              value={tenant.currency}
              onChange={(e) => updateTenantSettings(ctx, { currency: e.target.value }, store)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {CURRENCIES.includes(tenant.currency as (typeof CURRENCIES)[number]) ? null : (
                <option value={tenant.currency}>{tenant.currency}</option>
              )}
            </select>
          </label>
          <div className="field">
            <span>Tenant ID</span>
            <output className="readonly-value" aria-label="Tenant ID (read-only)">
              <code>{tenant.id}</code>
            </output>
          </div>
        </div>
      </section>

      <section className="panel" aria-label="Team members">
        <div className="panel-header">
          <h2>Members</h2>
          <span className="muted">Tenant roles are distinct from platform roles (SI-9).</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>
                    <span className={`badge role-${m.role.toLowerCase()}`}>
                      {m.role === "BUSINESS_OWNER" ? "Owner" : "Staff"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
