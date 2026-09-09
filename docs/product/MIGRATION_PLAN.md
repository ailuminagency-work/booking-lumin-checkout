# Safe product reorganization and migration plan

**Status: Accepted target architecture, September 9, 2026.** Implementation proceeds through reviewed increments; current completion and hosted acceptance are recorded in `wave-ledger.json` and `EXECUTION_WORKFLOW.md`. The audit below describes its original inspected baseline, not current deployment. Real provider activation remains separately prohibited.

Original audit foundation: `fb98a7b9feaadb429ca7656430590d790d394a1a`; accepted RC-2 is a separate protected historical foundation. This plan authorizes no live migration or deployment.

## Preservation strategy

Use an incremental replacement: introduce contracts and adapters beside working behavior, migrate one complete journey, compare results, then retire only the superseded caller. Keep existing routes as compatibility aliases. Do not rewrite the three apps, copy verticals or change accepted migration files. The new worker app is a separate shell with a deliberately smaller API surface.

The codebase currently contains rich mock UIs and narrower connected entrypoints. Converge their shell and rendering behavior while keeping explicit fake/connected data adapters. Do not hide unfinished connected pages behind sample data. Show “Not configured,” “Not connected,” “No data yet,” or an actionable error as appropriate.

## Phase gates and dependency order

| Phase | Scope and primary owners | Entry requirement | Exit evidence | Rollback |
|---|---|---|---|---|
| 0 — Product agreement | Nine documents, page map, domain ownership, open decision log; P1 + governors | Read-only audit completed | Product owner reviews CURRENT/TARGET/GAPS/REUSE/MOVE/BUILD/DEFER; decisions recorded | Revise proposal only; no runtime affected. |
| 1 — Contract and authorization foundation | P23/P28 typed Action API/auth contexts; P22 outbox/job foundation; P10/P11 publication contracts; P4 worker role model; P17/P16 payment boundaries | Phase 0 accepted; exact contracts allocated | Contract fixtures, threat model, backward-compatibility tests; baseline tests unchanged | Leave new endpoints/features disabled; retain old entrypoints. |
| 2 — Portal structure and unified shell | P1/P25 with P2/P3/P9: nav regrouping, route aliases, shared data-adapter interface | Route and permission contract review | Existing tasks still reachable; browser refresh/deep links, owner/staff permissions, mobile keyboard/accessibility tests | Revert route manifest/feature flag; aliases remain; no data deletion. |
| 3 — Builder draft to request flow | P10/P11/P12/P13/P14: versioned draft, minimum field registry, shared preview/runtime, public projection and install | Durable tenant flow/version/asset/rule contracts; controlled action APIs | Owner publishes cleaning + detailing fixtures without source edits; browser request persists; old versions remain stable; rejected config cannot publish | Repoint published alias to prior approved immutable version for new sessions; existing sessions keep pinned version. |
| 4 — Scheduling and field operations | P4/P5/P6/P7/P8/P20: workers, crews, eligibility, assignments, authoritative multi-constraint holds, mobile today/jobs | Reviewed worker RLS and action transitions; phase 3 valid selection/time contracts | Two tenants, overlapping bookings, multi-member crew collision, inactive worker, DST, cancellation and stale assignment attacks; mobile field journey | Disable new offers/assignment changes, preserve confirmed jobs; never release committed capacity merely by rollback. |
| 5 — Financial and provider-neutral operations | P14/P15/P16/P17/P18/P19: quotes/invoices, fake customer payment completion, subscription separation, connection UI, notification/calendar jobs | Transactional finalization and durable event contract; phase 4 scarce-capacity gates | Retry/reorder/failure tests, invoice reconciliation, GMV ≠ platform revenue, OAuth fake callbacks tenant-bound, no credentials in clients | Stop new provider actions; reconcile in-flight operations using durable idempotency; do not downgrade schema or replay charges. |
| 6 — Platform operations and controlled pilot | P22/P23/P24/P26/P27/P28; dashboards consume minimized actual telemetry, AI uses same actions | End-to-end operational slices and residual baseline risks resolved for pilot scope | Measured isolation/load/failure recovery; hosted provenance; genuine authenticated tenant/admin/worker tests; incident and rollback drill | Route traffic to prior approved artifact and compatible API; drain jobs safely and retain outbox. |
| 7 — Optional activation/expansion | Real providers, PWA enhancements, more vertical presets | Separate explicit activation authorization and provider-specific certification | Staging provider test evidence, rollout monitoring and reconciliation | Provider-specific revoke/disable plan; never assume removing a UI disconnects server credentials. |

These phases are dependency waves, not calendar estimates. Independent contracts or offline fixtures can proceed in parallel after Phase 0; no phase label permits an incomplete money/capacity workflow to be released. Every phase still passes the full governor sequence.

Phase 4 field-operation testing uses synthetic jobs or already approved confirmed bookings only. Phase 3 draft/request-only submissions are never automatically dispatched or relabeled confirmed. New scarce-capacity customer confirmation waits for the reviewed transactional finalization in Phase 5 and all applicable runtime gates. A no-payment/pay-later confirmation path needs a separate approved business-policy and state-machine change; it cannot be introduced through phase ordering or a builder switch.

P22's durable event envelope, outbox and job-lease foundation starts in Phase 1 and is proven before provider consumers in Phase 5. Phase 6 adds operational dashboards, recovery/load certification and controlled pilot evidence; it is not the first introduction of delivery durability.

## Safe movement map

- Portal `/availability` → `/calendar/availability`; preserve query/date state and explain the new location once.
- `/resources` → `/services/resources`; Calendar resource view links to inventory rather than copying it.
- `/checkout` → `/embed`; copy existing branding/settings into a draft only after schema validation. Never manufacture a published production flow from an unreviewed mock setting.
- Existing `/services/:serviceId` remains compatible; reserve static `resources` paths before dynamic service IDs in route matching.
- Command Center `/economics` → `/financials`; preserve merchant/platform tab intent. Existing `/bookings` becomes aggregate economics/throughput, not raw booking lookup.
- A move changes discoverability, not permission or data ownership. Backend authorization is independent of old/new route.
- Existing hosted `/checkout/` remains supported until installed customer links have a migration policy. Loader versioning and new flow URLs must not break old embeds without notice.

## Database expansion and data movement

1. Reconcile exact repo migration sequence, live schema inventory and historical fixtures before allocating any new number. Repository has 0001–0014; last verified live baseline has 0001–0009. The `_deferred` file is not a shortcut. Do not apply candidate migrations merely because they are present.
2. For each proposed entity in DATA_MODEL_GAPS, define tenant key, foreign keys, allowed actor/action matrix, retention and indexes before SQL. No personal/financial table becomes temporarily public for migration convenience.
3. Expand with additive tables/nullable compatibility columns, constraints, RLS and narrowly granted transactional functions. Existing accepted files remain immutable. Preflight dirty or cross-tenant rows and fail safely; no silent deletion or automatic reparenting.
4. Backfill per tenant in bounded, resumable, audited batches from verified persisted configuration only. Record source version, checksums, row counts and rejects. Do not migrate demo arrays as customer data.
5. Compare old/new read projections and deterministic quote/availability results in a synthetic/staging shadow harness. Use one authoritative writer; avoid dual writes to unrelated stores.
6. Cut over behind server-evaluated tenant flags. New sessions use new published version; existing sessions/holds/bookings retain compatible snapshots. Validate release-time configuration and pending-job schemas.
7. Retire only after observed usage, retention and compatibility windows are approved. Destructive contract/drop migrations require a separate decision and recovery plan. Browser/service worker caches are included in rollback testing.

## Pilot acceptance matrix

| Journey | Required proof |
|---|---|
| Cleaning | Bedroom/bathroom/add-on answers alter authoritative quote; date/time and eligibility rechecked; customer location localized. |
| Detailing | Vehicle/package/mobile-or-shop conditions change fields through reusable rules; hidden stale answers cannot affect price. |
| Vehicle rental | Dates precede verified inventory offers; exclusive vehicle cannot be held/booked twice; deposit is distinguished from paid/captured funds. |
| Tent/equipment rental | Quantity, interval, delivery/setup buffers and scarce resource requirements compose atomically. |
| Junk removal | Existing cart preset migrates without a new app; quantities, areas and minimum/maximum rules still validate. |
| Worker | Worker A sees assigned jobs only, cannot read worker B or tenant B data, cannot self-assign or alter price/payment; revocation takes effect. |
| Owner/manager/staff | Allowed operations succeed; prohibited actions fail through direct HTTP/RPC attempts as well as UI. |
| Platform | Aggregates usable, financial definitions explicit, sparse-tenant leakage controlled; raw PII routes absent. |

Across these journeys: small-phone/tablet/desktop; keyboard-only; reduced motion; screen-reader status; translated postal fields; DST gaps/folds; currency minor units; tenant mismatch in nested IDs; reconnect/offline/expired session; duplicate/out-of-order events; provider downtime; stale published version and redirect/origin abuse.

## Runtime and release guardrails

Preserve B1–B6/R1–R9 from `docs/BASELINE_INVARIANTS.md` while correcting its historical environment notes. Keep current confirmation/payment authority until a separately reviewed policy extends it. Close genuine Auth transport coverage (RUNTIME-04) and residual financial/audit access (RISK-4) before broad live pilot. Treat known hold/payment finalization gaps in `docs/CONTINUATION_PROGRAM.md` as defects to reproduce, not closed by a nav refactor.

The separate September 9 Netlify site audit recorded deployment and GitHub linkage pending permission; this source-only reorganization audit does not re-certify live deployment state. Reorganization does not grant permission to expand app access or activate external providers. Later releases must first refresh that operational evidence, then verify matching commit/build provenance, correct public runtime configuration, actual hosted route/refresh tests and authenticated cross-surface behavior. Netlify's passing build alone does not stand in for GitHub database checks or the Release Governor.

No product code is changed in this document phase. Document review checks are coverage, traceable current-source evidence, coherent dependencies, security consistency and executable migration sequencing. New code phases require Builder → tests → Domain Lead → independent reviewer → adversarial tester → Integration Governor → Runtime Guardian → CI → Release Governor. Failures return to the builder; affected downstream approvals are invalidated.
