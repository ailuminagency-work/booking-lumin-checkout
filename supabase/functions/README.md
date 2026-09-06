# supabase/functions/ — Stripe test-mode payment Edge Functions (RC-3)

Two Deno Edge Functions implement the **server-side** half of the Stripe
test-mode payment path. They sit behind the same `PaymentProvider` contract the
domain uses, but run in the trusted server runtime (Supabase, `service_role`) so
that **no Stripe secret ever reaches the browser** (SI-5) and **all money
authority stays on the server** (SI-1/SI-2).

> These are reviewable artifacts for a **future, fresh Supabase project** (same
> caveat as `../README.md`). They are **not** wired to any live project here, and
> egress to Stripe is intentionally not exercised in CI — the adapter logic they
> mirror is fully unit-tested offline in
> `packages/adapters/test/stripePayment.test.ts` and
> `packages/core/test/paymentConsistency.test.ts` against a deterministic fake
> Stripe.

## Functions

| Function | `verify_jwt` | Auth | Purpose |
|---|---|---|---|
| `create-payment-intent` | **true** | Supabase JWT (checkout session) | Reprices server-side, re-verifies availability fail-closed, creates/reuses the Stripe PaymentIntent, upserts the `payments` row, returns only `{ clientSecret, publishableKey }`. |
| `stripe-webhook` | **false** | **Stripe signature only** | Verifies the Stripe signature, then idempotently confirms / fails / refunds the booking. |

### Why `verify_jwt` differs

- `create-payment-intent` needs an authenticated checkout caller, so it keeps the
  default `verify_jwt = true`. It **must not** be set to `false`.
- `stripe-webhook` is invoked by **Stripe**, which has no Supabase user JWT.
  It therefore **must** run with `verify_jwt = false`; its authentication is the
  **Stripe webhook signature alone** (`Stripe-Signature` header, verified against
  `STRIPE_WEBHOOK_SECRET` — SI-10). An unverifiable delivery is rejected `400` and
  nothing is processed.

Set this per-function (Supabase CLI `config.toml`):

```toml
[functions.create-payment-intent]
verify_jwt = true

[functions.stripe-webhook]
verify_jwt = false
```

## Required secrets (server-side only — never in the repo or the browser)

Set these as **Supabase function secrets / Vault** (`supabase secrets set …` or the
dashboard). They are read via `Deno.env.get(...)` and are **never** returned to the
client or written to logs (SI-5, SI-11):

| Secret | Used by | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | both | `sk_test_…` in test mode. **Server-only.** |
| `STRIPE_WEBHOOK_SECRET` | both | `whsec_…` webhook signing secret. **Server-only.** |
| `STRIPE_PUBLISHABLE_KEY` | create-payment-intent | `pk_test_…`. Non-secret; returned to the browser to init Stripe.js. |
| `SUPABASE_URL` | both | Injected by the platform. |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Injected by the platform. **Server-only.** |

The publishable key is the only Stripe value that crosses to the client, together
with the intent's `client_secret` (a non-secret, single-intent token).

## Deploy

```sh
# From the repo root, against a FRESH Supabase project (see ../README.md warning):
supabase functions deploy create-payment-intent
supabase functions deploy stripe-webhook --no-verify-jwt

# Secrets (test mode):
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Then register the webhook endpoint in the Stripe dashboard (test mode) pointing at
`https://<project-ref>.functions.supabase.co/stripe-webhook`, subscribed to at
least `payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`, and `charge.refunded`.

## Deliberate duplication (`_shared/`)

Deno cannot ergonomically import the `@lumin/*` workspace packages (authored for
the Node/browser bundle, depending on `@lumin/contracts`). To keep the edge
runtime self-contained, three modules are **faithful Deno-native ports**, and
each carries a header noting the duplication:

| File | Mirrors | Why ported |
|---|---|---|
| `_shared/pricing.ts` | `packages/core/src/pricing.ts` | Server-authoritative repricing (SI-1). |
| `_shared/availability.ts` | `packages/core/src/availability.ts` | Fail-closed availability re-verification (SI-7). |
| `_shared/stripe.ts` | `packages/adapters/src/stripePayment.ts` | Stripe REST + real webhook signature scheme (SI-10), using Deno Web Crypto. |

**Any change to a source module must be mirrored in its port.** The offline test
suites are the source of truth for the numbers/behavior these ports must
reproduce; a future step (orchestrator) may replace the ports with a bundled copy
of `@lumin/*`.

## RC-3 hardening (adversarial-review findings closed)

### F1 — DB-authoritative capacity holds + refund-on-oversell compensation

Capacity was previously enforced only in application code: `create-payment-intent`
read availability, then set `pending_payment` — a TOCTOU window in which two
concurrent last-slot checkouts could BOTH pass before either wrote a hold, and
the webhook confirmed whatever was pending with no oversell compensation.

The fix (migration `0010_capacity_holds.sql`):

- A `capacity_holds` table and a SECURITY DEFINER RPC `lumin.reserve_capacity`
  that **atomically** reserves a slot. It takes a **transaction-scoped advisory
  lock** — `pg_advisory_xact_lock(hashtextextended(tenant||':'||service||':'||slot_start, 0))`
  — so every concurrent reservation for the same `(tenant, service, slot)`
  serializes on the same lock. Under the lock it counts consumers
  (active non-expired holds + capacity-consuming bookings without an active
  hold) and inserts an `active` hold only when `consumers < capacity`, else
  returns `NO_CAPACITY`. Idempotent on `booking_id` (one hold per booking).
- `create-payment-intent` calls `reserve_capacity` **before** minting the Stripe
  intent, using the availability engine's authoritative slot capacity. On
  `NO_CAPACITY` it returns **409** and mints no intent; on a later failure it
  calls `release_hold`.
- `stripe-webhook` on `payment_intent.succeeded` **re-verifies the hold is still
  `active`** (or already `consumed` for this booking), then confirms +
  `consume_hold`. If the hold is **missing / expired / released** at confirm
  time (oversold or lost), it does **not** confirm — it issues a Stripe
  **refund** for the intent, records it, moves the booking to `failed`, and
  returns 200. This is the **deterministic refund-on-oversell** path. On
  `payment_failed`/`canceled` it calls `release_hold` + fails the booking.

The in-core reference engine (`@lumin/core` `createBookingEngine`) already
reserves synchronously before any `await`; `lumin.reserve_capacity` is the
runtime-authoritative equivalent for the multi-process edge/DB deployment.

### F2 — bound authorization / capability-token model

`create-payment-intent` never trusts the body's `tenant_id` alone:

- **Authenticated (portal)** — a Supabase user JWT (`role: authenticated`,
  `sub`): the caller **must be a member** of the booking's tenant
  (`tenant_members`), else **403**.
- **Anonymous (public checkout)** — the anon JWT: the booking's
  `idempotency_key` is a **capability token**. The endpoint requires the token
  to match the booking's stored key, `(tenant_id, booking_id)` to resolve to the
  **same row**, and the booking to be in `draft`/`pending_payment` for the
  stated tenant. Any mismatch is rejected — binding an anonymous minter to
  exactly the one draft it created.

`metadata.tenantId` on the intent is always set server-side from the loaded
booking, never from client-asserted values.

### F3 — webhook amount guard, fail-closed

On `payment_intent.succeeded` the booking is confirmed **only** when a positive
amount is present **and** equals the server `payments.amount`. Missing / null /
`≤ 0` / mismatched ⇒ never confirm; the delivery is routed through the F1
compensation (refund + fail). No skip-on-null.

### F4 — refund accounting

`charge.refunded` uses **`amount_refunded`** (cumulative), not the full charge
amount: a partial refund marks the payment `partially_refunded` and leaves the
booking state; only a full refund (`amount_refunded ≥ payments.amount`) drives
the booking to `refunded`. Refund inserts **dedupe** on the Stripe refund id
(`refunds.provider_refund_id`, unique per provider — migration
`0011_refund_accounting.sql`), so a replayed refund webhook is a no-op.

### F6 — engine defense-in-depth

`packages/core/src/booking.ts` `confirmFromPayment` additionally asserts the
provider-verified intent amount equals the booking's authoritative charge
(`total + deposit`) before confirming; a mismatch throws
`PAYMENT_AMOUNT_MISMATCH` and never confirms.

**Verification:** throwaway Postgres applies `0001`–`0011` clean;
`supabase/tests/capacity_tests.sql` (sequential final-slot proofs) and
`supabase/tests/capacity_concurrency_harness.sh` (two overlapping transactions →
exactly one winner) pass; `supabase/tests/rls_attack_tests.sql` still passes in
full. Offline vitest covers F4 (`packages/adapters/test/refundAccounting.test.ts`)
and F6 (`packages/core/test/amountMismatch.test.ts`).

## Invariants enforced here

- **SI-1** — the charge amount is recomputed from the service config on the
  server; the client never submits a price, and the webhook re-checks the Stripe
  amount == the stored `payments.amount` before confirming
  (`PAYMENT_AMOUNT_MISMATCH` otherwise).
- **SI-2** — booking/payment state transitions go through the DB state machine
  (migration 0005 triggers); the webhook is the only path to `confirmed`.
- **SI-3** — one payment ⇒ one booking: `payments(provider, provider_intent_id)`
  is unique; the create endpoint upserts on that key and the webhook confirms
  `pending_payment → confirmed` exactly once. A replayed webhook is a no-op.
- **SI-5** — secrets are server-only; only `clientSecret` + publishable key reach
  the browser.
- **SI-7** — availability is re-verified fail-closed before any charge, and
  capacity is reserved DB-authoritatively (F1) before the intent is minted.
- **SI-10** — the webhook authenticates via the Stripe signature alone; bad
  signatures are rejected `400`.
