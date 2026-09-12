# BLOCKERS — Top 20 P0/P1 Operational Blockers

Ranked for the First Recovery Cycle. Basis `88f7d6f` + live Postgres 16 probes.
**Priority defs.** P0 = data leakage / tenant collision / payment authority / duplicate booking / overbooking / auth bypass / runtime crash. P1 = core flow broken / onboarding broken / embed broken / worker schedule wrong / invoice wrong / unavailable-shown-available.

| # | id | Pri | Title | Breaks | Reproduction (file:line / SQL / step) | Fix direction |
|---|----|-----|-------|--------|---------------------------------------|---------------|
| 1 | OB-STRUCT | P0 | Overbooking not structurally prevented — no exclusion constraint | Reservation holds; Flow C; all confirmed bookings | Insert two `state='confirmed'` bookings, same capacity-1 slot, **no** `reserve_capacity` call → accepted (`DIRECT-CONFIRMED oversell count = 2`). `resource_reservations` (`0012:99`) has only `unique(booking_id,resource_id)`; `bookings` (`0005`) has no overlap/EXCLUDE constraint. | Add `btree_gist` `EXCLUDE` on `resource_reservations(resource_id WITH =, tstzrange(slot_start,slot_end) WITH &&) WHERE status in ('held','consumed')`; add a confirm-time capacity-assertion trigger on `bookings`. Defense-in-depth independent of the RPC. |
| 2 | OB-LIVE | P0 | Capacity/reservation guard entirely absent on live runtime | Reservation holds; bookings; Flows A/B/C | Live Supabase = migrations 0001–0009. `capacity_holds`/`reserve_capacity` = `0010`; `resource_reservations`/`reserve_resource` = `0012` → **not present live**. Any live confirm oversells with zero checks. | Advance live to ≥0012 (ideally ≥0030) via the CI migration order; gate confirms on the guard. |
| 3 | NO-CONFIRM-RUNTIME | P0 | No deployable runtime reserves capacity or confirms a booking | Bookings; payment authority; Flows A/B/C | `reserve_capacity`/`consume_hold` are called **only** by Deno edge fns (`create-payment-intent/index.ts:207`, `stripe-webhook/index.ts:164`), which are undeployed and not Node-hostable. `action-api` submits `state:'draft', confirmed:false` (`contracts.ts:48`) and never confirms. | Port the reserve→pay→confirm→consume logic into a hostable API (`apps/api` / action-api production route), or deploy the edge functions; single confirm authority. |
| 4 | AUTH-ENTRYPOINT | P0 | Only runnable API entrypoint has no real authentication | Portal login; tenant isolation; every authed route | `server/local.ts` composes `createFlowHttpServer` with `localIdentity` (no auth) bound to 127.0.0.1, labeled "LOCAL_HARNESS … no real authentication or providers". `supabase-auth.ts:64 createSupabaseIdentityVerifier` exists but is **not wired** into any hostable entrypoint. | Add a production entrypoint composing the http server with `createSupabaseIdentityVerifier` + env-driven origins; never expose `local.ts` as the service. |
| 5 | PAY-AUTHORITY | P0 | No live/hostable payment authority (mock-only) | Payment adapter; customer confirmation; Flows A/B/C | `adapters/mockPayment.ts` (`providerName:"mock"`) is the only wired provider; `stripePayment.ts` is test-mode + prohibited/unwired; edge `_shared/stripe.ts` is undeployed. No confirmed payment reachable. | Wire one server-side MerchantPaymentProvider behind the confirm route under the reviewed key policy; keep client secret-free. |
| 6 | CONFIRM-BROKEN | P0 | Customer confirmation unreachable on any live path | Customer confirmation; bookings | Confirmation state transition + `consume_hold` live only in `stripe-webhook/index.ts` (undeployed). `ConnectedCheckout.tsx` returns "Request saved — unconfirmed" and states it "does not charge a payment or reserve availability". | Deliver the confirm path with #3/#5; confirmation must consume the hold atomically or refund-on-oversell. |
| 7 | RESERVE-UNWIRED | P0 | Proven reservation engine has no production caller (procedural-only safety) | Reservation holds; resource scheduling; Flow C | RPCs proven under concurrency (capacity 1 GRANTED/1 NO_CAPACITY; allocator contested resource admits 1) but grep shows **zero** TS callers in `apps/`/hostable server (only edge fns + comments). | Bind reserve/consume/release into the confirm route; assert `GRANTED` before any state advance. |
| 8 | INVOICE-MISSING | P1 | No invoice model at all | Invoices; portal financials | No `invoices` table/RPC in any migration; `0011_refund_accounting` covers payment refunds only. | Add internal invoice ledger (table + RPC) linked to booking/payment; normalize per PRODUCT_MAP Invoices. |
| 9 | NOTIFY-NOCONSUMER | P1 | Notifications never send (mock adapter + unconsumed outbox) | Email; SMS; customer/worker notify | `adapters/mockNotification.ts` returns a fabricated `messageId`; `durable_outbox` (`0015`) comment: "No live consumer", empty payload. | Add a durable-outbox consumer + real email/SMS transport behind the notification port; enqueue in the domain txn. |
| 10 | ONBOARD-MISSING | P1 | No business onboarding flow | Onboarding; activation | Only owner flow-authoring journey (`mode-owner-journey.integration.ts`); no create-tenant→locale→seed path; no onboarding table. | Build onboarding that creates the tenant, sets locale/tz/currency, and (with #11) activates a profile + seeds services/flow. |
| 11 | PROFILE-MISSING | P1 | No one-tenant-one-profile concept | Business-profile activation; navigation; all 8 axes | `tenants` (`0002:11`) has no vertical/profile column; no `business_profiles` table; `templateRegistry` is global to all tenants. | Add `BusinessProfile` contract + `tenants.profile_key` + activation transition; drive nav/terminology/seed from it (see PRODUCT_PROFILE_MAP.md). |
| 12 | EMBED-RUNTIME-INERT | P1 | Embed runtime cannot reserve or pay | Embed runtime; Flows A/B/C | `ConnectedCheckout.tsx` submits an unconfirmed request only; `HostedFlow.tsx` renders but no reserve/pay wiring. | Point the runtime at the confirm route (#3); render→reserve→pay→confirm. |
| 13 | SVC-AREA-UNGATED | P1 | ZIP/postal service area does not gate availability | Service area; unavailable-shown-available | `service_areas` (`0012`) + `i18n/address.ts` exist but no code gates a quote/slot by postal area; templates model zones only as priced add-ons. | Wire service-area membership into availability/quote so out-of-area is refused, not silently priced. |
| 14 | RENTAL-DATES-FIRST | P1 | Rental catalog shown without dates (may show unavailable as available) | Flow C; availability correctness | No enforcement of PRODUCT_MAP "collect dates before promising models"; rental (`service.ts` rental config) has no date-gate in the runtime. | Enforce dates-before-catalog; mark availability unknown until dates set, re-evaluate after. |
| 15 | ASSIGN-UNWIRED | P1 | Worker assignment not wired to bookings | Worker assignment; scheduling | Allocator (`0028`) + roster (`0021–0023`) DB-proven but no app action binds an assignment to a booking; transport is an integration harness, not a mounted route. | Mount a booking-assignment action calling the allocator; project assignment to the worker surface. |
| 16 | RESOURCE-SCHED-UNWIRED | P1 | Resource scheduling unreachable from any app | Resource scheduling; Flow C | `reserve_resource`/`reserve_resource_quantity` proven (5/5) but no app/hostable caller. | Include resource reservation in the confirm route for resource-backed services. |
| 17 | SVC-CRUD-UNWIRED | P1 | Portal service configuration is read-only | Service config; onboarding | action-api exposes `flow_owner_services` read (`http.ts:67`); no wired create/update/delete of services. | Add governed service write RPCs + portal UI; one source of catalog truth. |
| 18 | CAL-MOCK | P1 | Calendar integration is mock with no sync | Calendar; external mirror | `adapters/mockCalendar.ts`; `integrations/calendar.ts` port only; no consumer mirrors internal state out/in. | Implement a CalendarProvider behind the port + a sync consumer; mirror confirmed bookings. |
| 19 | CC-TELEMETRY-MOCK | P1 | Command-center health/telemetry is mock | Command-center visibility | `0008` aggregate views are real, but health/incidents/events are mock; outbox unconsumed → no authentic events. | Back health/incidents with durable events (outbox consumer) before presenting platform status. |
| 20 | MEDIA-NOBACKEND | P1 | Media/storage is a pure port, no backend | Media/storage | `media/storage.ts` comment: real adapters (S3/Supabase Storage/R2) are "future"; nothing wired. | Implement one storage adapter (signed private access + bounded transforms) behind the existing port. |

---

## MOCK_VS_LIVE

For each external dependency: **adapter-only** (pure mock/port, no persistence) · **DB-wired** (touches a migration but no external provider) · **live** (real external provider deployed).

| Dependency | Status | Evidence |
|-----------|--------|----------|
| Payment | **adapter-only** | `adapters/mockPayment.ts` (`providerName:"mock"`) is the wired provider; `stripePayment.ts` is prohibited/unwired; edge `_shared/stripe.ts` undeployed. Nothing live. |
| Calendar | **adapter-only** | `adapters/mockCalendar.ts` + `integrations/calendar.ts` port; no sync consumer, no live provider. |
| Email | **adapter-only** | `adapters/mockNotification.ts` returns a fake `messageId`; `durable_outbox` (`0015`) DB table exists but has **no consumer** ("No live consumer"). |
| SMS | **adapter-only** | Same mock notification adapter; no transport. |
| Maps / distance | **absent** | No MapProvider; distance pricing deferred (PRODUCT_MAP). Service-area data exists (`service_areas` `0012`) but ungated. |
| Storage | **adapter-only (port)** | `media/storage.ts` provider-neutral port; real S3/Supabase Storage/R2 adapters are "future"; no backend wired. |

Reservation/capacity is **DB-wired and proven** (not external), but its only caller is undeployed and it is absent from the live schema — see blockers #2/#3/#7.

---

## RENDER_READINESS

**Is there an `apps/api`-shaped service?** **No.** `apps/` contains only `checkout`, `portal`, `command-center`. The API lives at `packages/action-api/server/*` as library-style modules.

**Is `packages/action-api/server` hostable as-is?** **Not for production.** The only runnable entrypoint, `server/local.ts` (`npm run local:serve -w @lumin/action-api` → `tsx server/local.ts`):
- binds `127.0.0.1` only, port from `FLOW_API_PORT` (defaults 8787), advertises itself as `LOCAL_HARNESS`;
- authenticates with `localIdentity` (**no real auth**) and fixture `ownerOrigins`/`customerOrigins`;
- runs via `tsx` (no build/bundle; `main` is `src/index.ts`, there is no `dist`);
- exposes flow authoring / installations / sessions / roster / **unconfirmed requests** — **no reserve, no pay, no confirm** routes.
- The other server files (`mode-owner-local.ts`, `pg-http.integration.ts`, etc.) are explicitly test harnesses ("actual-harness seam … for tests", "no import-time startup").

**What's needed to stand up one API on Render:**
1. **A production entrypoint** (e.g. `apps/api`) that composes `createFlowHttpServer` (and the mode-owner/roster/planning routes) with `createSupabaseIdentityVerifier` (`supabase-auth.ts`), real `ownerOrigins`/`customerOrigins` from env, `0.0.0.0` + `PORT`, and a pooled `pg` client to Supabase. (`GET /health` already exists — usable as the Render healthcheck.)
2. **Fold in the confirm path** currently trapped in Deno edge functions (reserve_capacity → pay → confirm → consume_hold), or deploy those edge functions separately and have the API delegate — but a single confirm authority is required.
3. **Real payment provider** wiring behind the confirm route (blocker #5) under the reviewed key policy.
4. **A build step / bundling** (today it is `tsx`-run TypeScript; add a build target and pin the runtime).
5. **Advance the live DB schema** to ≥0012 (ideally ≥0030) so the guard, resources, flows, modes, roster, and planning the API depends on actually exist.
6. **Structural overbooking constraint** (#1) before any real confirm route goes live.

**Summary:** the API is a coherent library with a proven DB layer and an auth verifier, but there is no production composition, no confirm/pay surface on it, mock-only providers, and a live schema years behind the code. Standing up one Render API is a build-and-wire task (compose + auth + confirm route + provider + migrate live), not a from-scratch effort.
