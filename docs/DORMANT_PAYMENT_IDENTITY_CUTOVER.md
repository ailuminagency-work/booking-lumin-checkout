# Dormant payment identity cutover

Source-only successor to3fdbd90. No deployment, scoped financial processing,
provider activation, ACK change, refund initiation or legacy provenance backfill.

0118 takes ACCESS EXCLUSIVE on payments and atomically replaces global
UNIQUE(provider,intent) with two unique partial indexes: legacy(provider,intent)
for both provenance fields NULL, and scoped(provider,source_scope_id,intent) for
both nonnull. Unique attempt and all canonical immutable provenance checks remain.
Both recording RPCs now use exact partial conflict targets and exact class/source
rereads. Legacy webhook processing explicitly excludes scoped identities and
selects only legacy rows; it retains branch-specific table-before-payment locks.
There is no executable global conflict target in current writers. Historical
migrations remain unchanged; one negative test proves old SQL is unsupported.

## Mixed legacy/scoped exclusion

A BEFORE INSERT/UPDATE trigger covers direct writes, not only RPC callers. Stripe
identity changes (ID, tenant, booking, provider, intent or provenance) are forbidden,
including entering or leaving Stripe via provider UPDATE. Scoped money remains
immutable. Legacy money behavior is unchanged; no guessed canonical backfill.

Every Stripe admission uses a transaction advisory TRY lock, with a fixed namespace
and hash of provider+intent, before testing for the opposite class. Hash collisions
can cause conservative contention, not weaker exclusion. The helper is VOLATILE;
at READ COMMITTED its query gets a fresh snapshot after acquiring the lock. An
unsupported isolation level is refused. Holding the identity lock until transaction
end prevents a second admitted writer from racing the class check. Same source
duplicates are resolved by unique indexes; distinct scoped sources can coexist.

The lock never waits: contention raises55P03. Both RPCs acquire it before INSERT;
the trigger repeats the same reentrant check for direct INSERT coverage. This
avoids introducing advisory-lock waits while a statement/row lock is held. It
does not claim universal deadlock freedom for existing financial/resource locks.
Financial state-only UPDATE takes no new admission lock. Existing group financial
statement triggers already reject direct REPEATABLE READ/SERIALIZABLE operations
with0A000; new RPC admission independently rejects25000. Those guards are retained.
No automatic provider retry or replacement policy follows from a database error.

Actual statement-snapshot tests block a top-level INSERT before its row trigger,
commit an opposite-class writer, then release the INSERT. Both directions must
observe the newer commit and reject. Tests also cover both held-writer orders,
simultaneous direct races, rollback/retry, unsupported isolation, identity UPDATE,
same-source duplicates, distinct account/mode coexistence and exact-mode receipt
resolution. Existing financial table/row contention suites remain in place.

## Activation and rollback blockers

This is not permission to activate scoped financial processing. Legacy NULL rows
still lack trusted original-source evidence. Old pre0116 Edge lookup callers can
select a sole scoped row and mutate it; they must be retired before scoped rows
are activated. The rollback floor must be wrapper-aware and partial-index-aware,
not an old intent-only handler. Mixed-version deployment is not proven safe.

Refund identity still has global provider/refund-ID uniqueness and0098 global
dedupe. That can conflate distinct sources. PI-only receipts lack refund shapes.
Both are hard blockers to scoped refund/financial activation. Existing UUID
financial RPC service privileges remain, not new source processing authority.
The dormant receipt resolver returns observations, not permission to ACK/process.

0119 retains prior bounded authority checks while deliberately replacing the
superseded global uniqueness/body fingerprints with the new admission functions,
trigger, exact valid/ready unique partial indexes and updated writer bodies.
All other checks remain; the witness advances from0117 only after validation.
This is not full history, hosted compatibility or live-provider verification.

## Local evidence

Fresh PostgreSQL16 C and en-US ICU full-chain replay and standalone SQL.18 new
cutover checks include multiple subcases/races; separate clones retain44 webhook,
35 provenance,30 legacy recording and40 processing checks plus mock integration.
152 catalog mutations and four witness/predecessor cases exercise the actual
reader/guard.123 handler/recording/attestation tests and API typecheck pass.
No external provider or hosted service was called. Compatibility tests now expect
retryable admission contention and explicit partial-index semantics, not silently
pretend old global SQL still works.
