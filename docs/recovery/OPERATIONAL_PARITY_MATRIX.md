# OPERATIONAL PARITY MATRIX — First Recovery Cycle

**Audit basis.** Workspace `/home/claude/aud`, detached HEAD `88f7d6f` (codex tip — the fullest operational implementation). READ-ONLY code analysis plus live Postgres 16 probes. All 30 migrations `supabase/migrations/0001..0030` apply **clean** on plain Postgres 16 after `supabase/tests/local_harness.sql` (the Supabase `auth` stub). Live Supabase is at **0001–0009 only**; no edge functions deployed; no API service deployed.

**Legend.** IMPLEMENTED = wired and provably operates; PARTIAL = exists but a link is missing/unwired; MOCK = adapter/port only, no live backend; BROKEN = present but cannot complete; MISSING = no artifact.
**Wiring tiers.** `engine` = pure TS, no persistence · `DB/RPC` = wired to a migration table/function · `live` = reachable by a deployable runtime.

**The load-bearing structural fact (read first).** There are **two disjoint runtimes** and neither is a complete, hostable, live operating system:
- **Deno edge functions** (`supabase/functions/create-payment-intent`, `stripe-webhook`) are the **only** code that reserves capacity, takes payment, and *confirms* a booking. They are **not deployed live** and are **not Node/Render-hostable** as-is.
- **`packages/action-api/server`** (Node http) is the Render-shaped API. It authors flows / installations / sessions / roster / planning and accepts **unconfirmed draft requests only** (`contracts.ts:48` `submit_flow_request: {state:'draft', confirmed:false}`). It **never reserves capacity and never confirms a booking**.

---

## (a) The 20 Lane-C modules

| # | Module | State | Evidence (file / table / RPC) | Operates end-to-end? y/n/how |
|---|--------|-------|-------------------------------|------------------------------|
| 1 | Tenant request context | IMPLEMENTED | RLS `0007_rls.sql`; `auth.uid()` + `public.tenant_members`; `lumin.guard_booking_client_write()` (`0005:219`) freezes client writes; `mode_flow_installations` FK-binds `(tenant_id,flow_id)` (`0029:36`). Live (≤0009). | **y (DB/RLS, live).** Tenant derived from verified membership / server-resolved flow, never a client tenant field. `rls_attack_tests.sql` covers it. |
| 2 | Onboarding | PARTIAL | Owner *flow-authoring* journey exists: `mode-owner-http.ts` + `mode-owner-journey.integration.ts` (publish→install→apply). No business-setup onboarding (create tenant → locale → activate) wired in any app; no onboarding table. | **n.** Only the embed-authoring owner journey operates (DB via action-api). Business/vertical onboarding does not exist. |
| 3 | Business-profile activation | MISSING | `tenants` (`0002:11`) has no vertical/profile/archetype column; `status` is only `active/inactive/suspended` lifecycle. No `business_profiles` table anywhere. | **n.** No concept exists. See PRODUCT_PROFILE_MAP.md. |
| 4 | Services | IMPLEMENTED | `services` table `0003` (archetype simple/cart/configurable/rental); contracts `service.ts`; 8 seed factories `packages/templates`. Read via `flow_owner_services` RPC (action-api `/api/services`). | **y (DB) for schema+read.** Full portal service CRUD is not wired (read-only projection through action-api). |
| 5 | Workflow / questionnaire engine | IMPLEMENTED | Pure engine `packages/workflow/engine.ts` (`validate`, `visibleWhen`, `requiredWhen`); configurable-flow persistence `0016–0019`; `flow-ui/ConfigurableQuestionForm.tsx`; action-api `/api/configurable-flows/:id/draft|publish`. | **y (engine + DB authoring).** Evaluation is pure; authoring/publish is DB-wired via action-api. |
| 6 | Pricing | IMPLEMENTED (engine) / PARTIAL (server) | `packages/core/pricing.ts:27 createPricingEngine`; server re-price only in edge fn `supabase/functions/_shared/pricing.ts`. | **y as engine; n server-authoritative on a live runtime.** Authoritative re-pricing lives only in the un-deployed edge function. |
| 7 | Availability | IMPLEMENTED (engine) / PARTIAL (server) | `packages/core/availability.ts:18`; `availability_rules` `0004`; edge `_shared/availability.ts` produces `p_capacity`. | **y as engine; server verify only in edge fn (not live).** |
| 8 | Resource availability | PARTIAL | Pure reader `packages/resources`; DB `lumin.reserve_resource` `0012`, `reserve_resource_quantity` `0020`. Concurrency-proven (see below). | **DB path operates & is proven; not wired to any app/hostable route.** |
| 9 | Reservation holds | IMPLEMENTED (DB) / UNWIRED | `capacity_holds` + `lumin.reserve_capacity` `0010`; `resource_reservations` + `lumin.reserve_resource` `0012`. **Only caller = Deno edge fn** (`create-payment-intent/index.ts:207`). | **Proven under true concurrency (1 GRANTED/1 NO_CAPACITY), but reachable ONLY via the un-deployed edge fn; not on action-api; not live (0010 > live 0009).** |
| 10 | Bookings | PARTIAL | `bookings` `0005`; `lumin.create_booking_draft` `0007`; state-machine triggers `0005`. action-api submits `state:'draft'`. Confirm only via `stripe-webhook`. | **Draft y (DB, live). Confirmed only via un-deployed edge fn.** No confirmed booking on any hostable/live runtime. |
| 11 | Workers | IMPLEMENTED (DB) | Roster `0021–0023`; `owner_roster_snapshot`, `roster_provision`, `roster_crew_member_set`, `roster_eligibility_put` via `roster-http.ts`. Needs `auth` schema (`0021:5`). | **y via action-api `/api/roster` (DB), under LOCAL_HARNESS auth.** Not live. |
| 12 | Scheduling | PARTIAL | Planning policy/allocator `0022`,`0025`,`0028`; `planning-allocation-repository.ts` (DB-wired) + integration harness. Contested service/resource/worker each admit exactly 1 (proven). | **DB allocator operates & is proven; transport is an integration harness, not a mounted production route; not tied to a confirmed-booking path.** |
| 13 | Invoices | MISSING | No `invoices` table in any migration; `0011_refund_accounting` covers *payments* refunds, not invoices. No invoice RPC. | **n.** No artifact. |
| 14 | Payment adapter boundary | MOCK | `packages/payments` contract + `adapters/mockPayment.ts` (`providerName:"mock"`); `adapters/stripePayment.ts` = test-mode, prohibited/unwired; edge fn uses `_shared/stripe.ts`. | **Mock only.** No hostable/live payment authority. |
| 15 | Calendar adapter boundary | MOCK | `packages/integrations/calendar.ts`, `oauth.ts`, `connection.ts`; `adapters/mockCalendar.ts`. No sync consumer, no external mirror. | **Mock only; no DB-wired sync.** |
| 16 | Notifications | MOCK | `adapters/mockNotification.ts` returns a fabricated `messageId`; `durable_outbox` `0015` = table only, comment: *"No live consumer"*, empty payload. | **Mock only.** Nothing sends; outbox has no consumer/delivery. |
| 17 | Media / storage | MOCK (pure port) | `packages/media/storage.ts` provider-neutral port; comment: *"Real adapters (CDN, S3, Supabase Storage, R2) are future implementations."* Tenant-key isolation is pure. No backend wired. | **Port only; no live storage.** |
| 18 | Embed configuration | IMPLEMENTED | Flow storage `0016–0019`; `mode_installations` `0029`, `mode_flow_sessions` `0030`; `installation.ts` contract; action-api `/api/flows/:id/draft|publish` + `InstallationPanel.tsx`. | **y (DB via action-api).** Publish→install→apply→policy lifecycle operates against Postgres. |
| 19 | Embed runtime | PARTIAL | `installation.ts` loader contract + `parseInstallationRoute`; `apps/checkout HostedFlow.tsx`; `ConnectedCheckout.tsx` submits **unconfirmed request** ("does not charge a payment or reserve availability"). | **Renders + submits an unconfirmed request (DB). Does NOT reserve or pay ⇒ no completed booking.** |
| 20 | Command-center telemetry | PARTIAL / MOCK | 4 aggregate views `0008` (`platform_business_stats`, `platform_booking_stats`, `platform_economics`, `platform_integration_health`); `ConnectedCommandCenter.tsx` reads them. Health/incidents/events are mock (outbox unconsumed). | **Aggregates y (DB views); health/telemetry mock.** |

---

## (b) §17 Capability parity

WORKING = provably operates on a real (DB/live) path · PARTIAL = engine or DB exists but a link is missing · MOCK = adapter only · BROKEN = present but cannot complete · MISSING = absent.

| Capability | State | Evidence / where it stops |
|-----------|-------|---------------------------|
| Onboarding | PARTIAL | Owner flow-authoring journey (`mode-owner-journey.integration.ts`) only; no business/vertical onboarding, no onboarding table. |
| Portal login | PARTIAL | Verifier exists: `supabase-auth.ts:64 createSupabaseIdentityVerifier`; `ConnectedPortal.tsx` authenticates. But the only runnable server entrypoint `server/local.ts` uses `localIdentity` (no real auth). |
| Business-profile activation | MISSING | No tenant-level profile/vertical/activation (see module 3). |
| Service config | PARTIAL | `services` schema + templates + `flow_owner_services` read; no wired portal write/CRUD. |
| Pricing | PARTIAL | Pure engine WORKING (`core/pricing.ts`); server-authoritative quote only in un-deployed edge fn. |
| ZIP / postal service area | PARTIAL | `service_areas` table `0012` (+ `_deferred/0001`); `i18n/address.ts` postal localization; **not** wired to gate availability/quote. Templates model zones only as priced add-ons. |
| Embed builder | WORKING | Flow draft/version/publish/install (`0016–0019`,`0029`) via action-api + `InstallationPanel.tsx`. DB-wired. |
| Embed runtime | PARTIAL | Renders + submits unconfirmed request; no reserve/pay (`ConnectedCheckout.tsx`). |
| Availability | PARTIAL | Engine WORKING; server verify only in edge fn (not live). |
| Worker scheduling | PARTIAL | Roster DB-wired (`/api/roster`); allocator DB-proven; not mounted end-to-end nor bound to a confirmed booking. |
| Resource scheduling | PARTIAL | `reserve_resource`/`reserve_resource_quantity` DB-proven under concurrency; unwired to any app path. |
| Booking creation | PARTIAL | Draft WORKING (`create_booking_draft`, live ≤0007); confirmed only via un-deployed edge fn. |
| Reservation hold | PARTIAL | DB WORKING + concurrency-proven, but only caller is the un-deployed edge fn; 0010 not live. |
| Invoice | MISSING | No invoices table/RPC. |
| Calendar | MOCK | `adapters/mockCalendar.ts`; no sync consumer. |
| Email | MOCK | `adapters/mockNotification.ts`; outbox has no consumer. |
| SMS | MOCK | Same adapter; no transport. |
| Payment adapter | MOCK | `mockPayment.ts` (`providerName:"mock"`); real adapter prohibited/unwired. |
| Customer confirmation | BROKEN | Confirmation state transition + `consume_hold` exist **only** in `stripe-webhook/index.ts:164` (un-deployed); the connected checkout returns "Request saved — unconfirmed". No confirmation reachable live. |
| Worker assignment | PARTIAL | Allocator/roster DB operate & are proven; not wired to a booking-assignment action in any app. |
| Command-center visibility | PARTIAL | Aggregate views WORKING (`0008`); health/incidents/telemetry mock. |

---

## Notes on implementation nature (engine vs DB/RPC vs live runtime)

- **Pure engines only (no persistence):** pricing (`core/pricing.ts`), availability (`core/availability.ts`), workflow evaluation (`workflow/engine.ts`), resource planning read (`packages/resources`), media key isolation (`media/storage.ts`).
- **DB/RPC-wired and concurrency-proven, but caller-unwired or edge-only:** capacity holds (`reserve_capacity` 0010), resource reservations (`reserve_resource`/`_quantity` 0012/0020), planning allocator (0028), worker roster (0021–0023, wired via action-api).
- **DB-wired via the action-api server (Render-shaped):** flow authoring, installations/modes, sessions, roster, unconfirmed requests.
- **Edge-function-only (un-deployed, not Node-hostable):** the entire reserve→pay→confirm→consume-hold path.
- **Mock adapters / ports only:** payment, calendar, email, SMS, media storage, command-center health.
- **Live (0001–0009) has:** tenants/identity, services, availability rules, customers/bookings/payments tables, integrations/settings, RLS, command-center views, RC2 hardening — and **none** of holds, resources, outbox, flows, modes, roster, or planning.
