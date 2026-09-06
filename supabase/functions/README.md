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
- **SI-7** — availability is re-verified fail-closed before any charge.
- **SI-10** — the webhook authenticates via the Stripe signature alone; bad
  signatures are rejected `400`.
