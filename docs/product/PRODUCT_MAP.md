# Booking Lumin product map

**Status: Accepted target architecture, September 9, 2026.** Implementation proceeds through reviewed increments; current completion and hosted acceptance are recorded in `wave-ledger.json` and `EXECUTION_WORKFLOW.md`. The audit below describes its original inspected baseline, not current deployment. Real provider activation remains separately prohibited.

## Decision and audit basis

Adopt four purpose-specific surfaces over one tenant-isolated booking core. The Portal controls the business; its Embed Builder controls the customer experience; the Worker surface controls assigned field execution; Command Center controls the platform. A vertical is versioned configuration, not a copied app.

This is a source/configuration audit and product architecture proposal, not certification of the full live product. Audited checkout: `fb98a7b9feaadb429ca7656430590d790d394a1a`, clean working tree. Its [CI](https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/34380365813) passed. [PR 31](https://github.com/ailuminagency-work/booking-lumin-checkout/pull/31) remains draft; remote main last verified `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead`, protected. Accepted RC-2 foundation: `6bbcd679a09741d3a2e978ddd2bb398f1d98a6f9`, conditional acceptance. The claimed RC-2 tag is absent in the fetched repository: identify the foundation by commit, not that tag.

Evidence paths below are relative to the audited repository, not proposed production URLs. Existing governance documents are historical evidence: their claims about unavailable branch protection and transport access have partly been superseded by subsequent verification. No code, migration, deployment, credential or permissions change belongs to this reorganization review.

## CURRENT → TARGET

| Surface | Current evidence and limits | Target responsibility |
|---|---|---|
| Customer | `apps/checkout/src/App.tsx`: fixed wizard with service/configuration/summary/slot/customer/payment/confirmation; demo config/store. `connected/ConnectedCheckout.tsx`: separate simple-service catalog and unconfirmed draft submission, no reservation/payment. | One published-flow renderer with business branding; hosted and embedded channels share flow behavior and server authority. No tenant selection or Lumin admin chrome shown to customers. |
| Business Portal | `apps/portal/src/App.tsx`, `components/Layout.tsx`: ten-section mock navigation; `data/api.ts` operates a local tenant store. Connected mode replaces the shell with a narrow authenticated draft/service view. | One permission-aware operational shell, canonical business data and controlled actions; Embed Builder is a major product within it. Demo/connected transports must not create divergent product trees. |
| Worker | No worker application in `apps/`; `packages/resources/src/types.ts` includes crew/technician labels but these are capacity resources, not workforce identities. `contracts/src/tenant.ts` has owner/staff only. | Separate mobile interface for current assignments, allowed job updates, navigation and evidence. Owner workflows and financial access are excluded server-side. |
| Command Center | `apps/command-center/src/App.tsx`: five mock sections; connected component authenticates then displays four aggregate views. | Eleven platform-only sections, aggregate tenant health/economics, verified telemetry and controlled platform actions. No implicit tenant impersonation. |

The current code has reusable domain foundations, not an already integrated operating system. A passing leaf-package test does not demonstrate an end-to-end product workflow.

## Product domains and ownership

| Domain | Canonical owner | Consumer projections |
|---|---|---|
| Business identity, timezone, locale, membership and policies | Portal Settings + tenant authorization boundary | Every surface receives only its allowed context. |
| Service definitions and catalog | Portal Services | Builder references eligible services; customer sees published public projections. |
| Prices, rules, tax configuration | Portal Pricing; server pricing engine | Service-specific links and Builder Pricing bind approved rules; neither stores a second calculator. |
| Inventory and resources | Portal Services → Resources | Calendar allocation and embed resource selectors read the same inventory. |
| Working hours, capacity and bookings | Calendar + transactional scheduling engine | Embed requests offers/holds; workers see assignments; external calendars mirror internal state. |
| Workers, crews, eligibility | Portal Workers | Worker app sees the assignment-limited projection; a resource record grants no login authority. |
| Customers and operational history | Portal Customers | Booking details show necessary context; no generic CRM pipeline initially. |
| Customer invoices and merchant payments | Portal Invoices + Integrations → Payments | Booking actions link normalized internal invoice/payment records. |
| Platform subscription and entitlements | Command Center Subscriptions + Portal Settings → Plan | Platform BillingProvider is separate from MerchantPaymentProvider. |
| Draft/published booking flows | Embed Builder | Customer runtime resolves immutable published version; templates seed editable drafts. |
| Public marketing media vs private job evidence | Portal Media / booking-scoped private attachments | Never publish worker/customer uploads through a public service gallery by default. |
| Connections and communication templates | Portal Integrations and notification settings | Booking notifications consume the same connection status and versioned templates. |
| Platform telemetry | Command Center Health/Incidents | Tenant Portal receives business-safe status, not internal payloads or secrets. |

## Route and component ownership map

Canonical mount roots are proposed, not installed routes. Subroutes and compatibility mappings are detailed in the surface specifications.

| Product boundary | Target mount/component boundary | Accountable workstreams | Shared-path rule |
|---|---|---|---|
| Portal shell, navigation, responsive primitives | `/portal/*`; reuse `apps/portal/src/components/Layout.tsx` | P1 decides IA; P25 owns shell | Domain teams submit route descriptors; P25 alone edits central registration. |
| Portal operations | `/portal/bookings`, `/portal/calendar`, `/portal/workers`, `/portal/customers` | P3/P6/P4/P25 | P3 owns booking detail; other domains supply composed panels/actions. |
| Catalog and commercial configuration | `/portal/services`, `/portal/pricing`, `/portal/invoices`, `/portal/media` | P9/P14/P15/P13 | No duplicate source of price, asset or customer truth. |
| Embed Builder | `/portal/embed/flows/:flowId/*` | P11 | P10 owns workflow semantics; P12 owns renderer; P11 owns editor UI only. |
| Customer flow renderer and installation loader | `/checkout/` compatibility; future `/checkout/flows/:flowId`; loader is a separate public artifact | P12 | P12 owns current App/Wizard composition; P11 consumes a package, never imports another app. |
| Worker application | `/worker/*`, proposed `apps/worker` | P5 | P4 owns workforce records; P3/P23 own allowed assignment/job actions. |
| Command Center | `/command-center/*` | P26 | P17/P27 supply billing/health contracts, not independent competing dashboards. |
| Contracts and persistence boundary | `packages/contracts`, versioned API/DB contracts | Architecture + Integration Governors | One writer per change set; package-local types migrate through compatibility adapters. |
| Core engines | Existing `packages/core`, `workflow`, `resources`, `billing`, `payments` | P14/P10/P7/P8/P17/P16 | No framework, provider SDK, app import or arbitrary business code execution. |

## GAPS / REUSE / MOVE / BUILD / DEFER

| Area | Reuse | Move/refactor safely | Build only after review | Defer |
|---|---|---|---|---|
| Portal IA | Dashboard/cards, booking drawer, service forms, accessible UI primitives | Availability → Calendar; Resources → Services/Resources; Checkout Config → Embed Builder; split integration subsections | One shell with explicit transport and capability states; calendar/worker/invoice pages | Bespoke navigation per vertical |
| Workflow | `packages/workflow` serializable conditions and validation; `packages/templates` fixtures | Fixed wizard composition into schema-driven renderer; keep presets as adapters | Draft/version/publish model, full reusable field registry, same-engine responsive preview | Arbitrary JavaScript/CSS injection, plugin marketplace |
| Pricing | Integer money, selection validation, core repricing, workflow input effects | Editor pricing controls become bindings to shared versioned rules | Required units/tier/conditional rule coverage and authoritative quote snapshots | Distance pricing until MapProvider and measurement policy reviewed |
| Scheduling | Existing availability, resource planner, migration/hold race tests | Existing availability settings into full Calendar | Atomic combined worker/crew/resource/service constraints and reschedule transaction | Route optimization and advanced dispatch |
| Workforce | Shared auth primitives, generic capacity concepts | Do not equate crew resource with worker membership | Workforce identity, eligibility, assignments, mobile jobs, private evidence | Payroll, HR, attendance surveillance, native apps before useful mobile web |
| Payments/invoices | `packages/payments` routing + `billing` separation; fake providers | Compatibility façade for older `packages/adapters` payment contract | Internal invoice ledger, connection readiness, payment/hold finalization and reconciliation | Real keys/provider activation, complex accounting suite |
| Media | `packages/media` metadata/variants/storage ports; Portal Media UI | Separate public catalog media from private job uploads | Durable tenant storage policies, bounded transform jobs and signed private access | Unbounded HD originals on mobile, video production suite |
| Platform operations | Existing aggregate views, mock events/telemetry, CC cards | Economics → Financials with merchant/platform tabs | Durable events/jobs, authentic health, infrastructure inventory, incidents | Raw customer-data explorer or general-purpose tenant SQL console |

Duplicate representations requiring consolidation: service questions and package-local workflow answers; old PaymentProvider and newer MerchantPaymentProvider; fixed checkout step visibility and reusable workflow evaluation; independent mock stores and connected-only shells; portal checkout branding and future flow design; resource-as-crew labels and new workforce membership. Preserve compatibility until consuming callers are migrated and tested; do not delete by filename similarity.

Overbuilt relative to usable product: breadth of mock/provider/template packages exceeds persistence and unified UX wiring. Reuse the breadth as conformance fixtures; avoid adding more provider brands, infrastructure dashboards or industry presets before one operational slice works end-to-end.

## Required cross-surface journeys

1. Owner configures business locale/timezone → services/pricing → calendar/resources/workers → drafts a flow → validates responsive preview → publishes immutable version → installs verified snippet. Draft edits cannot alter active bookings.
2. Customer chooses service/options → authoritative eligibility and quote → available slot/resource offer → atomic bounded hold → contact/location → required payment or approved request-only policy → verified outcome. Return visits/retries cannot double-book or double-charge.
3. Staff opens booking → assigns eligible available worker/crew → worker sees permitted job data → updates job status → office sees event-backed state and audit. Job completion cannot forge payment success.
4. Customer/staff/AI requests reschedule → one authorized Action API → validate current version/policy → reserve replacement capacity and release old capacity atomically → audit/outbox → notify. Failure preserves old reservation.
5. Command Center observes aggregate degradation → incident/tenant-safe explanation → retries through bounded operational actions. No customer-row browsing or implicit impersonation is needed.

Rental UX correction: collect dates before promising that listed models are available. Category/model browsing before dates may be exploratory only; mark availability unknown and re-evaluate after dates. Do not claim genuine availability from a date-free catalog.

## Non-negotiable constraints

- Tenant identity comes from verified membership or a server-resolved published flow/session, never a trusted client tenant selector. Composite tenant relationships and RLS are tested independently of UI guards.
- Approved public catalog/flow projections are deliberately visible to customers. Publication never exposes private customer/worker/configuration records, grants another business editing authority, or permits a booking/payment to be attributed to a caller-selected tenant. Domain allowlists are distribution controls, not substitutes for authorization.
- Settings and appearance cannot bypass required contact, eligibility, hold, price, consent or payment authority. No frontend configuration can unlock privileged state transitions.
- Preserve RC-2 B1–B6/R1–R9. RUNTIME-04 authenticated transport certification and RISK-4 residual raw financial/audit access remain open. Prior anonymous HTTP proof is useful but does not close those gaps.
- Existing baseline confirmation requires the designated payment-authority path. Request-only remains an unconfirmed draft. Future pay-later/no-payment confirmation needs an explicit reviewed policy/state-machine change, not a builder toggle.
- Country/currency/timezone/locale are explicit and independent; postal terminology is localized. Store instants in UTC and schedules in IANA zones; display business and customer zone clearly where they differ.
- Provider credentials remain server-side and disconnected. Existing key-entry restrictions persist. Tests use synthetic tenants, fake providers and disposable databases.

## ADR-PRODUCT-001: One core, four surfaces

Status: Proposed. Deciders: product owner, Architecture Governor, Security Governor, Runtime Guardian.

Considered: (A) copy an application for every industry, (B) one giant owner/admin/worker app, (C) four surface shells with shared typed engines and versioned configuration. Recommend C. A gives quick bespoke screens but fragments fixes and tenant guarantees. B shares UI cheaply but increases permission complexity and worker/admin exposure risk. C requires explicit API/renderer boundaries and migration effort, but preserves one source of authority and independent UX per audience. Start as a modular Render API, not many independently deployed microservices. Supabase remains authoritative storage/auth/RLS; Netlify remains frontend delivery.

Review actions: approve the four surfaces, target navigation, ownership boundaries, workflow-publication model and phased migration. Remaining specifics (retention periods, availability conflict policy, publish permissions and operating SLOs) are listed as proposed defaults or decisions in companion documents. No implementation team is launched by this proposal.

## Document and requirement coverage

| User requirement | Primary review artifact |
|---|---|
| Four surfaces, product ownership, existing reuse/moves/duplicates/overbuild | PRODUCT_MAP.md |
| Portal dashboard/bookings/calendar/workers/customers/services/pricing/areas/invoices/integrations/settings; target navigation | PORTAL_INFORMATION_ARCHITECTURE.md |
| Visual flow engine, conditional fields, design, responsive preview, publish/install, six verticals without app copies | EMBED_BUILDER_SPEC.md |
| Assigned-worker mobile, crews, field status, maps and future PWA | WORKER_EXPERIENCE_SPEC.md |
| Private platform navigation, subscriptions/GMV/revenue, minimized tenant/system health | COMMAND_CENTER_SPEC.md |
| Netlify/Render/Supabase responsibilities, authoritative actions, replaceable providers, events/AI dependencies | BACKEND_DEPENDENCY_DAG.md |
| Tenant ownership across every data class, schema/role gaps, hold/resource/workforce integrity | DATA_MODEL_GAPS.md |
| Safe route/data migration, existing behavior preservation, phases/rollback/pilot criteria | MIGRATION_PLAN.md |
| P1–P28 queues, V1–V12 teams, six governors, full evidence loop and concurrency limits | PARALLEL_WORKSTREAM_PLAN.md |

These nine documents form one proposed baseline. If a later review changes a route, contract or phase dependency, update every affected map before dispatch. The product owner reviews intent; technical reviewers verify consistency and safety but cannot substitute for product approval.
