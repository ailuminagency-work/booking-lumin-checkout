# Booking Lumin Checkout — Architecture (v1)

Authority: Architecture Governor. Changes to shared contracts require an entry in `DECISIONS.md`.

## What this is

A multi-tenant booking & checkout platform. It generalizes a proven single-client
booking/checkout implementation (`embed-checkout`, the reference implementation)
into a clean product with **zero inherited trust**: no legacy credentials, data,
branding, or infrastructure relationships. See `CONTAMINATION_LEDGER.md`.

## Surfaces

1. **Customer Checkout** (`apps/checkout`) — embeddable + hosted, mobile-first.
   Flow: Service → Configuration → Cart/Summary → Availability → Customer/Location → Payment → Confirmation.
2. **Business Portal** (`apps/portal`) — one business's tenant-scoped workspace:
   Dashboard, Bookings, Customers, Services, Availability, Checkout Config, Integrations, Settings.
3. **Lumin Command Center** (`apps/command-center`) — platform operations:
   businesses, usage, bookings, GMV vs platform revenue (never conflated), integration/system health.
   Aggregate data only wherever PII is unnecessary.

## Layers

```
apps/checkout      apps/portal      apps/command-center     (React, Vite)
        \               |                /
         `------ @lumin/contracts ------'      typed contracts + zod (v1)
                        |
                  @lumin/core                  pure domain engines:
                        |                      pricing, availability, booking state
                  @lumin/adapters              PaymentProvider / CalendarProvider /
                        |                      NotificationProvider (mock-first)
              supabase/ (schema + RLS)         tenant-isolated persistence,
                                               DB is the security boundary
```

- **Contracts before dependencies**: apps and engines compile against
  `@lumin/contracts`; implementations are swappable behind interfaces.
- **Engines are pure**: no I/O, no wall clocks (`now` is injected), no provider SDKs.
  The same pricing engine renders client-side estimates and produces the
  server-authoritative charge amount; only the server result is charged.
- **Adapters are the only place provider-specific logic may live.** Development
  runs entirely on mocks; every tenant integration starts `not_connected`.

## Service generalization

One `Service` schema powers all verticals via archetypes that are *flow presets*,
not separate engines: `simple`, `cart`, `configurable`, `rental` — built from the
shared primitives items / add-ons / questions / rental periods (see
`packages/contracts/src/service.ts`). Generalization proofs: junk removal (cart),
car detailing (configurable), house cleaning (configurable + recurrence flag),
all as seed configurations in `packages/core/test/generalization.test.ts`.

## Tenancy & trust

- Every domain row carries `tenant_id`; RLS denies cross-tenant access at the
  database layer (Security Invariant 4). Application checks are convenience only.
- Platform roles (`PLATFORM_ADMIN`) and tenant roles (`BUSINESS_OWNER`,
  `BUSINESS_STAFF`) are distinct trust levels held in separate tables.
- Public checkout runs as anonymous tenant-scoped sessions with an idempotency
  `sessionKey`; it can read only what a customer needs (active services,
  availability) and write only its own booking drafts.

## Booking correctness

- State machines for bookings and payments are declared once in contracts and
  enforced everywhere (`BOOKING_TRANSITIONS`).
- Idempotent creation: `(tenant_id, idempotency_key)` unique; retries return the
  original record. One successful payment → at most one booking, via unique
  `payments.provider_intent_id` and `bookings.payment_id`.
- Availability **fails closed** before any financial commitment.

## Repository layout

- `packages/contracts` — versioned shared types/schemas/interfaces (source of truth).
- `packages/core` — pricing, availability, booking engines + tests.
- `packages/adapters` — mock providers (+ future real adapters).
- `apps/*` — the three surfaces.
- `supabase/migrations` — clean-room schema; **never applied to the legacy project**.
- `docs/` — this file plus governance ledgers.
