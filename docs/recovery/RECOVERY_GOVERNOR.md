# Recovery Governor — authoritative operational truth

**Mission (this program):** turn the existing Booking Lumin Checkout codebase into ONE
coherent, operational, deeply-tested system. Not expansion — **operational parity,
reliability, deep backend completion.** The accepted frontend baseline is protected.

**Governing question every cycle:** *"What prevents Booking Lumin from operating correctly
end-to-end right now?"* — reproduce, fix, verify, integrate, retest.

This document is the single authoritative truth. No agent may invent a competing
architecture. Companion living docs (this folder): `RUNTIME_TOPOLOGY.md`,
`CONSOLIDATION_MATRIX.md`, `OPERATIONAL_PARITY_MATRIX.md`, `PRODUCT_PROFILE_MAP.md`,
`BLOCKERS.md`, `EVIDENCE_LEDGER.md`, `RELEASE_LEDGER.md`.

## Six continuous lanes
- **A — Runtime Recovery:** what is actually running (`RUNTIME_TOPOLOGY.md`).
- **B — Branch/Consolidation Recovery:** one coherent tree (`CONSOLIDATION_MATRIX.md`).
- **C — Operational Backend:** the 20 domain modules; fix PARTIAL/BROKEN before expanding.
- **D — Product-Profile Correction:** one tenant → one activated business profile.
- **E — Security / Adversarial:** attack the running system continuously.
- **F — End-to-End Operations:** behave like users; run the Golden Flows continuously.

## Priority ladder (always P0 → P1 before P2/P3)
- **P0** data leakage · tenant collision · payment authority · duplicate booking ·
  **overbooking** · auth bypass · runtime crash.
- **P1** core business flow broken · onboarding broken · embed broken · worker schedule
  wrong · invoice wrong · unavailable resource shown available.
- **P2** provider integration incomplete · UX state · responsive · perf.
- **P3** enhancement · cosmetic · optional.

## The loop (nothing bypasses it)
REPRODUCE → assign owner → FIX → unit → integration → **independent review** →
**adversarial** → **golden flow** → **Runtime Guardian** → CI → merge. Failure returns to
owner. **Complete only when operational behavior is proven — never because code exists.**

## Standing headline finding (2026-09-12)
**The code is far ahead of the live runtime.** The live Supabase project is at migrations
`0001-0009` (RC-2 baseline) with no edge functions; there is no API service; the rich
operational backend (capacity holds, resources, flows, worker/planning, modes, outbox —
`0010-0030`) exists only in the repo/branches and is **NOT CONNECTED**. Operational parity
therefore requires, in order: (1) land the consolidation to one coherent tree (Lane B),
(2) apply `0010-0030` to a runtime DB, (3) stand up one API service (Render, §11) seeded by
the `action-api` BFF, (4) wire connected surfaces + edge/API to the live DB, (5) prove the
Golden Flows. Overbooking prevention (`0010`/`0014`/`0022`/`0025`) is a **release blocker**
and is not yet in any runtime.

## Golden Flows (primary acceptance tests — Lane F)
- **A — Cleaning business:** owner signup → CLEANING profile → services → pricing →
  questionnaire → availability → worker/crew → embed publish → customer books
  (type/beds/baths/add-ons/date/time/location/details/mock-pay/confirm) → booking created,
  capacity blocked, worker assigned, portal+calendar+invoice+notifications reflect it.
- **B — Car detailing:** DETAILING profile; vehicle/package/add-ons/mobile-or-shop/date/
  payment; cleaning fields must NOT appear.
- **C — Vehicle rental (concurrency):** VEHICLE_RENTAL; owner adds SUV + images + daily price
  + availability; two customers race the same resource/dates → exactly one CONFIRMED, the
  other BLOCKED; run repeatedly under parallelism.

## Non-negotiables
- Preserve the frontend; visual change only to repair function / expose state / responsive /
  a11y / connect real data / fix broken flows.
- Do not rebuild: search repo + branches + PRs first; reuse/reconcile/fix. One domain, one
  authoritative implementation.
- Providers stay adapters (READY_NOT_CONNECTED / CONNECTED / DEGRADED / ERROR); missing
  credentials never break unrelated functionality; mocks remain for full E2E.
- Money is integer minor units + explicit currency. Availability is DB-authoritative, never
  browser-authoritative. Secrets are server-only.
