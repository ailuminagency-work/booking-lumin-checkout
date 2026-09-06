# RC-3 Evidence Report — Real Payment Runtime (Stripe TEST)

**Milestone:** RC-3 — Real Payment Runtime, Stripe **TEST MODE ONLY**.
**Verdict:** **CONDITIONAL PASS** — the offline/reviewed integration candidate is certified
(merged `ffec95d`, `READY — NOT CONNECTED`); **live certification is pending** (a) the two
pre-connection fixes below, and (b) real Stripe test keys + egress to the project host.
No production credential used; no external provider connected.

## Stripe test architecture

Trust path: **Browser → Booking Lumin Edge Function → Stripe**. The Claude container is **not** in
the production Stripe trust path. All real Stripe calls originate inside Supabase Edge Functions.

- **`StripePaymentProvider`** (`packages/adapters/src/stripePayment.ts`) behind the existing
  `PaymentProvider` contract — Stripe REST via injected `fetch` (no SDK dep), Stripe-native
  `Idempotency-Key`, real `t=<ts>,v1=HMAC_SHA256(secret,"<ts>.<payload>")` webhook verification
  (constant-time, 5-min skew). Server-only; the browser checkout never imports it.
- **Edge functions** (Deno, `service_role`): `create-payment-intent` (reprice server-side, verify
  availability fail-closed, **reserve capacity atomically**, mint intent with the server amount,
  return only `clientSecret` + publishable key) and `stripe-webhook` (verify signature, confirm
  idempotently, **refund-on-oversell compensation**). Secrets read only from `Deno.env`.
- **Capacity authority (W6)** — `supabase/migrations/0010_capacity_holds.sql`: a
  `capacity_holds` table (RLS forced, zero client policies/grants) + SECURITY DEFINER
  `reserve_capacity` using `pg_advisory_xact_lock` to serialize count-then-insert. This is where
  capacity becomes authoritative — in the database, not application code.

## Financial invariants — verified

| Invariant | Result |
|---|---|
| Client totals never authoritative | PASS — no client-amount path; edge reprices |
| Stripe amount == server-recomputed amount | PASS (create + webhook fail-closed guard) |
| `confirmed` only via payment-authority path | PASS — engine `transition()` + DB guard refuse it; webhook is sole confirmer |
| Payment tenant resolved independently from DB; metadata is correlation only | PASS — webhook never trusts `metadata.tenantId` |
| Availability valid at commitment | PASS — DB-authoritative capacity hold reserved before intent |
| Retries idempotent; duplicate webhooks harmless | PASS |
| Failed notification/calendar can't reverse a booking | PASS (no such reversal path) |
| Stripe secret server-only | PASS — 0 `sk_`/`whsec_`/`STRIPE_SECRET` in any browser bundle |

## Threat matrix (30 items)

Two independent adversarial reviewers (neither built the code). Results, offline against a
deterministic fake Stripe + throwaway Postgres:

- **PASS (adapter/engine/DB, executed):** 1 price manipulation, 2 negative/malformed amount,
  3 stale checkout, 4 failed, 5 incomplete, 6 canceled, 7 succeeded, 8 duplicate submit,
  9 duplicate finalize, 10 duplicate webhook, 11 replay, 12 forged signature, 13 wrong intent,
  18 retry-after-timeout, 19 webhook-before-callback, 20 callback-before-webhook,
  23 idempotency-key reuse w/ altered payload, 28 metadata can't override tenant, 29 one
  payment→one booking, 30 one booking→one payment.
- **PASS after W6 hardening:** 17 payment-succeeds-booking-fails (compensation), 21 simultaneous
  final-slot race, 26 partial failure payment↔booking, 24 refund, 25 cancellation.
- **UNVERIFIED (needs-live), by construction:** 14 wrong-tenant & 27 service-role-not-invocable &
  29 DB-uniqueness — proven at code/RLS level, final proof is the SQL attack suite against the real
  project; 15/16 (frontend-independent confirmation) proven by design; live GoTrue/PostgREST/Stripe
  round-trips.

## Concurrency (final-slot race) — proven

`reserve_capacity` serializes via `pg_advisory_xact_lock`. Independently reproduced:
6-way contention on a capacity-1 slot → **1 GRANTED, 5 NO_CAPACITY, 1 active hold**; 8-way on
capacity-3 → **3 GRANTED, 5 NO_CAPACITY, 3 active holds**. Expired hold + still-pending booking is
still counted (no silent oversell). Reserve precedes intent mint (NO_CAPACITY → 409, no charge). A
booking can only confirm if it won an active hold under the lock ⇒ **cannot confirm while oversold**;
if a payment nonetheless succeeds without a valid hold → **deterministic refund + booking failed**.

## Defects found and fixed

Review 1 (30-item): **APPROVE-WITH-FIXES** — F1 final-slot oversell + no compensation, F2 auth not
tenant-bound, F3 webhook amount guard not fail-closed, F4 refund accounting, F6 engine amount
recheck. All five **closed** by W6 (`738965e`). Review 2 (W6 re-review): **APPROVE-WITH-FIXES**,
all five closures confirmed under independent attack, no regression (RLS 32/32, 257 tests).

## Remaining risks (fix BEFORE connecting real Stripe — tracked, task #35)

- **RISK-1** — the compensation `refund()` call lacks a Stripe `Idempotency-Key`; a 500-retry could
  loop on a wedged refund (never over-refunds — DB + Stripe both dedupe). Add an idempotency key.
- **RISK-2** — a valid payment whose 15-min hold TTL lapsed before the webhook lands is
  auto-refunded even if the slot is still free. Change to **re-reserve-then-confirm; refund only on
  genuine oversell**, so webhook lag / delayed-settlement doesn't refund a valid customer.
- Doc nit in `0011` comment ("partial index" → plain unique).

## CI + evidence

CI green on the merged head (`verify`: typecheck 0 / 257 tests / 3 builds / contamination; and
`database`: migrations `0001–0011` + RLS attack suite 32/32). Capacity suite `capacity_tests.sql`
10/10 + concurrency harness on Postgres 16.

## Go / No-Go for RC-4

**Conditional GO**, gated on: (1) the two pre-connection fixes, (2) you setting the Stripe test
secrets in Supabase + providing the `pk_test` publishable key, (3) egress allowlist for
`pplwyfbxrnodimhzlvdl.supabase.co` so the live threat-matrix runs through the deployed runtime.
Only after the live run passes does RC-3 become an unconditional PASS. RUNTIME-04 (Supabase
Auth/PostgREST HTTPS cert) stays open independently; RC-2 RISK-4 untouched. Per directive, no
Calendar/Email/SMS/CRM work until RC-3 fully passes.

## Live-wiring sequence (when you're ready)

1. You add Edge Function secret **`STRIPE_SECRET_KEY`** (= `sk_test_…`, ideally a restricted key)
   in Supabase → Project Settings → Edge Functions → Secrets.
2. You give me the **`pk_test_…`** publishable key (public config) and allowlist the project host.
3. I land the two pre-connection fixes, deploy `create-payment-intent` + `stripe-webhook`, and hand
   you the webhook URL.
4. You create the Stripe **test-mode** webhook for that URL (events: `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`) and add
   **`STRIPE_WEBHOOK_SECRET`** (= `whsec_…`) in the same Secrets screen.
5. I run the live threat matrix through the deployed runtime and report the unconditional verdict.
