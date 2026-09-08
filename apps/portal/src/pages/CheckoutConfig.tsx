import { useState } from "react";
import { createWorkflowEngine } from "@lumin/workflow";
import { usePortal } from "../components/PortalProvider";
import { PageHeader } from "../components/ui";
import { getCheckoutSettings, getService, getTenant, updateCheckoutSettings } from "../data/api";
import { PREVIEW_QUESTION_ID, PREVIEW_SERVICE_ID, previewFlow } from "../data/workflows";

const workflowEngine = createWorkflowEngine();

export function CheckoutConfigPage() {
  const { ctx, store } = usePortal();
  const tenant = getTenant(ctx, store);
  const settings = getCheckoutSettings(ctx, store);
  const [copied, setCopied] = useState(false);

  // Workflow preview: the conditional question flow a customer would see.
  const previewService = getService(ctx, PREVIEW_SERVICE_ID, store);
  const previewQuestion = previewService?.questions.find((q) => q.id === PREVIEW_QUESTION_ID) ?? null;
  const [sampleChoice, setSampleChoice] = useState<string | null>(null);
  const previewAnswers = sampleChoice ? { [PREVIEW_QUESTION_ID]: sampleChoice } : {};
  const flowState = workflowEngine.nextState(previewFlow, previewAnswers);

  const embedSnippet = `<script\n  src="https://cdn.bookinglumin.example/checkout/v1.js"\n  data-tenant="${tenant.id}"\n  async\n></script>`;

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Checkout Configuration"
        subtitle="Branding for the customer-facing checkout, applied live to the preview."
      />

      <div className="checkout-config-grid">
        <section className="panel" aria-label="Branding">
          <div className="panel-header">
            <h2>Branding</h2>
          </div>
          <div className="form-stack">
            <label className="field">
              <span>Business name</span>
              <input
                type="text"
                value={settings.businessName}
                onChange={(e) => updateCheckoutSettings(ctx, { businessName: e.target.value }, store)}
              />
            </label>
            <label className="field">
              <span>Logo text</span>
              <input
                type="text"
                maxLength={3}
                value={settings.logoText}
                onChange={(e) => updateCheckoutSettings(ctx, { logoText: e.target.value.toUpperCase() }, store)}
              />
            </label>
            <label className="field">
              <span>Accent color</span>
              <span className="color-row">
                <input
                  type="color"
                  value={settings.accentColor}
                  onChange={(e) => updateCheckoutSettings(ctx, { accentColor: e.target.value }, store)}
                  aria-label="Accent color"
                />
                <code>{settings.accentColor}</code>
              </span>
            </label>
          </div>
        </section>

        <section className="panel" aria-label="Checkout preview">
          <div className="panel-header">
            <h2>Live preview</h2>
          </div>
          <div
            className="checkout-preview"
            style={{ ["--preview-accent" as string]: settings.accentColor }}
            data-testid="checkout-preview"
          >
            <div className="preview-header">
              <span className="preview-logo">{settings.logoText || "•"}</span>
              <span className="preview-name">{settings.businessName || "Your business"}</span>
            </div>
            <div className="preview-body">
              <div className="preview-line">
                <span>Standard Consultation</span>
                <span>$95.00</span>
              </div>
              <div className="preview-line preview-muted">
                <span>Tue, Sep 8 · 10:00 AM</span>
              </div>
              <button type="button" className="preview-cta" disabled>
                Book &amp; pay
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="panel" aria-label="Question flow preview">
        <div className="panel-header">
          <h2>Question flow preview</h2>
        </div>
        <p className="muted">
          Preview the @lumin/workflow flow a customer sees for{" "}
          <strong>{previewService?.name ?? "this service"}</strong>. Pick a sample answer to see
          conditional recommendations and warnings.
        </p>
        {previewQuestion ? (
          <div className="flow-preview" data-testid="flow-preview">
            <div className="tabs" role="group" aria-label="Sample answer">
              <button
                type="button"
                className={`tab ${sampleChoice === null ? "tab-active" : ""}`}
                onClick={() => setSampleChoice(null)}
              >
                No answer
              </button>
              {previewQuestion.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`tab ${sampleChoice === c.id ? "tab-active" : ""}`}
                  onClick={() => setSampleChoice(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <ul className="plain-list">
              <li data-testid="flow-visible-count">
                Visible steps: {flowState.visibleSteps.length}
              </li>
              <li data-testid="flow-required">
                Awaiting required answer: {flowState.requiredUnanswered.length > 0 ? "yes" : "no"}
              </li>
              {flowState.warnings.map((w) => (
                <li key={w.stepKey} className="flow-warning" data-testid="flow-warning">
                  {w.message}
                </li>
              ))}
              {flowState.recommendations.map((r) => (
                <li key={r.stepKey} className="flow-reco" data-testid="flow-reco">
                  {r.text}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">No configurable service available to preview.</p>
        )}
      </section>

      <section className="panel" aria-label="Embed snippet">
        <div className="panel-header">
          <h2>Embed on your site</h2>
          <button type="button" className="btn btn-secondary" onClick={copySnippet}>
            {copied ? "Copied ✓" : "Copy snippet"}
          </button>
        </div>
        <pre className="code-block">
          <code>{embedSnippet}</code>
        </pre>
        <p className="muted">
          Paste this before <code>&lt;/body&gt;</code>. The <code>data-tenant</code> attribute scopes the checkout to
          this business only.
        </p>
      </section>
    </div>
  );
}
