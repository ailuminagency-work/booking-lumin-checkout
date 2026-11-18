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

## Bounded attestation expansion (0105)

0104 alone deliberately left witness0103 unchanged. The separate additive0105
preserves0103's checks and adds the two new RPCs, tables and immutable triggers.
Function bodies/signatures/security/search_path/privileges, table columns and
constraints, and new-table defaults/identity/generated expressions are pinned.
All client access and direct service writes remain forbidden; the new ledgers
also reject service SELECT, including column-only and PUBLIC/inherited grants.
Constraint fingerprints use empty search_path and bytewise C ordering, preserving
the reviewed PostgreSQL16 cross-locale portability correction.

Only after the expanded contract passes and predecessor witness is exactly0103
does0105 advance the witness. The actual reader expects0105 and keeps evidence
`core_schema_contract`. This is not full historical-chain replay, provider-source
verification, or activation approval. Tests mutate54 catalog properties through
the actual reader AND guard, four witness cases, plus wrong predecessor refusal.
No production comparison is relaxed and no witness is advanced simply because a
new migration filename exists.

## Tests and activation gates

Apply all numbered migrations to a fresh owned disposable PostgreSQL using the
local harness. Run payment_intent_association_tests.sql with ON_ERROR_STOP. The
Python payment-intent-association-concurrency.py reuses source-binding safety
validation and fixtures, then exercises actual concurrent request/intent races.
It requires explicit loopback host, bounded numeric port, dedicated
lumin_source_binding_ database and opt-in. CI creates and drops its own fixture DB.
No external credentials are used. Existing source binding, tenant isolation,
role-denial, payment provenance and RLS tests remain in the regression set.

Before activation: exact-head PostgreSQL16 CI, independent review,
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
