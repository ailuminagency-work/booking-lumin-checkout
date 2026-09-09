# Portal information architecture

**Status: Accepted target architecture, September 9, 2026.** Implementation proceeds through reviewed increments; current completion and hosted acceptance are recorded in `wave-ledger.json` and `EXECUTION_WORKFLOW.md`. The audit below describes its original inspected baseline, not current deployment. Real provider activation remains separately prohibited.

Audit date: September 9, 2026. Repository inspected: `ailuminagency-work/booking-lumin-checkout`, local `work/repo`, commit `fb98a7b9feaadb429ca7656430590d790d394a1a`. Paths below are repository-relative evidence, not claims that proposed routes already exist. Source inspection establishes implementation shape; it does not certify current hosted behavior.

## 1. Product boundary

The Business Portal is the owner's and authorized staff's operating workspace: understand today's workload, manage bookings, assign workers, maintain services/prices, invoice customers, and configure the customer-facing booking experience. It is not a developer dashboard or the platform operator's Command Center.

Keep three separate experiences over shared tenant-scoped contracts:

- **Business Portal:** operational and commercial management for one selected business.
- **Customer checkout/embed:** public service selection, questions, availability, customer details and permitted payment/request completion.
- **Lumin Command Center:** platform-wide aggregate oversight under platform authorization. Tenant customer data does not become routinely visible through navigation convenience.

A worker's assigned-work mobile experience is a fourth role-specific view owned by P5. It should not expose the owner portal's billing, publishing or integration administration. “Worker” is an operational identity, not automatically a login, resource reservation or owner membership; their relationships need explicit contracts.

## 2. What exists today

| Evidence | Current behavior | Reorganization consequence |
|---|---|---|
| `apps/portal/src/App.tsx` | Mock mode has routed pages; Supabase mode returns `ConnectedPortal` before that routed shell | Do not describe the rich mock portal as already connected; converge through explicit adapter-backed features after approval |
| `apps/portal/src/components/Layout.tsx` | Dashboard, Bookings, Customers, Services, Availability, Resources, Media, Checkout Config, Integrations, Settings; responsive menu and skip link | Reuse shell/accessibility conventions, replace navigation taxonomy |
| `apps/portal/src/components/PortalProvider.tsx`, `apps/portal/src/data/mockTenant.ts`, `apps/portal/src/data/api.ts` | In-memory tenant context/store and scoped operations; these filters are not database authorization | Preserve as fixture/test adapter, not production persistence |
| `apps/portal/src/connected/ConnectedPortal.tsx` | Existing account sign-in, memberships/business selector, latest 100 unconfirmed drafts, simple-service catalog active toggle, explicit refresh | Reuse narrow authenticated transport; no routed calendar, worker, invoice or builder implementation exists here |
| `packages/runtime-client/src/index.ts` | Public config, memory-only sessions, tenant-scoped queries, draft RPC and service activation, fixed platform aggregate queries | Extend through reviewed domain contracts; do not turn into an unrestricted generic table accessor |
| `apps/portal/src/pages/Bookings.tsx`, `apps/portal/src/components/BookingDrawer.tsx` | Mock booking list/detail/history/action surfaces | Reuse presentation and tested transitions; distinguish unconfirmed requests from accepted bookings |
| `apps/portal/src/pages/Availability.tsx` | Read-only weekly windows, overrides and policy visualization | Move under Calendar settings; it is not a scheduling editor or dispatch calendar yet |
| `apps/portal/src/pages/Resources.tsx`, `apps/portal/src/data/resources.ts` | Resource list and availability for a sample slot | Reuse resource vocabulary/model; label sample-only until connected |
| `apps/portal/src/pages/Services.tsx` | Service list, active toggle, read-only detail, template cards without adoption action | Retain service catalog; build actual create/edit/template adoption and versioned change flow |
| `apps/portal/src/pages/CheckoutConfig.tsx` | Business name/logo text/accent mock editing, static preview, one workflow preview, illustrative `.example` script URL | Replace with Embed Builder; current copyable snippet is not a working installation product |
| `apps/portal/src/pages/Integrations.tsx` | Payment/calendar/notification/webhook cards with disabled Connect buttons | Reorganize by business task; do not display successful connections or enable buttons without implementation |
| `apps/portal/src/pages/Settings.tsx` | Mock business identity, locale and membership display | Retain identity/localization; separate workers, business subscription billing and connection administration |
| `apps/checkout/src/App.tsx`, `apps/checkout/src/connected/ConnectedCheckout.tsx` | Mock wizard versus connected simple-service, unconfirmed request form | Builder preview must not claim the full configurable checkout is already connected |

There are no Workers, Pricing, Invoices or real Embed Builder routes in the audited portal router. Dashboard mock metrics are not evidence of synchronized business activity. No source-backed claim is made here about real email, SMS, maps, calendar or merchant payments being active.

## 3. Proposed navigation and route map

Use the exact primary navigation below, in this order. All paths are app-relative; a current single-site preview would prefix them with `/portal`. Retain business selector and account controls in the header; preserve selection across navigation without trusting URL tenant IDs for authorization.

| Primary section | Proposed routes and tabs | Main business task | Lead/support |
|---|---|---|---|
| Dashboard | `/`; optional saved date/filter query | Today's work, actionable exceptions, useful performance summaries | P2 / P25, P22, P27 |
| Bookings | `/bookings`, `/bookings/:bookingId`; list filters Requests, Upcoming, In progress, Completed, Cancelled | Review a request, find a booking, view history, assign/adjust permitted work | P3 / P6, P8, P14, P16 |
| Calendar | `/calendar`; Day, Week, Month, Agenda; `/calendar/availability`, `/calendar/overrides`, `/calendar/resources`, `/calendar/map` | See workload and staffing/resource constraints; edit booking windows separately from provider connection | P6 / P4, P7, P8, P18 |
| Workers | `/workers`, `/workers/:workerId`, `/workers/crews/:crewId`; Profile, Availability, Assignments, Access | Maintain worker roster and operational assignments | P4 / P5, P6, P28 |
| Customers | `/customers`, `/customers/:customerId`; Details, Bookings, Invoices, Activity | Find customer context with purpose-limited PII access | P3 / P15, P19, P28 |
| Services | `/services`, `/services/new`, `/services/:serviceId`; Overview, Options, Resources, Media, Versions; `/services/templates`, `/services/resources` | Define what is sold; adopt a generic template into a tenant draft | P9 / P7, P10, P13, P14 |
| Pricing | `/pricing`; Rules, Add-ons, Rental periods, Taxes/deposits; `/pricing/rules/:ruleId` | Maintain authoritative pricing configuration and explain changes | P14 / P9, P16, P17, P21 |
| Invoices | `/invoices`, `/invoices/:invoiceId`; Draft, Issued, Paid, Overdue, Voided filters | Manage customer invoices and permitted collection actions | P15 / P14, P16, P28 |
| Embed Builder | `/embed`, `/embed/flows`, `/embed/flows/:flowId/*` | Author, preview, publish and install booking flows | P11 / P10, P12, P13, P14, P25, P28 |
| Media | `/media`, `/media/:assetId`; library filters by purpose/usage | Upload, organize and reuse images/files with tenant ownership | P13 / P9, P11, P28 |
| Integrations | `/integrations/payments`, `/integrations/calendar`, `/integrations/email`, `/integrations/sms`, `/integrations/maps` | Connect or inspect provider capability/state for the business | P16, P18, P19, P20 / P28 |
| Settings | `/settings`; `/settings/business`, `/settings/team`, `/settings/locale`, `/settings/plan`, `/settings/security`, `/settings/service-areas`, `/settings/tax`, `/settings/notifications` | Business identity, account permissions, localization, Lumin subscription and security | P1, P25 / P17, P21, P28 |

Maps remains a future capability with a clear unavailable state, not a functioning map connection. Workers and calendar resources stay distinct: a vehicle, room or equipment pool is not a worker. Resource inventory is managed at Services → Resources (`/services/resources`); Calendar → Resources (`/calendar/resources`) shows allocation and availability. Service requirements link to the same inventory. Do not add an unrequested thirteenth primary item or duplicate resource CRUD.

Merchant payment setup belongs to Integrations → Payments. The business's subscription to Lumin belongs to Settings → Plan & billing. Customer invoices belong to Invoices. These destinations must never reuse a provider account or financial ledger accidentally.

### Embed Builder subnavigation

At the builder root, **Overview** summarizes flows, draft changes, published version and installation readiness. **Flows** lists flows and starts from a template or blank configuration. Inside a selected flow, use **Steps / Fields / Design / Pricing / Availability / Payment / Tracking / Preview / Install**, with an always-visible draft/version status and a **Publish** action opening validation/history. The Publish screen may use `/embed/flows/:flowId/publish`; it is lifecycle control, not a second global primary navigation item.

Operational maps use `/calendar/map`; business coverage uses `/settings/service-areas`. Both consume generic address/service-area and replaceable maps contracts, not vertical-specific screens.

The complete editor behavior is specified in `EMBED_BUILDER_SPEC.md`. Do not place the generic service editor inside an industry-specific wizard or duplicate service data into the builder.

## 4. Required section content and actions

All items in this section are target requirements, not claims about current persistence. Views share domain records; a page does not own a second copy of a booking, customer, price or worker. Unsupported actions show a clear capability explanation rather than a fake success state.

### Bookings: list and operational detail

List fields: reference, request/booking status, service, scheduled date/time and business timezone, customer display name, assigned worker/crew, resource allocation summary, payment status and invoice status. Filters cover date/range, lifecycle, service, assignment, payment state and text search within the authorized tenant. Use server pagination and explicit freshness, not a loaded-page count labeled as total business activity.

Booking detail includes service/options/quantities, requested and accepted times, duration, customer contact, structured service address and map link, access/gate instructions, private internal notes, customer-visible instructions, public service media versus private booking/job evidence, assigned worker/crew and eligible replacements, resources/holds, price/quote version and line breakdown, merchant payment/refund references, linked invoices, notification delivery state and chronological audited history. Gate/access details and photos require need-to-know access and retention policy; they are not public flow fields or analytics dimensions.

Actions: controlled Confirm, Assign/reassign, Reschedule, Cancel, Refund, Resend confirmation/receipt, Open map, Contact customer, Create/view invoice, Print and Add internal note. Every command shows relevant capability/permission/precondition, confirmation of material effect, pending/result state and audit. “Confirm” uses the accepted financial/availability authority path; request-only remains unconfirmed. Refund routes through P16's verified financial action; editing status cannot fake a refund. Reschedule must acquire replacement capacity and preserve the prior reservation on failure. Resend/contact does not send until an authorized connected channel exists; drafts/previews remain clearly marked. Print redacts internal/private fields according to the user's role and selected output purpose.

### Calendar: operational schedule and availability management

Day, Week, Month and Agenda show business-local bookings, worker/crew assignment and resource constraints. Calendar → Availability owns working/business hours, service-specific hours, worker availability, days off, blackouts, closures, holidays, lead time, horizon, service duration, travel buffers and setup/cleanup buffers. Calendar → Resources visualizes allocation; Services → Resources owns inventory. Capacity and concurrency rules belong to the authoritative scheduling/hold engine, not a CSS calendar block. Combined worker/crew/service/resource eligibility must be evaluated together; drag rescheduling submits the same governed action as booking detail.

Show conflicts and unknown data explicitly; external calendar sync does not establish internal availability by itself. Calendar provider setup is Integrations → Calendar. `/calendar/map` is an operational projection with permitted addresses/assignments; use P20's replaceable MapProvider/navigation contract and provide an agenda/list fallback. Maps activation and route optimization remain future work.

### Workers and crews

Roster fields: display name, active/inactive operational state, contact channel where authorized, eligible services/skills, assigned crew, availability, current assignments and optional linked account/access state. Detail separates profile, service eligibility, work hours/days off, assignments and access. Crew detail `/workers/crews/:crewId` shows members, eligibility/capacity interpretation and assignments; one person in multiple crews must not be double-booked.

Actions include add/edit/deactivate worker, manage eligibility, create/manage crew, assign permitted work and manage account linkage through an authorized process. Deactivation exposes future-assignment impact rather than silently orphaning work. Link to the separate `/worker` experience. Resource kinds `crew` and `technician` do not establish workforce identities or RLS. Worker updates are assigned **job execution** actions only; booking lifecycle and financial lifecycle remain separate and cannot be changed by a worker status button.

### Customers

Detail fields: display name, verified/unverified contact state as supported, phone/email, structured addresses, communication preferences, bookings/requests, completed/cancelled operational history, linked invoices/payment summaries and role-scoped notes. Show relevant last/next service and permitted communication history without building a sales-pipeline CRM. Avoid merging customers automatically on a shared email/phone; deduplication and export require explicit contracts and permission. Customer history links to canonical booking/invoice records and does not expose unrelated tenant records or internal job evidence.

### Services and resource inventory

Service editor: name/description, active state, public images, generic archetype/template origin, duration, eligible workers/skills, resource requirements, pricing reference, items/add-ons/questions, service-area applicability and version history. Adopt template creates a tenant-owned draft, not an instant live service. Changing currency/duration/resource requirements requires an impact preview for in-flight/published consumers. Retain compatibility with the same generic engines.

Inventory `/services/resources`: resource name/category, exclusive unit or pooled capacity, quantity/capacity, location, active state, media and service requirements. Category is descriptive; capacity semantics derive from the model. Link to allocation calendar rather than duplicate scheduling state. Distinguish an unavailable unit from an inactive catalog item, and warn before changes affect future assignments or holds.

### Pricing

Required pricing forms cover **fixed, starting/from, per-item, quantity, hour, day, night, person, room, square-foot, tier, add-on and conditional** pricing. Distance-based pricing is future work until measurement/maps and charging policy are approved. These are units/rule types within one pricing authority, not separate industry calculators.

Each rule has stable ID/version, currency, unit and quantity bounds, rounding/minimum/maximum behavior, effective dates if supported, eligible services, conditions and precedence. “Starting at” is an estimate label, not a guaranteed final quote. Day/night/hour rounding and timezone/DST semantics must be explicit. Tier breakpoints cannot overlap ambiguously. Taxes and deposit rules link to settings and merchant capability. Scenario preview explains line contributions and total; the server recomputes authoritative quotes. A display-unit change cannot retrospectively reprice an accepted booking.

### Invoices

Invoice fields: internal invoice ID, business/customer, linked booking(s), number/reference, issue/due dates, currency, immutable issued line items/quantities/unit prices, subtotal/tax/discount as supported, total, amount paid/outstanding, status and history. Store optional provider invoice/customer/payment IDs as external references alongside internal IDs; provider identifiers are not primary authorization keys and must be scoped to tenant/provider account.

Actions: create/edit draft, preview/issue when supported, send/resend through an authorized configured channel, record verified payment allocation, view payment/refund, void or issue the required correction and print/download. Issued financial records are not overwritten through a generic form. Invoice status derives from governed invoice/payment events, not the same text flag as booking status. P15 owns internal invoice semantics; P16 owns merchant collection; P17 owns Lumin subscription billing.

### Media, integrations and settings

Media displays public catalog assets separately from private customer/job evidence, with name/type/dimensions, usage, upload/processing state, alt text and allowed actions. Replacing an image used by a published flow creates a controlled version/reference change; private uploads cannot become public by toggling a gallery setting.

Integrations sections are Payments, Calendar, Email, SMS and future Maps. Each connection displays provider/account identity safely, supported countries/currencies/capabilities, Not connected/Connecting/Connected/Needs attention/Revoked state as supported, last verified check and permitted connect/reconnect/revoke actions. A database connection record is not proof of provider health. No token or secret belongs in the browser. Advanced event/webhook tooling can remain a future governed subsection rather than a new primary navigation item.

Settings contains business identity/timezone, locale, team permissions, Plan & billing, **tax configuration**, **service areas**, **notifications** and **security**. Service areas at `/settings/service-areas` use generic country/postal-prefix/radius/polygon coverage with service applicability, explicit boundary interpretation and manual-entry fallback; do not equate a US ZIP field with international coverage. Radius/polygon map assistance is a future replaceable capability, not a required hardcoded vendor.

Notification settings own versioned message templates, permitted variables, language, trigger/channel preferences and preview. Integrations → Email/SMS own connection credentials/readiness; both surfaces reference the same connections/templates. Booking actions show deduplicated delivery attempts and retries once implemented. Never accept arbitrary template variables containing provider secrets or expose full customer records to tracking. Security settings cover account/session/permission controls and relevant audit; platform-only diagnostics remain in Command Center.

## 5. Dashboard and primary journeys

### Dashboard hierarchy

1. Business name, business-local date, range selector and clear refresh/data status.
2. Today's bookings/requests and next assignments, grouped by attention required rather than technical status codes.
3. Exceptions: unassigned work, capacity conflict requiring review, failed synchronization, unpaid invoice when that capability exists. Show “No data yet” or “Not connected” instead of invented zero/success indicators.
4. Compact business measures with definitions, currency/timezone and drill-through filters. Separate request count from confirmed bookings and merchant payments from Lumin billing.
5. Frequent actions: review requests, create permitted booking, open calendar, assign worker, edit a service, open the builder. Every visible action must have an implemented destination and permission check.

Developer logs, database migrations, arbitrary event payloads and cross-tenant counters are not dashboard cards. P27 supplies understandable status; deeper platform diagnostics belong to P26 Command Center.

### Owner reviews a new request

Dashboard attention card → Bookings filtered to Requests → booking/request detail → confirm requirements and availability → permitted next action. The current connected form creates only unconfirmed, unpriced requests. The proposed portal must continue saying this until capacity and financial authority are implemented. A button labeled “Confirm” cannot merely change a local status or bypass verified payment requirements. Assignment and customer contact remain separate audited actions.

### Owner changes a service and embedded experience

Services → service draft → edit catalog/pricing/resource references → validation → versioned service change. Embed Builder → selected flow → revise layout/questions using that service → preview → publish. Save draft is not publish. Publishing a flow does not silently publish every referenced draft service, price or media asset.

### Staff manages today's work

Calendar Agenda → assigned booking detail → role-permitted operational action. A worker can enter P5's assigned-work experience without access to merchant credentials, platform billing, customer export or flow publishing. Mobile views must not simply squeeze the entire owner sidebar into a worker screen.

## 6. Retain, move and redirect plan

No redirect is implemented by this proposal. During rollout, preserve IDs and query parameters only through an allowlisted mapping; do not forward arbitrary return URLs.

| Existing mock route | Proposed destination | Treatment |
|---|---|---|
| `/` | `/` Dashboard | Retain; replace demo adapter only after connected feature gates |
| `/bookings`, `/customers` | Same roots and stable details | Retain links; keep request/booking distinction |
| `/services`, `/services/:serviceId` | Same routes | Retain; add tabs rather than break detail URLs |
| `/availability` | `/calendar/availability` | Move existing windows/policy content; navigation redirect after release |
| `/resources` | `/services/resources` | Move inventory management under Services; allocation links use `/calendar/resources`; retain old-link redirect |
| `/media` | `/media` | Retain library |
| `/checkout` | `/embed` | Move branding/preview concepts; mark placeholder snippet unavailable; redirect old config route |
| `/integrations` | `/integrations/payments` with category tabs | Retain root as overview or canonical category redirect; preserve deep-link intent |
| `/settings` | `/settings/business` | Retain Settings landing or canonical redirect; move operational worker management out of membership display |

Existing `/portal/...` hosting base remains a deployment concern, not a hardcoded prefix in every router link. P5 proposes `apps/worker` mounted at `/worker`; platform oversight stays at `/command-center`. Public embed/hosted checkout URLs require separate route ownership and authorization; they are not redirects into the owner's portal.

Connected mode currently bypasses these routes. Migration must first add a connected shell with authenticated loading/denied/error states, then move features into it. Do not make a missing connected feature automatically render the mock screen. A feature flag may offer an explicitly labeled demonstration in an isolated route, but not substitute sample records inside the live business context.

## 7. Shared components and ownership

| Component or contract boundary | Accountable stream | Required collaborators |
|---|---|---|
| Route registry, sidebar taxonomy, breadcrumbs, business switcher | P1 IA | P25 Portal UX; P28 authorization |
| Portal frame, responsive navigation, empty/error/loading/action patterns | P25 Portal UX | P1; all page owners |
| Booking list/detail/action menu | P3 Bookings | P6 scheduling, P8 holds, P15 invoices, P16 merchant payments |
| Worker roster/access versus mobile assignment experience | P4 Workers / P5 Worker mobile | P6; P28 |
| Calendar, availability policy/overrides | P6 Scheduling | P7 resources, P8 holds, P18 calendar OAuth |
| Resource requirements/pools/exclusive units | P7 Resources | P6, P8, P9 |
| Service editor and template adoption | P9 Services | P10 workflow, P13 media, P14 pricing |
| Flow DSL, typed field/step definitions, validation | P10 Workflow | P11 builder, P12 runtime, P28 |
| Authoring/preview/install/publish user experience | P11 Builder | P10, P12, P13, P14, P21, P25 |
| Public flow rendering and hosted/embed modes | P12 Runtime | P8, P10, P11, P16, P28 |
| Backend endpoints and business policy enforcement | P23 Render API | P3/P6/P8/P9/P10/P11; P28; deployment decisions separate |
| Events and human-readable freshness/status | P22 Events / P27 Observability | P25; domain owners |
| AI-assisted proposals/actions | P24 AI actions | P28 and each domain owner; no new authority |
| Platform-only oversight | P26 Command Center | P27, P28; do not merge into tenant portal navigation |

P16 merchant payments, P17 platform billing, P18 calendar OAuth, P19 notifications, P20 maps and P21 internationalization remain distinct owners of their respective settings/capabilities. The governing integration/review loop still applies; a UI page owner cannot self-approve backend authority or publishing policy.

## 8. Permission and data boundaries

The following are proposed capabilities, not claims about currently implemented roles:

| Capability | Owner | Authorized staff | Worker | Platform operator |
|---|---|---|---|---|
| View business booking/customer context | Tenant-scoped | Assigned capability/scope | Assigned work and minimum necessary details | No routine raw tenant PII |
| Update operational booking state | Allowed business transitions only | Explicit capability | No booking transitions; assigned job execution updates only | No implicit tenant-write power |
| Edit services/prices | Authorized | Explicit delegated capability | No | No implicit tenant-write power |
| Edit flow draft | Authorized | Explicit delegated capability | No | No implicit tenant-write power |
| Publish/install policy changes | Owner or explicit publisher grant | Separate publisher grant required | No | No automatic bypass |
| Connect merchant/calendar/notification providers | Owner/connection administrator | Explicit grant | No | Governed support process only |
| Manage Lumin subscription | Billing administrator | Explicit grant | No | Platform billing domain only |

Enforce these capabilities server-side and through tenant-isolated storage. Hiding a menu item is not authorization. Resolve membership from the authenticated identity; clear cached tenant records and pending responses when switching business or signing out. Separate access-denied from empty results. Do not place secrets in embeds, analytics payloads, browser-accessible configuration or UI errors.

## 9. Responsive and accessible behavior

- **Desktop:** persistent business navigation, contextual tabs, list/detail split when useful. Use readable density, plain status labels and relevant actions rather than technical data grids everywhere.
- **Tablet:** collapse secondary columns, retain primary task context, use accessible drawer details. Calendar switches to usable week/agenda views instead of a compressed seven-column grid.
- **Phone:** menu drawer, full-width task pages, agenda-first calendar, stacked booking/customer cards, persistent primary action that does not cover focused controls. Worker experience has its own narrower task navigation.
- Keep keyboard order, visible focus, skip link, focus restoration after drawers, error summary and inline validation. Status is not conveyed by color alone. Loading disables actions that depend on refreshed data; retries retain safe user input.
- Display business timezone for operational schedules; show clear conversion if customer-local time differs. Keep money grouped by currency, with no display-only switch changing contractual charges. P21 owns translation keys and locale rules.
- Respect reduced-motion preferences. Do not animate essential actions or require drag gestures: ordered lists also need Move up/Move down and keyboard controls.

## 10. Proposed delivery decision matrix

| Classification | Work |
|---|---|
| **Current** | Mock routed shell, sample operational pages, limited live connected requests/catalog activation, generic workflow/template/resource/media packages |
| **Reuse** | Shell accessibility, booking/detail presentation, currency formatting, service schema, pure workflow engine, template registry, resource semantics, media variants |
| **Move** | Availability → Calendar settings; Resource inventory → Services/Resources with Calendar allocation view; Checkout Config concepts → Embed Builder; worker operations out of generic settings |
| **Build** | Connected routed portal shell, workers/assignment contracts, real service authoring, pricing/invoice surfaces, builder/version/publish/install contracts, role-aware live operations |
| **Defer explicitly** | Signature/location picker, map provider activation, embed modal, provider keys, unsupported payment methods, unreviewed AI actions and live deployment changes |

Recommended dependency order: approve IA and capability boundaries → shared route/shell contracts → connected read states → service/workflow/version contracts → builder draft/preview → reviewed server publish/install path → operational workers/calendar/invoices in independent contract-ready slices. Do not block independent domain contracts on final visual polish, but do not publish incomplete placeholder features as production-ready.

## 11. Review decisions and acceptance

User review is requested for the navigation, Resources placement, owner/staff/worker separation, and the proposed route migration. Resource management and allocation are distinct views of one inventory, and worker job execution never grants booking confirmation/cancellation/refund authority. Detailed implementation estimates, database schemas and deploy authorization are intentionally outside this docs-only milestone.

Before a later rollout is accepted: every visible route must have a real permitted destination; mock versus live state must be obvious; redirects must preserve intent; unauthorized direct URLs must fail safely; tenant switches must not leak old data; mobile/keyboard journeys must work; calendar/booking changes must preserve capacity/payment authority; and editing drafts must not alter published customer flows. Failed gates return to the responsible builder before integration.
