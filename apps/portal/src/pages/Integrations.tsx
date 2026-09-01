import type { IntegrationKind } from "@lumin/contracts";
import { usePortal } from "../components/PortalProvider";
import { PageHeader } from "../components/ui";
import { listIntegrations } from "../data/api";

const KIND_META: Record<IntegrationKind, { title: string; blurb: string }> = {
  payment: { title: "Payment", blurb: "Charge customers at checkout." },
  calendar: { title: "Calendar", blurb: "Sync confirmed bookings to a calendar." },
  notification: { title: "Notification", blurb: "Email / SMS confirmations and reminders." },
  webhook: { title: "Webhook", blurb: "Push booking events to your own systems." },
};

const PROVIDER_LABELS: Record<string, string> = {
  mock: "Mock Provider",
  stripe: "Stripe",
  mercado_pago: "Mercado Pago",
  mollie: "Mollie",
  google_calendar: "Google Calendar",
  email_smtp: "Email (SMTP)",
  sms_gateway: "SMS Gateway",
  custom_endpoint: "Custom Endpoint",
};

const KIND_ORDER: IntegrationKind[] = ["payment", "calendar", "notification", "webhook"];

export function IntegrationsPage() {
  const { ctx, store } = usePortal();
  const connections = listIntegrations(ctx, store);

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Every connection starts NOT CONNECTED — no inherited credentials, ever."
      />
      <p className="note-banner" role="note">
        Connections are enabled after security gates pass (SI-13). Development runs entirely on mock providers.
      </p>

      {KIND_ORDER.map((kind) => {
        const group = connections.filter((c) => c.kind === kind);
        return (
          <section key={kind} className="panel" aria-label={`${KIND_META[kind].title} integrations`}>
            <div className="panel-header">
              <h2>{KIND_META[kind].title}</h2>
              <span className="muted">{KIND_META[kind].blurb}</span>
            </div>
            <div className="integration-grid">
              {group.map((c) => (
                <article key={c.id} className="integration-card">
                  <div className="integration-top">
                    <h3>{PROVIDER_LABELS[c.provider] ?? c.provider}</h3>
                    <span className={`pill pill-${c.status}`}>
                      {c.status === "not_connected" ? "Not connected" : c.status}
                    </span>
                  </div>
                  {c.provider === "mock" ? (
                    <p className="muted">Available in development — no external credentials required.</p>
                  ) : (
                    <p className="muted">Connects per-tenant; credentials never reach the browser.</p>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled
                    aria-disabled="true"
                    title="Connections are enabled after security gates pass"
                  >
                    Connect
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
