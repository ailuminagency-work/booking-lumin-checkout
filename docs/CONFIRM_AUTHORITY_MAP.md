# Confirmation Authority Map

**Status:** `UNVERIFIED`
**As of:** 2026-09-26
**Safety rule:** only a payment-verified, server-authoritative path may write `confirmed`.

## Source candidates

| Candidate surface | Source evidence | Current classification |
|---|---|---|
| `packages/core/src/booking.ts` `confirmFromPayment` | Core transition guard requires a succeeded payment intent and makes confirmation idempotent | `IMPLEMENTED` as a library invariant; hosted writer unverified |
| `packages/adapters/src/stripePayment.ts` | Provider adapter maps a succeeded payment event to the core confirmation boundary | `IMPLEMENTED` as adapter logic; real provider activation deferred |
| `supabase/functions/stripe-webhook/index.ts` | Webhook entrypoint is present in the repository | `BRANCH/REPOSITORY CANDIDATE`; deployed function inventory was empty in the observed live snapshot |
| `apps/api/src/main.ts` and `apps/api/src/http.ts` | R2a API explicitly has no booking-confirm route and does not write `state='confirmed'` | `NOT THE CONFIRM WRITER` |
| Checkout payment UI | `apps/checkout/src/steps/Payment.tsx` calls a client helper after payment intent completion | `CALLER ONLY`; cannot be authority |

## Required single-writer contract

The certified path must be:

`provider event / verified provider result → server-side payment verification → transactional booking transition → durable event/outbox → customer/portal projection`.

The browser, portal, AI action layer, or an unverified webhook must never set `confirmed` directly. The writer must verify tenant and booking/payment identity, amount/currency, idempotency, current state, and capacity/resource ownership inside one server-authoritative transaction.

## Evidence still required

- Exact staging deployment commit and route/function identity.
- A staging mock-provider golden flow for payment success, replay, failure, amount mismatch, and tenant mismatch.
- Concurrent replay proof showing one confirmation and one durable event.
- RLS and role-denial proof for customer, worker, business, and platform actors.
- Independent review of the exact candidate, followed by Integration Governor, Runtime Guardian, exact-candidate CI, and Release Governor gates.

Until those artifacts exist, this map remains `UNVERIFIED`; no confirmation writer is claimed as hosted or production verified, and no real payment credential may be connected.
