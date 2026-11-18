# Dormant payment source binding foundation

Migration 0102 is additive and not wired into any runtime path. Base b42eacc ends
at 0098 (0097 is absent); 0099, 0100 and 0101 are reserved independent candidates,
not copied or silently considered applied here. Merge ordering remains a gate.

`register_payment_source_scope(tenant, platform_account, livemode)` is service-only.
It locks the canonical tenant `stripe_connect` connection, requires connected plus
charges enabled, and derives account/connection IDs from it. Platform identity and
mode are **trusted deployment assertions, not provider-verified facts**. No secret,
metadata, raw payload or client-supplied connected account is accepted. Immutable
scopes uniquely include provider/platform/connected account/mode/direct charge model.
A source cannot be transferred to a different tenant even if its former connection
is later reassigned. Registration is not activation or authority to take payment.

`bind_booking_payment_source(tenant, booking, expected_scope)` locks the booking,
derives tenant/idempotency key, and returns any existing binding BEFORE consulting
current connection. NULL scope is read-existing-only. A differing explicit scope
fails; callers cannot change account, platform or mode by retrying. First binding
requires the current connection still matches the registered source. Exactly one
attempt per booking/provider; no replacement-attempt policy. Existing payment rows
(including staging_mock), payment links, and terminal bookings refuse first binding.
No payments, payment state, global intent uniqueness or mock writer is modified.

Both tables force RLS without client policies. Only service_role can read; writes
are definer RPC only. Update/delete triggers prevent mutating ledger history.
Historical references intentionally restrict deleting associated booking/connection/
tenant records; no cleanup RPC is provided. A separately reviewed retention policy
is required before activation. Ordinary trusted booking mutation cannot silently
change the stored source; retry detects changed booking tenant/idempotency.

## Limits and deployment gates

This does not prove any existing legacy booking never reached the provider. Absence
of a payment row is NOT that proof. Future wiring must bind before a demonstrably
new attempt; never use this RPC to reconstruct uncertain legacy provenance.
It does not freeze price, hold, customer, attempt deadline or provider response.
It creates no intent/event association, durable inbox, retry worker, or webhook ACK
change. No claim is made that existing intent-only reconciliation is source-safe.
Current global payments(provider,intent) uniqueness still prevents representing the
same intent ID across distinct sources. Provider response/event authority and source-
aware payment association require separate reviewed changes before use. Merely
returning an old scope does not authorize executing an old charge after revocation.
The caller must resolve uncertainty safely rather than begin a new source/attempt.

## Reproduction

Apply local_harness and all active numbered migrations to an owned disposable
PostgreSQL. Run `supabase/tests/payment_source_binding_tests.sql` using psql with
ON_ERROR_STOP. For real concurrent sessions set explicit loopback PGHOST, PGPORT,
PGDATABASE (lumin_ prefix), PGUSER, PAYMENT_SOURCE_DISPOSABLE=1 and optionally
PSQL_BIN, then run `python3 scripts/payment-source-binding-concurrency.py`.
Concurrency fixtures are retained in that disposable database; use a fresh DB for
repeat runs. CI runs both suites. No provider or network credentials are used.

Local evidence (2026-11-18): fresh owned PostgreSQL 18.6 / UTF8 loopback cluster,
97 active numbered migrations replayed; source-binding tests, connection authority,
payment provenance and RLS attack suites passed. Actual eight-session duplicate
scope/binding races and mixed-mode first-bind race passed. Existing mock-payment
and v9 integration fixtures refused this different disposable target via their
hardcoded safety guards; these were not bypassed or counted as passes. New suite
separately verifies a recorded staging_mock payment remains unchanged and cannot
acquire a Stripe source. PostgreSQL 16 CI and independent review remain gates.
