# Booking Lumin Checkout — Recovery Status After Session / Credit Outage

**Reconstruction date:** 2026-09-26
**Repository:** `ailuminagency-work/booking-lumin-checkout`
**Scope:** read-only reconstruction of GitHub, CI, repository evidence, Supabase, Render access, Netlify evidence, and recovery ledgers. No migration, deploy, merge, credential activation, or provider connection was performed.

This document is the authoritative recovery snapshot for the interrupted recovery/merge program. A branch, passing local test, draft PR, or hosted preview is not treated as production proof.

## 1. Executive Summary

The intended recovery stack did not fully merge. PR #75 and PR #76 are merged into `main`. PR #78 (R2b confirmation authority), PR #77 (one-tenant-one-profile), and PR #79 (service-slot overbooking backstop) remain open and unmerged. The current protected `main` is green at `c5663c59e134e71beb511f509b3287ab0046bdff`, but it is not the fully recovered live system.

The clean Booking Lumin Supabase project is active and healthy, but its live migration history stops at `0009_rc2_hardening`. The repository `main` contains migrations through `0031_overbooking_backstop.sql`. Therefore capacity holds, resource reservations, durable outbox, flow storage, allocator, worker/planning, and the resource overbooking backstop in repository `main` are not present in the live database. The service-slot backstop (`0033`) and profile activation (`0032`) are only on open draft branches.

The hostable API and three frontend surfaces exist in the repository. No current evidence proves that a Booking Lumin Render API service is deployed or that the Netlify frontend is connected to it. The last independently observed Netlify preview was an in-memory demo build from `bea04b4fde8b3b709104f455148bc7f28f339150`; it was not synchronized with current `main` or the active Supabase runtime. Current Render connector access is unauthorized, and the Netlify connector is unavailable in this session.

Real payment, calendar, email, SMS, CRM, and map providers are not connected. Provider credentials remain excluded by authorization. The recovery program must stop at this truth reconstruction until the hosted topology and migration drift are resolved through separately reviewed changes.

## 2. Current Main

| Check | Evidence-backed result |
|---|---|
| Current `main` HEAD | `c5663c59e134e71beb511f509b3287ab0046bdff` |
| Latest recovery merge | PR #76 merge commit; PR #75 is its coherent-tree predecessor |
| PR #75 in `main` | Yes — merged as `d7a88974d9481fdb4b944a7a05b323ed14d0b89f` |
| PR #76 in `main` | Yes — merged as `c5663c59e134e71beb511f509b3287ab0046bdff` |
| PR #78 in `main` | No — open and unmerged |
| PR #77 in `main` | No — open and unmerged |
| PR #79 in `main` | No — open and unmerged |
| Main CI | Green: `verify` and `database (migrations + RLS attack suite)` both succeeded on the current HEAD |
| Branch protection | Protected according to the accepted baseline and prior remote verification; the current GitHub integration cannot read the protection endpoint (403), so the exact rule JSON is not reproduced here |
| Local worktree | The inspection checkout is `codex/product-owner-shift-client` at `eb34e00d609f18923ca809c66c8edae53526ec43` and has one untracked directory, `main-field-v3-preview/`; this is not the protected `main` checkout |

**MAIN STATUS: PARTIAL**

The branch is green and protected, but the intended recovery stack is only partially present and the live runtime is not reconciled to it.

## 3. Recovery PR Status

| PR | Intended work | State | Base / head | CI / runtime conclusion |
|---:|---|---|---|---|
| #75 | Consolidated coherent tree: C1–C5, migrations through `0031`, notifications, events | MERGED | `main` ← `integration/consolidated` at `1b291e120724d0d550b8058fa39a5b5021c620a5` | Merged; repository evidence says full local tree and database suites passed |
| #76 | R2a hostable `apps/api` foundation and real Supabase-JWT entrypoint | MERGED | `main` ← `feat/r2a-api-foundation` at `b2ac7b9a7d92ffec9ac4f5d5a4ff021d142f9619` | Merged; no Render service/runtime acceptance is proven |
| #78 | R2b single booking-confirm authority | OPEN, non-draft | `main` ← `feat/r2b-confirm-authority` at `c0336cc537dcc6319cd196d1e0dc3582544f1176` | CI run `35794907552` succeeded; unmerged and not live-verified |
| #77 | R3 one tenant → one activated business profile | OPEN, non-draft | `main` ← `feat/r3-business-profile` at `62bd97af57b903655bca0651dccb6f1981ad303a` | CI run `34902254585` succeeded; migration `0032` is not live |
| #79 | R1b service-slot confirmed-booking backstop (`0033`) | OPEN, non-draft | `feat/r3-business-profile` ← `fix/r1b-service-slot-backstop` at `d64a962551bdecc16b96d9dc329a028d63e7e9ce` | CI run `34906319850` succeeded; migration `0033` is not live |

Later W3/W4 candidates remain draft and unmerged. PR #93 (owner planning route), #94 (connected inactive template adoption), #95 (native disposable-PostgreSQL planning proof), and #96 (durable service-adoption intent journal) are review candidates only. PR #96 exact CI `36265143117` succeeded and an independent Release Governor approved it as a protected draft candidate, while explicitly recording that the API and Portal do not yet use the intent journal.

An additional W3 API integration was completed locally on branch `codex/main-template-adoption-api` at `a2b69dbb60c01c407e94c618c459d7fc97c0f1a6` (24 adoption tests, 5 HTTP tests, API typecheck, and diff check passed). It was not pushed and has no PR; it is therefore `IMPLEMENTED ON BRANCH ONLY`, not merged or runtime verified.

## 4. Runtime Topology

| Surface | Repository evidence | Runtime evidence |
|---|---|---|
| Customer checkout | `apps/checkout` exists with connected and demo paths | Hosted current synchronization is unverified; last public preview was demo/in-memory |
| Business portal | `apps/portal` exists with connected/demo routes and local contracts | No authenticated hosted owner acceptance is proven |
| Lumin Command Center | `apps/command-center` exists with aggregate-oriented views | No deployed/current connected runtime is proven |
| Booking Lumin API | `apps/api`, Dockerfile, `render.yaml`, `/health`, `/ready`, real-auth entrypoint | `RENDER API: NOT DEPLOYED` based on available evidence; current Render access is unauthorized |
| Supabase | Project `pplwyfbxrnodimhzlvdl`, “Booking Lumin Checkout”, `ACTIVE_HEALTHY` | Active project confirmed through Supabase management channel |
| Provider edge functions | `create-payment-intent` and `stripe-webhook` exist in repository | Live Edge Function list is empty |

The API `render.yaml` declares secret names only and intentionally contains no values. That file is deployment configuration, not proof that a service was created, configured, or deployed.

## 5. Supabase Status

Target project: `pplwyfbxrnodimhzlvdl` (“Booking Lumin Checkout”), region `us-east-1`, Postgres 17.6.1, status `ACTIVE_HEALTHY`.

Read-only management-channel findings:

- Auth users: **PRESENT — 5 rows**. These are the clean-runtime test identities/fixtures described by RC-2 evidence, not proof of a production onboarding population.
- Tenants: **PRESENT — 2 rows, both active**.
- Current public fixtures: **PRESENT** — 2 services, 3 customers, 4 bookings, 2 payments, and 2 mock payment connections.
- Payment connection secret rows: **PRESENT — 2 rows**. Values were not read or exposed; provider rows identify mock fixtures, not live credentials.
- Calendar connections/secrets: **ABSENT — 0 rows**.
- Notification connections/secrets: **ABSENT — 0 rows**.
- Webhook connection secrets: **ABSENT — 0 rows**.
- Edge Functions: **ABSENT from the live project list**.
- Payment/calendar/email/SMS integrations: **NOT CONNECTED**. The only live connection rows are mock payment fixtures.
- Legacy Stripe webhook: **NOT DEPLOYED / NOT PROVEN**. No live Edge Functions were listed; repository code alone is not deployment evidence.

The RC-2 report correctly records that the database authorization boundary was attacked through the management/SQL channel, while GoTrue-issued JWT login and Supabase PostgREST over HTTPS remained egress-blocked. That transport gap remains open.

## 6. Render Status

`RENDER API: NOT DEPLOYED` for this reconstruction.

The repository contains `apps/api/render.yaml` for a service named `lumin-api`, with `healthCheckPath: /health`, `autoDeploy: false`, and secret names `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OWNER_ORIGINS`, and `CUSTOMER_ORIGINS`. The current Render connector returned `unauthorized` and no workspace could be selected in this session, so no current service ID, branch, deploy status, health check result, environment configuration, or last deploy can be asserted. Earlier evidence recorded a Render inventory containing only LeadGate services; that is historical evidence, not a current Booking Lumin deployment receipt.

## 7. Netlify Status

The last direct browser evidence recorded:

- `https://gregarious-longma-6158.netlify.app/` displayed the Demo Services Co checkout.
- `https://codex-reviewed-preview--gregarious-longma-6158.netlify.app/` displayed checkout, portal, and command-center links with an explicit in-memory/demo/no-Supabase-sync/provider-simulation notice.
- Its public `build.json` reported source commit `bea04b4fde8b3b709104f455148bc7f28f339150`, built at `2026-09-10T16:42:31.952Z`, mode `demo-in-memory`, persistence `none`.
- The guessed bare `sage-kangaroo.netlify.app` URL was previously observed as 404; this does not identify the actual Netlify site or prove its deployment settings.

Those URLs could not be rechecked through the current web connector, and no Netlify connector is available in this session. Therefore:

`NETLIFY CURRENT SYNC: UNKNOWN`
`LAST VERIFIED PREVIEW: STALE DEMO BUILD, NOT LIVE OPERATIONS`

The available evidence does not show a current checkout/portal/command-center deployment sourced from protected `main`, pointed at the Render API, and reconciled to the active Supabase project.

## 8. Migration Status

### Repository main

`main` contains `0001` through `0031_overbooking_backstop.sql`. The `_deferred/` directory remains present as historical documentation and is not part of the applied migration glob. PR #77 proposes `0032_business_profile.sql`; PR #79 proposes `0033` service-slot protection; neither is in `main`.

### Live Supabase

The live migration history is exactly:

`0001_extensions_and_helpers` through `0009_rc2_hardening`.

Migrations `0010–0031` are **not applied**. `0032–0033` are not in `main` and are not live. No `0034` intent migration is live. The live database has no evidence of capacity holds, resource reservations, later worker/planning, flow storage, allocator, or service-adoption intent structures.

`REPO MIGRATIONS: 0001–0031 on main; 0032–0034 only on review branches`
`LIVE MIGRATIONS: 0001–0009`
`DRIFT: YES`

No migration was applied during this reconstruction.

## 9. Security / Tenant Isolation

The strongest verified state is the RC-2 clean-project database boundary:

- RLS is enabled and forced on the live tables created through `0009`.
- Cross-tenant private reads and writes, forged tenant IDs, role escalation, illegal financial transitions, secret-table reads, and platform/tenant trust confusion were attacked through the management SQL channel and passed the recorded RC-2 suites.
- Secrets are not exposed to browser-readable tables through the accepted `0001–0009` surface.
- Real Auth/PostgREST HTTPS transport remains **UNVERIFIED** because project-host egress was blocked.
- Later repository-only migrations and API surfaces have not been applied or hosted-verified.

Status: `STAGING VERIFIED` for the database authorization boundary; `MERGED BUT NOT RUNTIME VERIFIED` for the hostable API/auth entrypoint; `UNKNOWN` for full hosted HTTP acceptance.

## 10. Booking / Availability / Overbooking

- Booking reserve path: repository SQL and local/CI evidence exist, but migration `0010` is not live and no deployed API route is proven — `MERGED BUT NOT RUNTIME VERIFIED`.
- Booking confirm authority: PR #78 is open and unmerged — `IMPLEMENTED ON BRANCH ONLY`.
- Payment authority: repository Stripe Edge Function and adapter code exist, but live functions and credentials are absent — `MERGED BUT NOT RUNTIME VERIFIED`.
- Capacity holds: repository `0010` exists, live migration does not — `MERGED BUT NOT RUNTIME VERIFIED`.
- Resource reservations: repository `0012` exists, live migration does not — `MERGED BUT NOT RUNTIME VERIFIED`.
- Resource overbooking backstop: repository `0031` is in `main`, live database is behind — `MERGED BUT NOT RUNTIME VERIFIED`.
- Service-slot overbooking backstop: PR #79 / migration `0033` remains open — `IMPLEMENTED ON BRANCH ONLY`.

No complete vehicle-rental hold/second-customer/one-confirmed flow has been executed against the intended hosted runtime.

## 11. Business Profile Isolation

The profile registry, set-once tenant activation, and portal/embed gating are implemented in PR #77 only. They are not in `main`, and `0032` is not live. The live database has no `tenants.profile_key` evidence. Status: `IMPLEMENTED ON BRANCH ONLY`.

## 12. Embed / Portal Status

The three applications and shared flow/runtime packages are present in repository `main`. Local review candidates cover flow storage, configurable request fields, connected context isolation, draft clients, and inactive template adoption. They remain draft candidates and do not prove hosted operation.

- Workflow engine: `PARTIAL` — contracts, local storage, and bounded local journeys exist; full hosted/API authority is not connected.
- Embed runtime: `PARTIAL` — customer/owner rendering and local connected seams exist; current public preview is demo/in-memory.
- Service CRUD: `PARTIAL` — schema/contracts and local paths exist; no live owner CRUD runtime is proven.
- Portal: `PARTIAL` — navigation and local owner flows are present; authenticated hosted acceptance and live API wiring are unproven.
- Command Center: `PARTIAL` — aggregate-oriented surface exists; no current deployment or live health data proof.

The W3 durable intent journal in PR #96 is a SQL candidate only. A separate local API integration commit (`a2b69dbb60c01c407e94c618c459d7fc97c0f1a6`) now exercises the intended two-transaction shape in focused tests, but it is not pushed or reviewed and does not change the current main/runtime conclusion. The Portal still needs tenant-bound lookup/list/reconciliation after tab close or token rotation.

## 13. Worker / Scheduling Status

Worker roster, planning policy, allocator, shift, crew, resource and scheduling contracts exist in `main` and local review branches. The owner planning route and disposable PostgreSQL proof are in PRs #93 and #95, both draft/unmerged. The live database lacks the later migrations required by those paths. Status: `PARTIAL`, with hosted operational scheduling `BLOCKED`.

## 14. Payments / Billing

The repository contains a provider-neutral payment contract, mock payment adapter, Stripe adapter/Edge Function implementation, server-side amount recomputation, idempotency, and compensation logic. These are not live-connected. RC-3 remains conditional and explicitly requires pre-connection fixes, test credentials, project-host egress, and live threat-matrix execution.

Platform billing has contracts/plans/entitlement types, but no connected Stripe, Paddle, Mercado Pago, Mollie, or PayPal platform-billing provider. Merchant payment provider support is mock-ready and Stripe-adapter-ready only; no merchant provider is live-connected.

Invoices are not represented as a live operational invoice subsystem in the current Supabase schema or hosted portal. Status: `MISSING` for the requested production invoice area.

## 15. Calendar / Notifications

Calendar OAuth/connection contracts and mock calendar behavior exist in the repository; Google and Microsoft live OAuth connections are absent. Email/SMS notification contracts, outbox structures, and mock notification behavior exist; live Resend, Twilio, SMTP, or WhatsApp connections are absent. Status for both provider families: `MOCK READY` / `ADAPTER READY`, `NOT CONNECTED`.

## 16. Golden Flow Results

These are the strongest verified states; none is a full hosted-runtime PASS.

| Flow | Result | Evidence boundary |
|---|---|---|
| Cleaning: onboarding → profile → service → pricing → embed → availability → booking → confirm | PARTIAL | Local contracts, portal/flow candidates, and database foundations exist; no complete authenticated hosted run |
| Detailing: vehicle → package → add-ons → schedule → booking | PARTIAL | Template and local flow coverage exist; no hosted live API/provider run |
| Vehicle rental: resource → date range → hold → concurrent customer → one confirmed | PARTIAL | Local/resource/concurrency evidence exists; live resource/capacity migrations and confirm route are absent |

## 17. P0 Blockers

| Blocker | Status / owner / evidence | Merged? | Runtime verified? |
|---|---|---:|---:|
| Live schema drift (`0001–0009` vs repository `0001–0031`) | Release/Integration; Supabase migration listing | No migration action authorized | No |
| Hostable API deployment and authenticated `/health`/`/ready` | Integration/Runtime; `apps/api` and Render blueprint only | API foundation merged | No |
| Single confirm authority in intended runtime | R2b PR #78 | No | No |
| Capacity/resource hold authority in live DB | SQL `0010`/`0012` not live | Partly in main | No |
| Service-slot overbooking backstop | PR #79 / `0033` | No | No |
| Real Auth/PostgREST HTTPS proof | RC-2 RUNTIME-04 | N/A | Blocked by egress |
| Payment/provider authority connected | RC-3 conditional; no live Edge Functions/keys | No | No |

## 18. P1 Gaps

- One-tenant-one-profile activation and profile-gated portal/embed (`#77`, `0032`).
- Durable template-adoption API and Portal reconciliation (`#96` plus later API/UI work).
- Full configurable workflow/question editor and hosted embed installation.
- Worker/crew/resource scheduling and authenticated mobile worker experience.
- Invoice model, invoice rendering, download/resend, tax/discount/terms handling.
- Calendar provider OAuth and event synchronization.
- Email/SMS provider adapters, notification consumers, delivery observability.
- Service-area/postal-code gating and international terminology/currency runtime proof.
- Media/storage variants and HD image management.
- Maps provider abstraction and navigation links.
- Command Center live health, incidents, tenant health, usage, GMV and platform billing feeds.
- Realtime/events consumers and webhook/job runtime.
- Current Netlify-to-GitHub source sync and Render/Supabase endpoint configuration.
- Authenticated pilot identities and hosted golden-flow acceptance.

## 19. Superseded Work

### SAFE TO CLOSE after stack-owner confirmation

- Old implementation branches whose contents are fully represented by merged PR #75/#76 and have no unique child PR dependency.
- Duplicate pre-consolidation C1–C5, old API-foundation, and old runtime-preview branches once their PR graph is confirmed.

### NEEDS REVIEW before closing

- The open stacked PRs #78, #77, #79 and the active W3/W4 draft stack #80–#96.
- Branches carrying unique evidence, test fixtures, or a child PR base, including `codex/main-template-adoption-portal`, `codex/main-service-adoption-intent`, `codex/main-owner-planning-pg-proof`, and their parents.
- Any Claude/Codex branch referenced by an open PR or release ledger entry.

### KEEP

- Protected `main` and accepted RC-2 evidence.
- Merged recovery lineage #75/#76.
- Current draft branches required to preserve the review stack until the Release Governor explicitly closes or supersedes them.
- `_deferred/` as historical migration documentation; it is not an applied migration surface.

No branch, worktree, PR, or data was deleted during this reconstruction.

## 20. Provider / Secret Status

| Provider family | Stripe | Paddle | Mercado Pago | Mollie | PayPal | Google Calendar | Microsoft Calendar | Resend | Twilio | SMTP | Maps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Platform billing | NOT BUILT | NOT BUILT | NOT BUILT | NOT BUILT | NOT BUILT | — | — | — | — | — | — |
| Merchant payments | MOCK READY / ADAPTER READY | NOT BUILT | NOT BUILT | NOT BUILT | NOT BUILT | — | — | — | — | — | — |
| Calendar | — | — | — | — | — | ADAPTER READY, NOT CONNECTED | ADAPTER READY, NOT CONNECTED | — | — | — | — |
| Notifications | — | — | — | — | — | — | — | MOCK READY, NOT CONNECTED | MOCK READY, NOT CONNECTED | ADAPTER READY, NOT CONNECTED | — |
| Maps | — | — | — | — | — | — | — | — | — | — | NOT BUILT |

No raw secret values were inspected or exposed. The presence of two mock payment-secret rows in the clean project is recorded above; this is not evidence of live provider credentials.

## 21. Recommended Next 10 Actions

1. Freeze implementation and have the Integration Governor reconcile the exact GitHub merge graph for #75/#76/#77/#78/#79 and the later draft stack.
2. Obtain read-only Render workspace access and record whether `lumin-api` exists; do not create or deploy a service during this step.
3. Obtain Netlify site/account read access and identify which site, branch, build commit, environment variables, and API endpoint correspond to “gregarious-longma” and “sage-kangaroo”; do not guess or relink.
4. Decide, with explicit release authorization, whether the clean Supabase project may receive migrations `0010–0031`; run a migration plan/diff first and apply nothing during reconstruction.
5. Keep PR #77 and #79 unmerged until their exact CI, live migration plan, and Runtime Guardian gates are independently rechecked against current `main`.
6. Complete the W3 durable-intent API two-transaction integration and owner-bound lookup/list/reconciliation, then run the required concurrency and uncertain-commit tests.
7. Deploy no provider until R2b, capacity/resource authority, and hosted Auth/HTTPS acceptance are proven in an approved staging environment.
8. Reconcile the frontend environment configuration to the intended API origin and Supabase project without adding credentials to source or browser bundles.
9. Execute the complete cleaning, detailing, and rental golden flows against the same approved staging topology, capturing exact source/deploy/migration SHAs.
10. Only after all gates pass, submit a release decision for a controlled staging activation. Keep real Stripe, calendar, email, SMS, CRM, and map credentials as the final separately authorized step.

## 22. Final Recovery Position

### WHERE WE ARE

These are planning estimates, not release gates:

- Backend recovery: **55%** — substantial repository foundations and a green protected main, but live schema/API deployment is not reconciled.
- Runtime readiness: **20%** — active clean Supabase database boundary, no verified hosted API/frontend connection.
- Portal readiness: **35%** — substantial local surface and contracts, no hosted authenticated operating proof.
- Embed readiness: **35%** — local workflow/runtime pieces and stale demo preview, no synchronized live embed.
- Production readiness: **10%** — no current end-to-end production topology, hosted golden flow, or provider activation proof.

### DEFINITELY FINISHED

- PR #75 and PR #76 are merged into protected `main`.
- Current `main` CI is green at `c5663c59e134e71beb511f509b3287ab0046bdff`.
- The clean Supabase project exists and is `ACTIVE_HEALTHY`.
- The live `0001–0009` database boundary has recorded management-channel RLS/tenant-isolation evidence.
- The repository contains the hostable API foundation, three app surfaces, provider-neutral contracts, and reviewed local/CI evidence for many core primitives.

### PARTIALLY FINISHED

- R2b confirmation authority, profile activation, service-slot backstop, W3 connected adoption, the local W3 API intent integration, W4 planning/roster work, and provider adapters are implemented only in repository branches or unconnected code paths.
- Checkout, Portal, Command Center, workflow, scheduling, media, events, notifications, and i18n have local/reviewed pieces but no synchronized hosted operating proof.
- Supabase contains clean test fixtures, not an accepted production tenant population.

### NOT YET DONE

- Complete intended recovery merge sequence.
- Apply and verify later migrations in an approved environment.
- Deploy and authenticate the Render API.
- Synchronize Netlify sites to the intended GitHub source and API.
- Run authenticated hosted golden flows.
- Connect real payment, calendar, email, SMS, CRM, or map providers.
- Provide production invoice, service-area, worker-mobile, realtime, observability, and command-center runtime completion.

### CURRENT BLOCKER

The single most important blocker is the unverified and drifted runtime topology: Supabase is live only through `0009`, while repository `main` and its open recovery stack depend on later migrations and a hostable API that has no verified Render deployment or Netlify connection.

### NEXT ACTION

Complete the read-only environment reconciliation: obtain Render workspace access and Netlify site/source access, identify the actual deployed frontend/API pair, and produce a migration diff against the active Supabase project before authorizing any implementation, migration, merge, or deployment work.
