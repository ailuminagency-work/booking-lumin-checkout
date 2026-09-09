# Parallel workstream plan

Status: **PROPOSED — queues defined; implementation not launched**. Date: September 9, 2026.

## Control plane and operating limit

The 28 queues below replace the earlier 18-workstream taxonomy for future implementation. Existing work is mapped into these queues, not discarded. Six governor roles are accountable decision points, not a claim of six simultaneous independent people. This session supports four active agents: coordinator plus up to three audit/build/review cells. Persist queue state and rotate bounded assignments; do not invent 28 running agents or promise unattended persistence across sessions.

| Governor | Responsibility and blocking authority |
|---|---|
| Program | Product priorities, decision log, dependency-ready queue and acceptance scope. |
| Architecture | Shared schemas, route boundaries, provider interfaces and compatibility decisions. |
| Security | Tenant/role model, secrets, public projections, attack coverage; can block unsafe contracts. |
| Integration | Owns shared-file changes, lockfile, CI, migrations allocation, combined candidate and cross-domain wiring. |
| Runtime Guardian | Protects accepted behavior and exact baseline; verifies rollback and no live drift. |
| Release | Confirms evidence for exact candidate, deployment scope and authorization before promotion. |

Independent reviewers and adversarial testers cannot approve code they built. If a person/agent serves multiple non-independent role checkpoints, record that fact; never count role names as independent approvals. In this planning turn, three auditors write bounded documents while the Program Governor writes product/migration/coordination plans and checks consistency.

## Workstreams and first bounded increments

Paths are ownership proposals, not permission to create all packages. Existing paths are preferred; new paths are marked proposed. At dispatch allocate exact files, base SHA and interface versions. UI domain ownership does not permit edits to P25's shared router.

| ID | Persistent workstream | First increment after review | Owned boundary | Prerequisites |
|---|---|---|---|---|
| P1 | Product Information Architecture | Freeze nav/routes/redirect manifest and journey acceptance | Product specs/route descriptors | User review |
| P2 | Portal Dashboard | Today/attention view from safe aggregate DTO; no invented zeros | Portal dashboard page | P1, P3/P6 read contracts, P27 health DTO |
| P3 | Booking Operations | Detail/actions contract and audit timeline; idempotent action harness | Booking domain + portal detail | P23, P28, P14, P8 for capacity changes |
| P4 | Worker/Team Management | Identity, crew membership and eligibility schema/permissions | Proposed workforce module; worker portal pages | P1, P28, P23 |
| P5 | Worker Mobile/PWA | Today/assigned-job read surface and permitted status actions | Proposed `apps/worker` | P4, P3, P28; P20 navigation optional |
| P6 | Scheduling/Calendar | Calendar view projection and timezone-aware hours editor | `packages/core` scheduling slice; portal calendar | P1, P8 contracts; P4 for worker view |
| P7 | Resource/Rental Engine | Inventory/quantity allocation contract; rental date-first fixtures | `packages/resources`; portal resource inventory | P9, P8 transaction contract |
| P8 | Capacity Hold/Concurrency | Combined service/resource/worker/crew reservation transaction | Allocated DB functions/tests; core hold contract | P4/P7 resource requirements, P28 |
| P9 | Service Management | Versioned catalog/rule references and service editor adapters | Service domain and portal services | P1, P23/P28, P14/P10 contracts |
| P10 | Workflow/Question Engine | Full field/answer schemas, dependency validation and rule limits | `packages/workflow` | P1, Architecture contract freeze |
| P11 | Embed Builder | Draft editor + publish-validation UX using shared renderer | Portal embed editor; draft/publication contract | P10, P9, P14, P12 renderer contract, P28 |
| P12 | Embed Runtime | Published-version renderer + safe install/hosted loader contract | `apps/checkout`; proposed shared renderer/loader package | P10, P11 publication contract, P23/P28 |
| P13 | Media/Image Engine | Tenant asset lifecycle/private evidence split; bounded variants | `packages/media`; portal media | P28, P23; P22 jobs before durable transforms |
| P14 | Pricing | Unit/rule coverage and immutable authoritative quote contract | `packages/core/src/pricing.ts` and pricing domain | P9 schema contract, P10 effect contract |
| P15 | Invoices | Internal invoice/line/payment allocation model with fake delivery | Proposed invoice domain; portal invoices | P14, P16 normalized payment, P23/P28 |
| P16 | Merchant Payment Adapters | Old/new contract bridge, readiness routing, atomic finalization tests | `packages/payments` + allocated adapter slice | P8, P14, P23, P28; P22 retries |
| P17 | Platform Billing | Subscription/entitlement projections and financial definitions | `packages/billing` | P23/P28; separate from P16 GMV |
| P18 | Calendar OAuth/Adapters | Tenant-bound fake OAuth reconnect/revoke + event sync contract | `packages/integrations` calendar/OAuth slice | P23/P28, P22, P6 authoritative events |
| P19 | Email/SMS Integrations | Template/event projection and fake delivery retry/dedupe | Allocated notification adapter slice | P22, P23/P28, P21 |
| P20 | Maps | Replaceable navigation-link/map contract and consent/privacy UX | Proposed map adapter; portal map panel | P3 address DTO, P4 assignment, P21/P28 |
| P21 | Internationalization | Field terminology, timezone/currency fixtures and translation keys | `packages/i18n` | P1; supports every UI contract |
| P22 | Realtime/Event System | Transactional outbox/inbox, authorized subscriptions and reconnect | `packages/realtime`; allocated persistence/jobs | P23/P28 event/security contract |
| P23 | Render API Backend | Modular API host, verified auth context, action transport and jobs | Proposed API/worker services | Architecture + P28 contract freeze |
| P24 | AI Booking Action API | Typed allowlist façade and confirmation/replay attack harness | Proposed AI action adapter | P3/P4/P6/P23/P28; no row access |
| P25 | Business Portal UX | Single shell, role-aware routes and shared data adapter | Portal App/Layout/shared UI | P1, P23 auth/capability contracts |
| P26 | Lumin Command Center | Eleven-route shell and aggregate DTO composition | `apps/command-center` | P17, P22/P27, P28; mock fixtures initially |
| P27 | Observability/System Health | Metric definitions, freshness/readiness states and collectors | `packages/observability` | P23/P22; P28 redaction |
| P28 | Security/Tenant Isolation | Actor/data matrix, resource composite-FK and HTTP/RLS attack fixtures | Security contracts + allocated RLS tests | Phase 0; continuously blocks dependent work |

Cycles above are resolved by freezing contracts before implementation. Examples: P11 and P12 agree Publication/Renderer contracts before either editor/runtime builder proceeds; P9/P10/P14 freeze service/rule/effect IDs before parallel code; P4/P7/P8 freeze resource requirements before transaction and UI work. Do not schedule a cyclic set as mutually waiting builders.

## Dispatch waves

1. **Review only now:** complete nine artifacts and reconcile conflicting proposals. User review is a prerequisite, not a governor self-approval.
2. **Contract wave after approval:** P1/P28/P23 auth/actions, P22 durable outbox/jobs, P10/P11/P12 flow publication, P4/P7/P8 assignment/capacity, P9/P14 catalog/quote, P16/P17 financial split. Reserve shared schema edits centrally. Three active cells work on distinct contract groups; rotate reviewers before merging.
3. **Safe leaves:** P21 fixtures, P13 bounded media, P20 navigation, P17 billing, P27 metric definitions against frozen mocks. Product shell P25 runs independently once route/auth contracts settle.
4. **Operational vertical slices:** Builder→runtime→persisted draft; then worker/calendar/resource operations; then fake payment→invoice→events. Finish one full journey before widening the preset catalog.
5. **Platform and pilot:** P26 consumes real aggregate projections; P24 uses proven actions; P22/P27 recovery/load tests. No provider activation by this wave designation.

## Verification teams

| ID | Team | Minimum evidence and blocking conditions |
|---|---|---|
| V1 | Product UX Review | Owner setup, customer booking, worker execution and platform investigation have complete understandable journeys. |
| V2 | Architecture Review | Single domain authority, no app imports into core, immutable publication, explicit compatibility paths. |
| V3 | RLS/Tenant Attack | Actual anonymous/owner/manager/staff/worker/platform identities; forged tenant/nested IDs and revoked assignments fail. |
| V4 | Scheduling Race Tests | Simultaneous holds, overlap/DST, reschedule versus cancel/confirm, TTL expiry and outage fail closed. |
| V5 | Rental/Resource Race Tests | Exclusive and pooled quantity, multi-resource atomicity, crew membership overlap, cleanup/setup windows. |
| V6 | Payment Integrity | Authoritative amount/currency, duplicate/reordered callbacks, failed finalization, deposit/refund/invoice reconciliation. |
| V7 | OAuth Security | Bound state/PKCE/redirect URI, callback replay, tenant substitution, token redaction and revoke/reconnect. |
| V8 | Mobile/Responsive | Small phone/tablet/desktop; field controls, iframe resize, keyboard, slow/reconnected network. |
| V9 | Accessibility | Keyboard reorder alternative, focus recovery, form errors, contrast, screen-reader status, reduced motion. |
| V10 | Performance | Tenant-scoped queries/indexes, bounded lists/DSL/media, measured concurrent tenants, noisy-neighbor limits. |
| V11 | Internationalization | Postal labels/address shapes, timezone DST, currency minor units, translations and RTL layout readiness. |
| V12 | Regression | Accepted B/R invariants, old URLs/presets, persisted in-flight sessions, exact candidate builds/CI. |

Temporary specialist cells are bounded assignments to these queues (e.g. DST, embed-origin abuse, storage policy, payment replay). They do not get new shared-path ownership or release rights.

## Required loop and evidence record

Builder → tests → Domain Lead → independent reviewer → adversarial tester → Integration Governor → Runtime Guardian → CI → Release Governor.

Each record contains workstream, requirement IDs, base/candidate SHA, exact files, contract/migration versions, test commands/results, reviewer identity and independence, attack evidence, unresolved risks, rollout/rollback plan and release scope. Failed gates return to the builder. Fixes invalidate affected reviews/tests; do not skip failing suites or label fake transport proof as live proof.

Only Integration Governor updates root manifests/lockfile, central routes, shared contracts, CI or migration numbering, using reviewed domain contributions. Every builder uses an isolated branch/worktree. Read-only reviewers may inspect the combined candidate; no simultaneous writes to its source. Merges use protected PRs, no direct main experiments. Netlify auto-build success never bypasses database CI or Runtime/Release review.

Persistent queue states: PROPOSED → READY → BUILDING → TESTING → DOMAIN_REVIEW → INDEPENDENT_REVIEW → ADVERSARIAL → INTEGRATING → RUNTIME_REVIEW → CI → RELEASE_REVIEW → ACCEPTED. BLOCKED includes named dependency; REWORK returns to owning builder. In this document batch all implementation queues remain PROPOSED.

## Current-to-new work mapping

Prior core/template/workflow work maps to P9/P10/P12/P14; scheduling/holds/resources to P6/P7/P8; billing/merchant/routing to P17/P16; identity/OAuth/calendar to P18/P23/P28; media to P13; checkout/portal/CC to P12/P25/P26; events/i18n/observability to P22/P21/P27. New distinct queues cover worker identity/mobile, maps, invoices, Render host and AI action façade. Existing reviewed security fixes stay in their candidate history; a taxonomy change never resets the accepted runtime or erases evidence.
