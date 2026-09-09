# Data model gaps

**Status: Proposed — review required.** This is a docs-only product/data audit, not approval to change schema, enable providers, migrate production or implement a worker role.

**Evidence boundary.** Repository inspected at `fb98a7b9feaadb429ca7656430590d790d394a1a`, with migration files `0001`–`0014`. The last separately verified live migration set was **0001–0009**. Repository additions and local tests do not establish that 0010–0014 are deployed. The accepted RC-2 invariants remain the foundation. No code, database, provider key or deployment changed during this audit.

## Four surfaces, one tenant-owned model

| Surface | Data it should receive | Must not receive | Current evidence / gap |
|---|---|---|---|
| Customer checkout / native branded embed | Published catalog, workflow version, pricing estimate, available choices, own scoped request receipt | Other customers, worker roster, internal notes, booking lists, credentials | Existing public catalog/RPC in `supabase/migrations/0007_rls.sql`; connected simple-service request UI in `apps/checkout/src/connected/ConnectedCheckout.tsx`. Durable embed installation/version/origin model is absent. Current receipt is an unconfirmed draft, not a hold or payment confirmation. |
| Business portal | Authorized tenant customers, bookings, worker/team operations, catalog, schedules, invoices and configuration according to permission | Other tenants; raw integration credentials in browser | Existing business-member RLS is coarse. `apps/portal/src/connected/ConnectedPortal.tsx` supports scoped draft reads and service activation; broader portal is still predominantly mocks. Manager/worker permissions and dispatch model are absent. |
| Worker field experience | Assigned jobs, permitted time window, needed customer contact/location/instructions, own actions/uploads | Full customer database, financials, platform configuration, provider keys, other workers' private profile details | No dedicated worker app, job table, worker identity or assignment policy exists in the inspected tree. `resources.kind='crew'` is a capacity label, not authenticated team membership. |
| Lumin Command Center | Permission-gated aggregate counts, operational health and currency-separated economics | Routine raw customer/job/worker PII, gate codes, precise movement trails, credentials | Four aggregate views exist in `supabase/migrations/0008_command_center_views.sql`, hardened by 0009; connected app uses them. Existing financial/audit raw-access exception remains an open baseline risk, not permission to extend that access. |

## Existing foundations and missing entities

Every proposed tenant-owned row requires non-null `tenant_id`; any deliberately platform-scoped record requires a separate reviewed trust model. IDs alone are not tenant authorization.

| Domain | Present in repository | Missing / proposed next model | Boundary / design decision |
|---|---|---|---|
| Identity and business roles | `tenants`, `tenant_members`, `tenant_invitations`, `platform_admins` in `0002_tenants_and_identity.sql`; `TenantRole` in `packages/contracts/src/tenant.ts` | Manager capability model; worker identity/access; permission version; invitation acceptance/revocation workflow | Current business roles are only BUSINESS_OWNER and BUSINESS_STAFF. Do not grant workers the existing broad staff role. |
| Workers | Generic `resources` may describe a technician; no personnel model | `workers`, restricted `worker_private_profiles`, `worker_access`, `worker_skills`, `worker_service_eligibility`, worker working hours/exceptions | Worker fields: name/photo, email/phone, role, skills, service eligibility, hours, base location, status, active flag and permissions. Keep personal/private notes separate from operational profile. Upcoming/completed work is derived from jobs/assignments, not duplicate counters. |
| Teams / crews | Resource kind/capacity in `0012_resources.sql`; pure resource planner in `packages/resources/src/types.ts` | `teams`, effective-dated `team_memberships`, service/team eligibility, assignment expansion/version | A crew is not merely capacity N. Freeze the individual members used for a reservation; changing a roster must not silently change an existing job's assignees. |
| Jobs / dispatch | Bookings and booking history in `0005_customers_bookings_payments.sql` | `jobs`, `job_assignments`, `job_events`, `job_change_requests`, classified job instructions/notes | Job progress is distinct from booking/payment state. Proposed first release: one operational job per booking; preserve a later multi-visit extension rather than overloading booking status. |
| Appointment capacity | Rules, overrides, policies in `0004_availability.sql`; capacity holds and RPCs in 0010; stable carrier locks in 0014 | One atomic reservation bundle spanning appointment capacity, workers/teams and resources | Existing independent calls are not a multi-constraint transaction. Additional worker/crew authority is absent. |
| Resources / locations | `resources`, `locations`, `service_resources`, `resource_reservations`, `service_areas` in 0012; composite tenant links added by 0013 | Quantity-aware consumption, worker-resource linkage, allocation bundle, effective location/zone mapping | `service_resources.quantity_required` exists, but resource RPC counts reservation rows rather than quantities. 0014 fixes overlap locking only, not all allocation semantics. |
| Customers / bookings | Tenant customers, selection/pricing JSON, booking states, payment linkage, history, draft RPC | Permission-safe draft DTO, narrow worker job view, consent/retention decisions; later secure own-booking retrieval if needed | RPC creates `pricing={}`; do not cast drafts into fully priced BookingRecord or show zero as paid. `packages/contracts/src/booking.ts` expects complete price data for its current record type. |
| Merchant payments / invoices | `payments`, `refunds`; refund dedupe addition in 0011; provider contracts in `packages/payments/src/contract.ts` | Durable tenant merchant invoices/lines, adjustments and provider reference mapping | Keep internal invoice UUID/number separate from provider invoice ID. Provider account + provider + external ID scopes external uniqueness; external IDs must not become tenancy authority. Merchant invoice money must never be conflated with platform billing. |
| Platform billing | Mock subscription/invoice provider in `packages/billing/src/provider.ts` | Durable platform billing account, subscription and invoice records behind BillingProvider | Existing in-memory invoice maps are not a database invoice system. MerchantPaymentProvider remains a distinct contract. No real billing credentials proposed. |
| Pricing / templates / workflow / forms | Service/items/addons/questions in 0003; packages/templates and packages/workflow | Immutable template/workflow/form versions, published tenant configurations, validated answer records, eligibility rules | Existing question table supports only a limited set of kinds. Arbitrary JSON must not bypass server pricing or workflow validation. A booking should reference the version used; changing a form must not rewrite historical terms. |
| Calendars / integrations | Connection metadata and four server-only secret tables in 0006; mock/OAuth/calendar contracts in packages/integrations | Durable event bindings, retry/dedupe state, availability freshness, provider capability/readiness records | A 'connected' record is not verified availability. Tokens never belong in public connection DTOs, job payloads, logs or analytics. |
| Media / image jobs | Mock tenant media API in `packages/media/src/storage.ts`; portal/checkout media mocks | Tenant media metadata, private object ownership, assignment-bound attachments, transform jobs, upload quarantine and retention | A URL is not authorization. Worker photos need job+tenant checks and bounded uploads; raw bytes, EXIF and signed URLs must not enter general event/analytics payloads. |
| Maps / geographic coverage | Generic `Address` in `packages/contracts/src/booking.ts`; location address JSON and service-area definitions in 0012 | Replaceable MapProvider, normalized address/coordinate provenance, geocoding freshness/consent, permitted navigation DTO | Postal code, region and country remain international fields. Map pins/route estimates do not grant access or prove availability. No route optimizer or tracking feed required initially. |
| Embeds / business configuration | Public `checkout_settings.branding/flow`, private `tenant_settings` in 0006 | Embed instances, published version, allowed presentation/origin settings, locale/timezone defaults | CORS/origin configuration is not authentication. Native branded embeds cannot acquire privileged data because they run on a business website. |
| Events / analytics / AI | Append-only audit_events, trigger-written booking history; mock realtime/observability packages; aggregate views | Transactional outbox, aggregate projections, action audit, narrow ActionAPI command contracts | AI calls authorized ActionAPI operations; never direct row writes, secret tables or arbitrary SQL. Tenant/assignment/policy decisions are rechecked server-side for each action. |

## Identity and RLS decisions required before worker implementation

**Critical migration hazard:** current policies use `lumin.is_tenant_member(tenant_id)` to grant catalog, customer and booking access (`supabase/migrations/0007_rls.sql`, hardened customer/booking SELECT in 0009). Adding WORKER to `tenant_members.role` and reusing these predicates would grant workers broad business access. App filtering cannot fix that.

Proposed safest additive starting point: a separate `worker_access(tenant_id, worker_id, user_id, active, permission_version)` bridge to Supabase Auth, without automatically inserting the worker into the existing broad staff membership table. An owner who also works in the field may have both authorities; the worker route still uses its narrow DTO. If the product chooses one unified membership table instead, every legacy policy and helper must be audited and split into explicit business-management versus worker-assignment predicates before enabling that role.

| Actor | Proposed server authority |
|---|---|
| Owner | Own business administration and controlled role grants. Cannot self-grant platform powers or expose raw provider secrets through UI. |
| Manager | Explicit operational capabilities such as dispatch, team scheduling and approved catalog edits; no owner/credential administration by default. Requires a reviewed new capability model. |
| Staff | Only explicitly granted business functions. Existing broad staff policy must not silently become the desired fine-grained model. |
| Worker | Active identity plus active assignment to this job; field allowlist and time window; allowed status commands only. No self-assignment or permission changes. |
| Platform administrator | Platform aggregates; no implicit tenant or worker authority. Support exceptions, if ever needed, require a separate reviewed, time-bounded, audited path. |
| AI / automation | Same ActionAPI command authorization as a human caller; explicit principal/capabilities, idempotency and audit. No bypass due to agent identity. |

New tables: ENABLE and FORCE RLS, revoke default privileges, grant only needed verbs. Worker base tables containing private notes/customer detail are not made generally selectable. Prefer a narrow server DTO or reviewed RPC whose authority checks are implemented, with pinned search_path and least EXECUTE grants; never assume SECURITY DEFINER inherits caller RLS. UPDATE commands whitelist columns, compare assignment/version and validate state edges. Read access and write authority must be tested independently.

All tenant relationships should have composite foreign keys `(tenant_id, target_id) → target(tenant_id,id)` and stable unique parent keys. RLS on a child tenant does not validate ownership of referenced IDs. Migration 0013 demonstrates this for service/resource/booking relationships; it does not retrofit every legacy FK. Audit legacy service children, scheduling references, booking/customer/payment links and future invoice/media/form links individually. Nullable links need deliberate MATCH SIMPLE semantics. Reparenting a referenced object must fail rather than silently moving children across tenants.

## Atomic availability across all required constraints

Proposed product semantics: **AVAILABLE → TEMP_HOLD → CONFIRMED**, or **TEMP_HOLD → EXPIRED / RELEASED**. AVAILABLE is a computed result, not a durable assurance. This is a reservation lifecycle, not a new booking/payment state enum.

One server command must validate and reserve every required carrier in a single database transaction: appointment/service capacity + all resource quantities + eligible individual workers + expanded crew members + configured hours/location/area constraints. It must either persist one complete bundle or persist nothing. Independent browser calls to reserve each carrier are prohibited.

Required transaction behavior:

1. Resolve authorized tenant and server-owned service/workflow version; derive requirements, quantities and effective crew roster. Do not trust requested capacity, arbitrary worker IDs or client eligibility claims.
2. Acquire stable tenant+carrier locks in deterministic order, compatible with existing authority locks. Lock/version the relevant roster/configuration while resolving dependencies; on changed requirements retry the whole plan. Keep transactions short and keep map/calendar/provider HTTP outside the transaction.
3. Revalidate interval overlap, buffers, existing commitments, working hours/exceptions, freshness and active/eligible status under the authority lock. Count requested quantities and crew individuals exactly once; prevent assigning a person individually and through a crew simultaneously.
4. Write the complete hold bundle with one expiry, immutable request fingerprint and idempotency key. Same key with changed intent is a conflict, not a successful retry of a different allocation. Partial failure rolls back all rows.
5. At authoritative confirmation, atomically check/consume all still-valid holds and link the resulting commitment. Payment outcome and job creation follow reviewed authority rules; an expired worker/resource hold cannot be ignored because payment succeeded. External compensation must be idempotent and durable.
6. Cancellation/reassignment/reschedule releases or replaces the whole relevant bundle consistently. Reassignment must revoke the old worker's access and grant the new assignment as one controlled operation. Unknown external busy state fails closed where it is a required constraint.

Evidence/limits: `0014_capacity_serialization.sql` serializes overlapping windows on stable service/resource keys under supported READ COMMITTED semantics. It does not add worker/crew holds, quantity-aware bundles, atomic webhook confirmation or a route optimizer. Existing webhook error/ordering/confirmation findings remain open; these documents do not close them.

## Additive migration proposal — not executed or numbered

Integration Governor allocates exact next numbers after reconciling the actual repository and deployed migration ledger. Never edit 0001–0014 or assume the next deploy should apply all pending files automatically.

| Proposed wave | Change | Required owners / review |
|---|---|---|
| A: identity contract | Worker/access/private-profile/skill/eligibility tables; explicit management capability predicates; tenant composite keys and RLS; invitation lifecycle | **P4 Worker/Team Management**, **P28 Security/Tenant Isolation**; Architecture + Security review |
| B: field authority | Jobs, assignments, classified instructions, job history/change requests; worker-safe DTO and action RPCs | P4 + **P5 Worker Mobile/PWA** + P28; independent assignment and field-leak attacks |
| C: allocation | Effective crew membership, worker working hours/exceptions, quantity-aware hold bundle and atomic reserve/consume/release | Scheduling/resources owner coordinated with P4/P28; Runtime + Integration Governors |
| D: geography/media | International normalized locations/zones, MapProvider bindings, private job attachments and upload policy | **P20 Maps** + P5 + media owner + P28; explicit external-data consent |
| E: wider product gaps | Merchant invoice/versioned form/embed models; outbox/aggregate projections; ActionAPI commands | Relevant domain owners plus P28; preserve platform/merchant and raw/aggregate separation |

Each wave needs non-destructive preflight for inconsistent existing rows, lock/downtime assessment, fixture migration tests, permission-negative tests and a reviewed rollback/forward-repair strategy. Dirty data should stop migration with diagnostics that exclude PII; no automatic destructive cleanup.

## Acceptance evidence before any release

- Forged tenant links, foreign worker/crew/resource IDs, assignment enumeration and self-escalation fail at database/server boundary.
- Unassigned, revoked, outside-window and inactive workers cannot fetch field details or signed attachment URLs, even with a previously known job ID.
- Dispatcher sees only permitted tenant data; platform role cannot read worker/customer details through a new view or function.
- Concurrent final worker/resource/crew claims grant at most available capacity; mixed quantities, roster changes, expiry-at-confirm, partial failure and idempotency replay are proven independently.
- Job completion cannot confirm payment, issue refunds, edit invoices or silently rewrite booking financial state.
- Timezones/DST, international addresses, cross-currency totals and internal/provider invoice references have explicit test fixtures.
- Mobile/network retries never display queued changes as server-confirmed; all privileged or financial actions remain online and authorized.
- Audit/analytics samples contain only approved fields. No token, credential, customer address, gate code, worker private note or full upload payload escapes its designated boundary.

This document proposes gaps and ownership. It is not a full product implementation or a signoff on any pending schema change.

## Baseline tracking note

Program Governor reports protected current main `152bb9`; the working candidate inspected here is `fb98a7b` (latest reported CI 34380365813 succeeded). These are distinct facts. Accepted RC-2 is exact commit `6bbcd679a09741d3a2e978ddd2bb398f1d98a6f9`; the previously documented baseline tag was absent. Live migration application remains last audited as 0001–0009. RISK-4 explicitly remains the platform raw-read policies for **payments, refunds and audit_events**; do not expand them with worker/job/map data. RUNTIME-04 remains open after limited anonymous HTTPS proof because authenticated cross-tenant transport has not been fully certified. No schema application is proposed as an action in this document.
