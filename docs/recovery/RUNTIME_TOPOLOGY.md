# Runtime Topology (Lane A) — what is actually running

Snapshot 2026-09-12. States: LIVE · STAGING · MOCK · NOT_CONNECTED · BROKEN · DEFERRED ·
DUPLICATE. **Code existing ≠ runtime existing.**

## Supabase — project `pplwyfbxrnodimhzlvdl` ("Booking Lumin Checkout — Clean Runtime Baseline")
| Component | State | Evidence |
|---|---|---|
| Postgres + schema | **LIVE — but STALE** | Migrations applied: **only `0001-0009`** (RC-2 baseline). `0010`(capacity holds), `0011`(refunds), `0012`(resources), `0013`(RISK-4), `0014-0030`(codex flows/worker/planning/modes/outbox) **NOT applied**. |
| RLS / tenant isolation | **LIVE** | RLS enabled on all 27 tables; forced per `0007`; RC-2 attack suite certified at `0009`. |
| Seed data | **LIVE (test)** | 2 tenants, 4 members, 1 platform admin, 2 services, 3 customers, 4 bookings, 2 payments, 2 payment connections (+secrets), 2 checkout_settings. |
| Auth (GoTrue) | **PARTIAL** | Real `auth.users` exist; HTTPS login/JWT round-trip never verified from here (RUNTIME-04 open — egress). |
| Capacity holds / reservation lifecycle | **NOT_CONNECTED** | `capacity_holds`/`reserve_capacity` (`0010`) + advisory-lock serialization (`0014`) not in live DB. **Overbooking prevention is not live.** |
| Resources / worker / planning / flows / modes / outbox | **NOT_CONNECTED** | `0012`,`0016-0030` tables absent from live DB. |
| Edge Functions | **NOT_CONNECTED** | `list_edge_functions` = []. RC-3 `create-payment-intent` + `stripe-webhook` authored in repo, **not deployed**. |
| Storage / Realtime | **NOT_CONNECTED** | media/storage + realtime not provisioned/used live. |

## Netlify — `gregarious-longma-6158a8`
| Component | State | Evidence |
|---|---|---|
| Deploy previews (per PR) | **STAGING** | Preview per PR (`deploy-preview-<n>`); single static site bundling `/checkout` `/portal` `/command-center` (codex `preview/` + `build-preview.mjs`). |
| Production deploy of `main` | **NOT_CONNECTED** | No evidence of a production branch deploy; previews are demo-only, no live providers. |

## Render — API / background / AI action / integration workers (§10-11 target)
| Component | State | Evidence |
|---|---|---|
| API service (`apps/api` or equivalent) | **MISSING** | No Render service; no `apps/api`. The `action-api/server` BFF (codex) is the seed but lives under `packages/` and must be relocated (consolidation C6) + given verified-JWT auth before hosting. |
| Background / worker / integration runtime | **MISSING** | Not built. |

## Providers (adapters)
| Provider | State |
|---|---|
| Payment (Stripe TEST) | **READY_NOT_CONNECTED** — adapter + edge functions authored; no keys set, functions not deployed. |
| Calendar / Email / SMS / Maps / Webhooks | **READY_NOT_CONNECTED** (mock adapters only). |

## Applications (browser)
| App | State |
|---|---|
| checkout / portal / command-center | **MOCK (buildable)** — SPAs run on mock providers; `@lumin/runtime-client` (C2) can talk to Supabase but connected surfaces need the live DB at the consolidated schema (`0010-0030`), which is not applied. |

## Immediate runtime blockers (feed BLOCKERS.md / Top P0-P1)
1. Live DB is 21 migrations behind the code — no capacity/reservation/resource/worker/flow/mode runtime → **overbooking + core flows cannot operate live** (P0/P1).
2. No API service (Render) → no server home for reservation-holds, worker assignment, invoices, integration workers (P1).
3. Edge functions undeployed + no Stripe keys → payment path not operable end-to-end even in TEST (P1, gated on owner keys — task #27/#35).
4. Consolidation not merged → `main` lacks the operational backend; one coherent tree is prerequisite to any runtime cutover (Lane B).
