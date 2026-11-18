# Dormant scoped restart facts

Base: PR274 bfface6. No runtime caller, provider request, webhook ACK change,
refund initiation, backfill, deployment or capability disclosure.

0106 adds service-only read_payment_attempt_restart(tenant, booking), returning
JSON facts from one STABLE MVCC SELECT. Unknown, unbound and cross-tenant return
SQL NULL. Database failure remains an error, not absence. The returned immutable
attempt and source identity, original optional amount/currency/schema snapshot,
and optional scoped intent association are observations only. No idempotency key,
client secret, credentials, customer data, raw event or retry verdict is returned.
No booking terminal-state permission is inferred; historical sources remain readable
after connection changes. The reader verifies booking tenant/key, source tenant/provider
and intent source consistency and raises PAYMENT_RESTART_FACTS_CONFLICT on drift.
It never reprices, locks rows, writes, reconstructs a missing record or calls Stripe.

Missing request/association is NOT proof that no provider request was dispatched.
The amount/currency snapshot is not a complete provider-request contract. Dispatch
state, replay horizon/ownership, source-aware payment attachment, verified event
routing and quarantine/escalation remain separate prerequisites. This RPC must not
be wired into retry/capture behavior on the strength of this slice.

0107 preserves every 0105 catalog check and pins the new reader body, exact signature,
return type, STABLE volatility, security definer, empty search path and role grants.
It advances the witness atomically only from 0105 after the combined contract passes.
The actual readiness reader revalidates this contract, not merely the witness string.
Existing direct request/intent table and column read denials remain unchanged.
This is bounded catalog attestation, not a data audit, full historical-chain proof
or protection against malicious database administrators.

## Reproducible verification

The normal fresh-database acceptance runner now includes
apps/api/src/payment-restart-facts.integration.mjs. This actual PG harness checks
unknown/cross-tenant results, exact safe shape, snapshot and association states,
concurrent uncommitted writers observed without waiting, historical connection
changes, terminal read-only operation, client execution/direct ledger read denial,
rollback-only booking-key and association-scope corruption, and no financial effects.
The existing actual-reader/migration-guard mutation harness retains its complete
negative matrix and adds eight reader mutations (absence/body/volatility/security/
path/client/PUBLIC/service grants). No test uses real providers.

Initial fixture failures correctly hit connection blocked-reason and legal booking
transition constraints; fixtures now declare charges_disabled and use the real
pending_payment -> failed transition. No production guards were relaxed.

Verified locally on PostgreSQL 16.16: fresh full-chain replay through 0107 in both
C and en-US ICU databases; the restart harness and all 62 negative catalog mutations
plus four witness negatives and predecessor rejection pass in each locale.
Migration-attestation unit tests: 15 passed. API TypeScript noEmit: passed.

Independent review found the standalone SQL suite still expected 0105. Corrected
supabase/tests/migration_attestation_tests.sql to 0107 (head and comment), without
changing its contract checks. Fresh PG16 C and en-US ICU replay now explicitly runs
that exact SQL suite as well as the restart and actual-reader mutation harnesses.
The original run did not include this standalone SQL suite.
