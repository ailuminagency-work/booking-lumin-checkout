# Command Center specification

**Status: PROPOSED — pending user review of the complete nine-document master product package.**

Documentation only. No implementation, deployment, provider connection, migration or release is authorized by this specification. The Program Governor owns the master product/workstream plan; this document defines P26 with dependencies on P17, P22, P23, P27 and P28.

## 1. Purpose and protected foundation

Lumin Command Center is the private platform operations surface. It helps authorized platform staff understand business adoption, platform subscriptions, merchant activity and operational incidents. It is not an unrestricted customer-record browser and does not give platform administrators tenant operating permissions.

Audited repository snapshot: `fb98a7b9feaadb429ca7656430590d790d394a1a`. Source root: `C:/Users/fligh/Documents/Codex/2026-09-08/continue-the-booking-lumin-checkout-engineering/work/repo`. Paths in the evidence appendix are relative to that exact root.

Accepted RC-2 foundation remains commit `6bbcd679a09741d3a2e978ddd2bb398f1d98a6f9`; current code is a later candidate. Root reports main `152bb90` protected and candidate CI `34380365813` successful. Those are separate facts from live product capability. Historical repository prose about absent protection or a baseline tag must not override current evidence: the named tag is absent; use the exact baseline commit. Preserve B1–B6 and R1–R9. RISK-4 financial/audit raw access and RUNTIME-04 full authenticated HTTPS isolation certification remain open. Anonymous catalog/draft transport evidence does not certify administrator or business sign-in.

## 2. What exists today

| Surface | Current implementation | What it does not establish |
|---|---|---|
| Mock Command Center | Five routes: root Overview, Businesses, Bookings, Economics, Health. Selectors read `PLATFORM_DATASET` fixtures. | Business/financial charts and health samples are not production measurements. |
| Connected Command Center | `VITE_RUNTIME_MODE=supabase` returns a separate component before the mock route shell. It signs in, verifies platform identity and reads four named aggregate views. | The eleven-page target navigation does not exist in connected mode; successful real admin sign-in is not certified. |
| Live aggregate contracts | `platform_business_stats`, `platform_booking_stats`, `platform_economics`, `platform_integration_health`; connected screen uses a fixed column allowlist and caps each view at 1,000 rows. | Billing revenue fields are schema placeholders. Connection row status is not provider availability evidence. No current live operational incident console. |
| Telemetry primitives | `@lumin/observability` models allowlisted counters/statuses in memory; `@lumin/realtime` models bounded delivery/retry. | No production collector, durable event outbox, authenticated stream or real incident pipeline. |

Build one route shell with explicit mock/live data adapters after approval. Do not maintain a polished mock navigation and a separate impoverished live product. Every page must render its actual source, freshness and unavailable state consistently.

## 3. Proposed navigation and route information architecture

Mount remains `/command-center/`; all routes require verified platform authorization. The root opens Overview; `/command-center/overview` may redirect to it. Existing `/economics` becomes a compatibility redirect to `/financials` after route tests pass.

| Navigation | Proposed route | Primary content and actions | Dependency |
|---|---|---|---|
| Overview | `/command-center/` | Active/trial/past-due/suspended business counts, new businesses, booking activity, platform revenue summary and current incidents; drill into authorized aggregates. | Shared metric definitions; aggregate read API. |
| Businesses | `/command-center/businesses` | Business directory with country, lifecycle and billing badges; provider distribution and per-business operational summary. Detail `/businesses/:tenantId`. | Tenant catalog and minimized tenant-health read model. |
| Subscriptions | `/command-center/subscriptions` | Plans, trials, active/past-due/canceled subscriptions, add-ons, scheduled changes and payment collection state for Lumin billing. | P17 BillingProvider, entitlements and billing events. |
| Usage | `/command-center/usage` | Metered usage versus entitlement by business, plan and period; completeness/watermark; invoice linkage when available. | Meter contract, deduplication and period rules. |
| Bookings | `/command-center/bookings` | Counts and trends by state, business, country and service type; cancellation and completion rates. No default customer names, addresses or contact data. | Booking events and privacy-reviewed aggregates. |
| Financials | `/command-center/financials` | Separate platform revenue and merchant activity sections, explicit currency/time basis, refund and payment-success analytics. | P16 merchant ledger plus P17 platform ledger. |
| Integrations | `/command-center/integrations` | Capability/connection inventory, last successful sync, recorded errors and certification status per provider/domain. No secret viewer. | Connection and operation-health contracts. |
| Health | `/command-center/health` | API, database, Auth, Realtime, Storage, Render, Netlify, Edge Functions, provider and queue observations. | P27 collection, freshness rules and scoped probes. |
| Incidents | `/command-center/incidents` | Open/resolved incident timeline, affected components/business counts, owner and remediation progress. Acknowledge/resolve only through authorized actions. | Incident contract, audit and Action API. |
| Infrastructure | `/command-center/infrastructure` | Environment, deploy SHA/artifact, migration version, process/worker readiness and service links; no credentials. | Deployment/worker evidence adapters. |
| Security | `/command-center/security` | Access-policy findings, RLS/Auth checks, audit integrity, denied actions and open security risks with evidence. | P28 security read model and scoped audit access. |

A business detail page is a minimized operational overview, not impersonation. Link a separately authorized business session only if the person independently possesses the required tenant role. No automatic tenant-write escalation from PLATFORM_ADMIN.

## 4. Metric semantics

Every metric response carries `metricId`, `definitionVersion`, `source`, `environment`, `periodStart`, `periodEnd`, `timezone`, `observedAt`, `watermark`, `coverage`, and optional `currency`. Definitions must precede charts. Missing data is unknown, not zero. Genuine zero requires a complete observation window.

**Business counts.** Tenant lifecycle and subscription lifecycle are separate dimensions. Current Tenant status supports active/inactive/suspended; current billing models have trialing/active/past_due/canceled. A trial or past-due business badge is a join onto billing, not an invented tenant state. Counts may overlap unless the UI explicitly selects mutually exclusive segmentation. Country distribution needs a maintained business country field and an Unknown bucket; never infer country from currency, timezone or browser locale. New-business counts use tenant creation time; active-business counts require an agreed lifecycle or activity definition.

**Lumin platform revenue.** MRR/ARR derive only from normalized recurring platform subscriptions and recurring add-ons under a versioned definition; exclude merchant GMV and one-off usage charges from recurring measures. Display annualized ARR assumptions. Track active subscriptions, trials, cancellations, past-due balances, usage charges and add-on revenue separately. No provider-connected ledger means Not connected/Unavailable, not a fabricated zero revenue chart. Cash collected and recognized/accrued revenue are different measures; do not label one as the other.

**Merchant activity.** GMV is gross successful captured merchant payment volume by settlement/capture period and currency; refunds are separate, with an optional explicitly defined net-volume metric. AOV uses eligible captured booking payments and a matching eligible booking count, excluding unpriced drafts. Booking cancellation rate defines its booking cohort/window. Payment success rate uses normalized terminal logical attempts, not raw webhook delivery counts or HTTP200 responses. Breakdown by business/country/service type must retain currency and coverage. Stored booking totals and provider settlement amounts require reconciliation before financial certification; historical aggregate views remain clearly labeled with their existing definitions until replaced.

**No cross-currency sum.** Preserve integer minor units and currency. Default charts are currency-separated. Any future FX conversion requires approved source/rate/timestamp and a visible reporting-currency label; it is not part of this proposal's first implementation phase.

## 5. Honest health and tenant health

Model connection state, observation state and release certification independently:

- Connection: not_connected / authorizing / connected / revoked / error.
- Health: unknown / healthy / degraded / unavailable; healthy requires a recent successful observation of the named operation.
- Evidence: mock / observed / verified, plus timestamp and stale flag. A recorded connection is not a successful current probe.

No observations, an inaccessible management API, or a disabled collector yields Unknown. An intentionally disconnected provider yields Not connected. A failed current probe yields Degraded/Unavailable according to explicit thresholds. Old success becomes stale/Unknown after its component-specific window. Unknown must never become green because there are no failures. Never derive service health solely from an HTTP202 enqueue acknowledgement.

| Component group | Required observation |
|---|---|
| Render API and orchestration | Request count, p50/p95 latency, 5xx/error rates, readiness and build SHA. |
| Supabase database/Auth | Transaction/RPC failures, connection pressure, authorization error counts and permissioned synthetic checks. Distinguish application auth denials from outages. |
| Realtime/Storage | Delivery lag/disconnects and reconnect gaps; storage access/upload/transform failures. No user payloads in metrics. |
| Netlify and Edge Functions | Deployed source/artifact identity, route probes and function failure/latency measurements where actually collected. |
| Payment/calendar/email/SMS | Per-provider operation capability, connection/certification state, last success and normalized failure rate. Unconnected services stay unconnected. |
| Webhook workers/jobs | Queue depth, oldest ready-job age, active leases, retry counts, dead-letter counts and completion latency. |

Per-business health includes connection states, last successful operation/sync, last normalized failure, bookings today in the business timezone, assigned field-worker status, background-job status and embed-version status. Field workers and compute workers are separate concepts and labels. Show counts/coarse status by default; do not expose employee location or customer details to platform viewers.

Embed status must separate published configuration version, deployed runtime version and last observed embed heartbeat. No heartbeat means Unknown; a published script link alone is not proof a customer's website uses it. Refreshing a Netlify deploy does not synchronize all data: API reads and authenticated realtime reconciliation are separate flows.

## 6. Permissions and action boundary

Supabase Auth verifies identity; Render verifies issuer/audience/session and derives platform/tenant/worker scope from server-authorized records. RLS/RPC checks remain the persistence boundary. PLATFORM_ADMIN receives aggregate read permissions, never an arbitrary table selector. Worker-mobile `/worker` is a separate surface limited to assigned work, not a Command Center role.

Normal reads exclude customer identity, private notes, upload URLs, provider tokens and raw webhook/error bodies. Any future support drill-down with personal data needs a separately approved purpose, narrow capability, expiration and append-only access audit; it is not granted by this document. Existing RISK-4 raw financial/audit access must not widen.

Platform administrative mutations use the same typed Action API as other actors, with platform-specific allowed operations. Incident acknowledge/resolve may be initial actions. Customer reschedule/cancel/assignWorker are tenant/worker domain actions, not unrestricted CC controls. AI may propose or invoke permitted Action API commands using its delegated actor context; no direct database, provider SDK or service-role access and no model-authoritative pricing or state transitions.

## 7. Read models, UX and verification

Proposed APIs: `GET /v1/platform/overview`, `/businesses`, `/businesses/:id/health`, `/subscriptions`, `/usage`, `/bookings/aggregates`, `/financials`, `/integrations`, `/health`, `/incidents`, `/infrastructure`, `/security`. These are design contracts, not implemented endpoints. Pagination/cursors and filters are validated server-side; limits and incomplete coverage are visible. Export is separately permissioned, bounded and redacted.

Keep one persistent sidebar, environment indicator, current user, freshness state and date/currency filters. Human labels replace raw column names and internal error strings. Unauthorized access shows a useful denied state; failed refresh removes/relabels stale information rather than presenting it as current. Detail layouts work on small screens, but the separate worker-mobile experience owns field tasks. Incidents use accessible severity labels, not color alone.

Acceptance after user approval: route/deep-link tests in mock and connected modes; no mock values leaking into live cards; denied role tests at API and DB; stale/unknown/disconnected health tests; currency/denominator fixtures; negative financial data access tests; logout/in-flight response and session-switch tests; aggregate realtime authorization and resync; exact deployed artifact identity. No real provider connection is required to validate the contracts and failure UX.

## 8. Proposed sequence and review decisions

1. Approve IA, scope, metric definitions and privacy boundary with the other eight documents.
2. Build shared shell plus mock adapters and explicit unavailable pages for all eleven routes; preserve current connected capability.
3. Add authorized platform read API and versioned aggregate queries; migrate the current four-view screen without inventing new live data.
4. Add billing/usage/health/incident read models only after their authoritative contracts and telemetry exist.
5. Add constrained incident actions and authenticated realtime; complete adversarial and runtime gates.
6. Evaluate later provider activation separately; credentials remain a final authorized step.

User review required on route labels, initial metric cohort definitions, country-field ownership, acceptable data freshness, incident responsibilities and any future sensitive-support access. No implementation workstream is launched by approval of an isolated paragraph.

## Evidence appendix

- E1 `apps/command-center/src/App.tsx` — five mock routes and connected-mode early return.
- E2 `apps/command-center/src/main.tsx` — BrowserRouter basename.
- E3 `apps/command-center/src/connected/ConnectedCommandCenter.tsx` — sign-in, four table allowlists, refresh and source limitations.
- E4 `apps/command-center/src/data/platformData.ts`; `apps/command-center/src/data/api.ts`; `apps/command-center/src/pages/Health.tsx` — fixture metrics/health and existing selector definitions.
- E5 `packages/runtime-client/src/index.ts` — authenticated platform identity and four-view access, session generation handling.
- E6 `supabase/migrations/0008_command_center_views.sql`; `supabase/migrations/0009_rc2_hardening.sql` — aggregate definitions, revenue placeholders and no routine platform booking/customer PII policy.
- E7 `packages/contracts/src/tenant.ts`; `packages/billing/src/subscription.ts`; `packages/billing/src/provider.ts` — separate tenant and subscription/provider contracts.
- E8 `packages/observability/src/index.ts`; `packages/realtime/README.md` — explicit mock-only measurement/delivery limits.
- E9 `docs/BASELINE_INVARIANTS.md`; `docs/CONTINUATION_PROGRAM.md` — protected invariants and open authority risks; historical environment statements require current evidence as noted above.
