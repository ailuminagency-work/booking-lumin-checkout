# Worker experience specification

**Status: Accepted target architecture, September 9, 2026.** Implementation proceeds through reviewed increments; current completion and hosted acceptance are recorded in `wave-ledger.json` and `EXECUTION_WORKFLOW.md`. The audit below describes its original inspected baseline, not current deployment. Real provider activation remains separately prohibited.

**Owners:** P4 Worker/Team Management owns worker/team identity, eligibility and assignments. P5 Worker Mobile/PWA owns the field experience. P20 Maps owns the replaceable MapProvider/navigation boundary. P28 Security/Tenant Isolation owns assignment-based authorization, field minimization and adversarial acceptance. Scheduling/resources and media owners collaborate on allocation and attachments; governors retain architecture/integration/runtime/release gates.

## Purpose and surface boundaries

A worker opens a phone-friendly page, sees today's assigned work, reaches the job, follows only the instructions needed for that assignment, reports progress and submits a completion record. The worker does not need to enter the business portal or browse the customer database.

Proposed worker root: **`/worker`**, implemented later as **`apps/worker`**. Business management stays in `/portal/workers/{workerId}` and `/portal/workers/crews/{crewId}`. Resource definitions stay in `/portal/services/resources`; allocation in `/portal/calendar/resources`; operational map in `/portal/calendar/map`. The customer embed and Lumin Command Center remain separate surfaces with their own authorization and information needs. Routes organize the UI; they are not security boundaries.

Current evidence: `apps/checkout`, `apps/portal` and `apps/command-center` exist; no worker/PWA app was found. `packages/resources/src/types.ts` describes crew/technician resource kinds, not authenticated workers or personnel rosters. `supabase/migrations/0002_tenants_and_identity.sql` and `packages/contracts/src/tenant.ts` only define owner/staff business roles. New worker capabilities therefore require reviewed server/RLS work before a field UI is enabled.

Repository inspected at `fb98a7b9feaadb429ca7656430590d790d394a1a`; migration files extend through 0014. Last separately audited live migration set remains **0001–0009**. Neither the proposed routes nor repository migration files imply deployed worker functionality.

## First useful release

| Screen / route | Worker task | Required behavior |
|---|---|---|
| Sign-in / tenant choice | Enter authorized field workspace | Real authenticated identity, active worker access and explicit tenant selection among allowed businesses. No shared account or role inferred from a URL. |
| `/worker` | See today's jobs | Default list ordered by scheduled time in the business timezone; job reference, service, permitted address summary, time window and state. Empty and failed-load states differ. Only active assignments appear. |
| `/worker/jobs/{jobId}` | Prepare and perform assigned work | Show approved task instructions, location, necessary customer contact, time window, assigned team role and allowed progress actions. Omit financial/private fields from the response entirely. |
| Navigation action | Reach the destination | Open chosen device navigation with a clear external handoff. Works without embedded map keys initially; manual address remains available if handoff fails. |
| Contact action | Contact this job's customer | Explicit tap-to-call of a permitted phone number. No phone list, bulk export, CRM messaging or automatic SMS/email. |
| Progress action | Report en route / arrival / work / completion | Submit idempotent authorized action; show pending until acknowledged; retain last server-confirmed state on rejection. |
| Completion details | Add permitted notes/photos | Bounded text and images tied to this job and assignment. Show upload progress/retry; never claim a missing attachment was submitted. |
| Request change | Ask dispatcher to reschedule or cancel | Create a request with reason. Worker cannot directly change booking date, release a payment, refund or cancel a customer's booking. |
| Own history | Review own completed work | Minimal references/dates/service/outcome; historical customer contact, gate codes and precise addresses expire under policy. No full customer browsing. |

The first release is a responsive online web experience. It does not require payroll, timesheets, optimization, continuous location tracking, background navigation, offline dispatch or a native app-store build. Future phone installation should enhance the same guarded workflow rather than create a second authority model.

## Business-side worker and team management

P4 defines these fields and access rules before UI build:

| Data | Business management | Worker visibility |
|---|---|---|
| Name/photo, business role, active status | Authorized owner/manager; audit profile and status changes | Own profile; other crew members' approved display name/role only when needed for shared assignment |
| Email/phone | Restricted identity/contact information | Own contact details; approved dispatcher contact; never a complete personnel directory by default |
| Skills and service eligibility | Managed qualifications, effective dates and capability checks | Own current eligibility; no self-approval of a required skill |
| Working hours, exceptions, base location | Used by allocation authority | Own schedule; location is a business-assigned base, not automatic live tracking |
| Upcoming/completed jobs | Derived from assignments/job state | Own allowed assignments and minimal own history |
| Notes | Separate management-private and field-operational classes | Only explicit field-operational notes for current assignment; private performance or billing notes are never sent |
| Permissions | Server-defined capability grants and versions | Display own permitted actions; no role editing or self-assignment |
| Teams/crews | Effective membership, lead, service eligibility and assignment roster | Membership relevant to own upcoming/current work; no automatic access to every job ever assigned to the crew |

A booking may require an individual, a crew, a resource plus an individual, or several constraints together. Team selection must expand to actual worker commitments during atomic allocation; a 'crew of two' resource counter does not prove that two eligible people are free. Reassigning crew membership must not silently substitute workers on a reserved job.

## Assignment authorization and minimized DTO

Proposed server operation `getAssignedJob` resolves the authenticated principal, tenant, active worker access, assignment, job status and access window. It returns a dedicated field DTO, not `select *` from bookings/customers. Exact transport/API naming is for Architecture review; every operation must flow through the reviewed ActionAPI boundary, including AI-originated assistance.

**Allowed when needed:** opaque job/reference, service label, scheduled UTC instants plus business timezone, safe task checklist, operational address, necessary customer display name/phone, permitted entry instructions, worker's role, allowed next actions, assignment/version, attachment references and server-confirmed status.

**Never included:** payment/provider IDs or credentials, prices/invoices/refunds, full customer profile/history, arbitrary booking notes, marketing data, tenant settings, other jobs, precise worker tracking, manager-private notes or raw audit payloads. Customer data must not be copied into generic telemetry or URLs. DTO restriction is enforced server-side, not merely hidden on the screen.

Sensitive fields need separate windows. Proposed default is minimum necessary access around an active assignment; exact lead/retention intervals require product/privacy review before implementation. Reveal gate/access codes only when the worker explicitly requests them inside the authorized window. Hide them after completion/reassignment/revocation; do not retain them in history, logs, notifications or offline caches. A screenshot cannot be remotely erased, so never claim that revocation removes information already seen.

**Critical compatibility rule:** do not add workers to the broad existing BUSINESS_STAFF role. `0007_rls.sql` uses general member predicates for tenant customer/booking access, and `0009_rc2_hardening.sql` retains member-only customer/booking reads. Worker access requires either a separate worker identity bridge or a comprehensive capability/RLS refactor reviewed before enabling the new role. A worker should not acquire portal-wide access merely by being authenticated.

Assignment data and all links use tenant composite keys. Worker A trying worker B's job ID, revoked assignment, altered tenant, stale permission version, inactive account or out-of-window field request must fail without revealing whether another tenant's job exists. Tokens/refresh secrets never enter customer records, navigation parameters, analytics or photo metadata.

## Three lifecycles that must remain separate

| Lifecycle | Proposed / existing semantics | Authority |
|---|---|---|
| Job execution | **ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED** | Assigned worker may submit allowed forward actions; server validates assignment/version and legal edge. Dispatcher corrections/reopen policy is separate and audited; no silent client reversal. |
| Appointment allocation | **AVAILABLE → TEMP_HOLD → CONFIRMED**, or TEMP_HOLD → EXPIRED/RELEASED | Server availability planner + atomic database command across capacity, resources, individual workers and expanded crew. AVAILABLE is computed, not a durable promise. |
| Booking/payment | Existing booking draft/pending_payment/confirmed/completed/cancelled/refunded/failed plus payment provider outcomes | Existing protected authority path; no worker action directly confirms a payment, issues a refund or rewrites pricing. |

Existing state contract is in `packages/contracts/src/booking.ts`, engine authority in `packages/core/src/booking.ts`, DB guards in `0005_customers_bookings_payments.sql` and `0009_rc2_hardening.sql`. A connected checkout currently saves only an unconfirmed draft. It must not automatically dispatch workers or label availability as reserved.

A job's COMPLETED event is evidence of field execution, not payment settlement. A separately authorized server orchestration may later reconcile all jobs with booking completion; its criteria and failure handling require their own reviewed contract. Partial work, dispute, overdue job, lost connection and change requests must remain explicit rather than coercing the financial state machine.

Commands include an idempotency key, expected job/assignment version and requested transition. Client timestamps are informational; the server records authoritative receipt/transition time. Replayed commands return the existing result; conflicting payloads under the same key reject. Reschedule/cancel requests go to the dispatcher queue and leave the current confirmed assignment unchanged until approved.

## Capacity and crew safety

Required atomic allocation is specified in DATA_MODEL_GAPS.md. Mobile cannot reserve capacity itself or issue several independent 'hold' requests. The server must reserve all needed service capacity, resource quantities and actual workers together, with a shared expiry and deterministic locking; any unsatisfied constraint rolls the entire operation back.

Reassignment and rescheduling must atomically replace/release the old bundle, update worker access, record history and notify through the reviewed event boundary. A slow worker action with an old assignment version cannot complete a job after that worker has been replaced. Required external calendar freshness is validated before commitment; a map estimate or unknown calendar state must not be treated as confirmed availability.

Repository migrations 0010/0012 add separate holds and 0014 fixes overlap lock scope; they do not implement this full worker/crew bundle. No live application of those files is claimed here.

## Maps and navigation — P20

Use a replaceable **MapProvider** contract. Initial capabilities: display permitted job/location/zone pins, optional geocoding adapter, and create a user-triggered external navigation link. Candidate adapters can support Google Maps, Mapbox or Apple Maps/deep links later; no credential activation or route optimizer is included in this release.

Business map `/portal/calendar/map` shows only authorized tenant assignments, addresses, service zones and locations. Resource allocation stays under `/portal/calendar/resources`. Worker map/list shows only their assignments and permitted fields. Permission must be enforced before forming pins or returning coordinates; hiding unauthorized pins after fetching the full customer list is unacceptable.

Before opening navigation, explain that the chosen external application receives the destination. Send only destination coordinates or address needed for navigation—no customer name, phone, gate code, internal note, access token or booking metadata. Encode parameters through the provider adapter; allowlist supported HTTPS/native schemes so data cannot become a script URL. Manual copy/display remains available. Existing map service sharing and geocoding retention terms need review before connecting a provider.

Do not request device location merely to show today's jobs. If current location is later useful, request explicit browser permission at the action where it is needed, explain purpose, and function with permission denied. No background tracking, automatic uploads of location history or worker performance scoring from movement data is proposed. A map pin's accuracy/provenance should be visible when uncertain; route ETA is advisory.

Address model remains international: address lines, city/locality as appropriate, optional region, postal_code and ISO country; business timezone is explicit. Do not require US ZIP/state formats or infer country from a phone number. Preserve entered text and separate validated/geocoded coordinates/provenance; avoid silently replacing a customer's address.

## Mobile interaction and network behavior

Use a readable single-column job card, large touch targets, clear primary action and short forms. Job address, time window and status remain accessible without a map. Labels must localize; expose status in text rather than color alone. Show both business timezone and an explanation when phone timezone differs. Screen reader focus follows status/error changes; image capture has an accessible file-input alternative.

When offline or an action times out, retain the last server-confirmed state and show **Not synced**. Do not show COMPLETED, a successful photo upload, a new assignment or a released reservation before acknowledgement. Initially disable authoritative updates while offline and let the worker explicitly retry when online; full offline dispatch is not required. Keep an idempotency key across ambiguous retries to avoid duplicate events.

Any temporary text draft or retry record must contain the minimum data and be cleared on sign-out/tenant switch. Default first release should not persist customer contact, full instructions or tokens in localStorage. A later offline queue/cache needs a separate threat model for shared/lost devices, session expiry, revocation, encryption/key handling and conflict reconciliation. A cached job must never authorize a server command after assignment removal.

Photo upload: user initiated, bounded file count/size/type, tenant+job-owned private object, short-lived upload authorization, completion confirmation, safe thumbnail, unnecessary EXIF removal and retention policy. Private signed URLs must expire and be re-authorized on use; public media buckets are not appropriate for customer/job photos. A failed attachment does not silently disappear from the completion screen.

## Future PWA installation

Phone installation may later add a web manifest, icons, appropriate display mode, HTTPS-only service worker and update handling under the `/worker` scope. Initial worker app can operate normally in a mobile browser without install. Do not cache authenticated API responses, signed media URLs or credentials through an indiscriminate service worker. Clear approved caches on logout/tenant switch; document that previously displayed information cannot be guaranteed erased from screenshots/device backups.

Offline capabilities and push notifications are separate future reviews. Notifications, if added, should use generic 'Your assigned work changed' wording and require authenticated fetch for details; no address, customer phone or gate code on a locked screen. Browser installation is not proof of offline reliability or background execution.

## Required adversarial and experience checks

| Scenario | Acceptance |
|---|---|
| Alter tenant/job/worker IDs in request | No foreign or unassigned data; no assignment existence disclosure through detail/error differences |
| Worker is also tenant member / stale token | Worker route remains minimal; current server capabilities and assignment decide every sensitive read/action |
| Worker removed, reassigned or deactivated while detail/action is pending | Response/action rejected or sanitized under current version; local screen clears stale sensitive fields |
| Two dispatchers claim the last worker/resource or crew roster changes mid-reserve | At most valid available capacity; complete bundle or no hold; no stranded partial reservations |
| Duplicate/out-of-order EN_ROUTE/ARRIVED/COMPLETED commands | Idempotent outcomes, legal edges and expected-version checks; no duplicate history or payment effect |
| Navigation denied, provider missing or offline | Address/list usable; no forced location permission; no hidden external request |
| Customer note contains a URL/script or photo contains EXIF/location | Safe text rendering, validated links and upload processing; no secret/PII in telemetry |
| Network fails after server accepts progress/upload | Retry resolves prior outcome with same key; UI never silently advances or duplicates attachment |
| Worker completes job or asks to cancel | No unauthorized booking refund, payment confirmation, invoice mutation or immediate customer reschedule |
| Shared phone, logout, business switch, session expiry | No prior tenant/assignment data remains accessible through app state or approved caches |
| International address, DST change, different phone timezone | Correct scheduled instant and readable business-local context; no US-only form rejection |
| Low vision / screen reader / small phone | Task and error messages usable without color-only cues, hover, large maps or horizontal navigation |

Acceptance requires Builder → Unit Test → Domain Review → Independent Review → Adversarial Test → Integration Governor → Runtime Guardian → CI → Release Governor. P4/P5/P20/P28 must agree on field visibility, role/assignment predicates and lifecycle boundaries before implementation begins.

## Open baseline limitations remain open

RUNTIME-04 is not fully closed: prior anonymous HTTPS catalog/draft-isolation proof does not certify authenticated cross-tenant/worker transport. RISK-4 remains: platform policies still allow raw payments/refunds/audit reads; worker and map design must not expand that exception. Accepted runtime invariants and no-provider-credential activation rules persist. This specification neither changes current main protection nor grants permission to apply migrations.
