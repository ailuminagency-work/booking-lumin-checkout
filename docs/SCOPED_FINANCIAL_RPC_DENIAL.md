# Close five legacy financial RPC boundaries

Source-only successor toa15cacf. No deployment, provider calls, refund initiation,
scoped processing or financial-policy change.

0120 replaces exactly five definitions: confirm_succeeded_payment from0088;
succeed_payment_webhook, fail_payment_webhook and park_payment_webhook from0101;
record_refund_webhook from0098. Immediately after each existing payment FOR UPDATE
and not-found handling, either nonnull provenance field raises42501 with bounded
SCOPED_PAYMENT_PROCESSING_DISABLED. It does not require both fields to be set.
The check precedes terminal-state no-ops, refund dedupe, booking/hold mutations,
review creation and confirmation outbox creation. Scoped resolved states cannot
silently receive a handled/no-op result from these legacy financial functions.

All other body text and existing lock order are unchanged. Confirmation/success
retain SHARE table locks before payment; refund retains ROW EXCLUSIVE table locks
before payment; failure/park retain their payment-first paths. Not-found behavior,
legacy NULL-provenance behavior, mock providers and existing financial semantics
remain intact. The source-generation check proved that removing each inserted
guard produces its exact previous body. Existing permissions remain service-only.

0121 retains0119 attestation checks, updates the five body fingerprints and adds
confirmation's exact definition/permissions with its existing pg_catalog search
path. Only confirmation gets that expected path; other functions retain their
empty-path requirement. A witness cannot advance from0119 until the contract passes.
Actual reader/guard negatives remove each new denial and verify rejection.

## Verification and limits

Actual disposable PostgreSQL16 C/en-US ICU full-chain replay and standalone SQL.
47 new denial cases cover all six payment states across all five RPCs, both kinds
of partial corrupt provenance, client execution denial, committed/uncommitted
visibility and deterministic waits behind scoped recorders. Complete snapshots of
payments, bookings, capacity/resource holds, refunds, reviews and durable outbox
remain unchanged on denial. Prior18 identity,44 legacy webhook,35 provenance,
30 recording,40 processing and mock integration suites remain, including real
financial table/row contention. Scoped cases that formerly exercised financial
processing now require explicit denial; independent legacy/mock cases preserve
the old successful behavior.163 catalog negatives plus witness/predecessor cases,
123 handler/recording/attestation tests and API typecheck pass.

This closes those five RPC paths only. It is NOT a universal prohibition on
privileged service-role SQL, other booking RPCs or future financial entry points.
Legacy provenance remains unknown. Source-aware refund identity/dedupe and refund
event evidence remain unresolved activation blockers. No mixed-version rollout,
source-aware financial processing or live-provider readiness is claimed.
