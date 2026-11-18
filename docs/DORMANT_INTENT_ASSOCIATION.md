# Dormant request and intent association (0104)

Base f73b199 includes the dormant source scopes and attempt bindings from0102.
0104 adds no runtime call, payment mutation, provider call, refund initiation,
legacy backfill, inbox processing or webhook acknowledgement change. Existing
unknown payment503 and payments(provider,intent) uniqueness remain unchanged.

## Two phase contract

Before a genuinely new provider attempt, a trusted server can snapshot the charge
via snapshot_payment_attempt_request(tenant, attempt, amount, currency). Authority
is resolved from the immutable attempt and locked booking, not metadata. Amount
and currency are trusted server-pricing assertions, NOT SQL-verified pricing or
provider facts. Positive safe integer amount and uppercase currency are required.
The first snapshot refuses recorded payments or terminal bookings. Exact retry
returns the existing snapshot; changed price/currency fails closed. This does not
freeze a hold, customer, provider request options or attempt deadline.

associate_payment_attempt_intent accepts a trusted server-observed response with
explicit platform account, connected account, mode, amount and currency. Every
field must match the immutable request/source; all tenant/booking association
comes from the original attempt. One intent per attempt; each source/intent can
belong to only one attempt. Identical opaque intent IDs remain distinct across
account or mode scopes. Reconnection never rewrites historical routing. Observing
an old attempt after revocation does NOT authorize another charge or disclose its
client token. No token, raw payload, signature or arbitrary metadata is stored.

The database cannot establish provider authenticity. Future server code must use
verified endpoint identity and the pinned adapter; a privileged caller can still
lie about observations. These functions are dormant assertions/association, not
financial processing authority. No attempt may be retrospectively manufactured
for a legacy payment with unknown source. Absence of a payment row is not proof
that no historical provider request occurred.

Both tables are RLS-forced and have no policies or direct grants, including reads
by service_role. Service-only RPCs return scoped rows. History cannot be updated
or deleted, including by ordinary administrative SQL; retention decisions remain
separate. Booking-first locking matches0102; unique scope/intent index resolves
cross-booking competition. Cross-platform identity is checked too, not merely
account and mode.

## Attestation intentionally pending

0103 attests its existing contract and migration witness0103. 0104 does not change
that witness or claim that its new objects are covered. Source-head0104 versus
DB witness0103 MUST remain a readiness mismatch until a separately reviewed
attestation expansion includes both new tables, privilege/trigger/function shapes
and definitions. No production comparison is relaxed. PostgreSQL16 portability
fix for0103 belongs to the parallel attestation work, not this change. Apply its
reviewed correction before final integration and rerun all contract mutation tests.

## Tests and activation gates

Apply all numbered migrations to a fresh owned disposable PostgreSQL using the
local harness. Run payment_intent_association_tests.sql with ON_ERROR_STOP. The
Python payment-intent-association-concurrency.py reuses source-binding safety
validation and fixtures, then exercises actual concurrent request/intent races.
It requires explicit loopback host, bounded numeric port, dedicated
lumin_source_binding_ database and opt-in. CI creates and drops its own fixture DB.
No external credentials are used. Existing source binding, tenant isolation,
role-denial, payment provenance and RLS tests remain in the regression set.

Before activation: expanded attestation, PostgreSQL16 CI, independent review,
source-aware payment attachment, complete request/response contract, scoped
verified event parsing, durable retries/quarantine/alerts and explicit rollout
controls are still required. External refunds may only be reconciled; no refund
creation primitive is added.

Local verification: PostgreSQL 18.6, fresh owned UTF8 loopback cluster database,
102 active migrations replayed; association, source-binding, connection-authority,
payment-provenance and RLS-attack suites passed. Real eight-session request and
intent duplicate/conflict races passed, including simultaneous two-booking claims
on the same source/intent. Source-binding safety rejection tests and hosted
readiness self-test passed. These do not certify0104 under the0103 witness.

This minimal writer foundation intentionally has no general lookup API. Restart
consumers needing an existing request without knowing its original amount need a
separately reviewed tenant/attempt-scoped reader; do not add broad service reads or
reprice silently to work around the conflict guard. No runtime can use this slice
as a complete recovery workflow.
