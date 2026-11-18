# Phase 1a: legacy payment-recording compatibility floor

Base PR280 / 4c7aea9. Source-only candidate, no hosted deployment or provider
activation. This is NOT source-aware payment identity or production readiness.
No provenance columns, scoped writer/resolver, index removal, retry/replacement,
refund or webhook ACK changes are included.

0112 adds public.record_legacy_payment_observation, fixed to stripe_connect with
no provider/source parameters, service EXECUTE only. It validates server assertions,
inserts using the existing global UNIQUE(provider,provider_intent_id) with DO NOTHING,
locks/rereads the authoritative payment, validates tenant/booking/money and checks
canonical booking identity. Existing rows are never updated, including advanced
states/review/refund evidence. Conflicting identity aborts atomically; a mismatched
new insertion cannot survive. The function returns only the existing handler's
payment fields, no provider client capability or private error detail.

The Edge handler replaces its two-column PostgREST upsert plus separate reread with
this RPC. It still validates returned authority, returns409 for advanced state, and
only returns a capability for requires_payment with a usable token. Newly observed
advanced anchors commit in the RPC before that409; they are not discarded merely
because there is no frontend capability. Database/provider uncertainty keeps the
bounded hold; no release/refund/absence inference was added. Identity-conflict error
mapping is exact and generic. Other database errors remain generic500.

## Locks and limits

There is no explicit booking lock before unique arbitration. After payment row
locking, canonical booking identity is protected by FOR SHARE, following existing
payment -> booking financial RPC ordering. However a genuinely new INSERT still
performs booking-FK KEY SHARE checks. This is NOT a universal claim that inserts
hold no booking lock, nor proof of absence of every possible cross-system deadlock.

Actual gated tests hold success/failure/park transactions and observe recorder
blocking, then commit and prove advanced-state preservation. Reverse-order cases
block those financial RPCs until the recorder commits. An existing-row recorder
waiting on payment permits the lock holder to acquire the booking NOWAIT, checking
that it did not introduce an explicit booking-first inversion. Separate new-INSERT
FK tests hold booking FOR UPDATE and prove both the RPC and old insert path block
on that transaction, remain invisible and complete after release. Old two-column
DO NOTHING writers and the new RPC are tested in both winner orders; concurrent
new RPC writers converge without overwriting the winner.

## Rollout/cutover prerequisites

Deploy the migration before any handler expecting this RPC. Missing RPC fails
closed500, but a provider request may already have occurred, so this is not an
acceptable substitute for deployment ordering. No deployment happened here.
Global uniqueness is retained and explicitly attested by0113. Existing mock writers
and old Edge two-column upserts therefore remain compatible in this phase. Rollback
to the old handler remains within the same legacy identity model only.

A later reviewed provenance migration must redefine the same legacy RPC to refuse
any non-NULL scoped provenance BEFORE scoped rows are created. Old intent-only
handlers/readers must be retired before scoped activation. A later global-index
cutover must replace this RPC's ON CONFLICT dependency AND every remaining writer,
including mock SQL, plus intent-only webhook lookups. Never simply drop the global
constraint: partial scoped/legacy indexes cannot satisfy the old unqualified
ON CONFLICT target. Unknown legacy rows must not be backfilled or adopted as source
proof. Those repairs remain separate work, not claims made by this compatibility floor.

0113 retains all0111 guards and attests the new RPC definition/security/grants and
continued valid, nondeferrable global unique constraint. Actual reader and standalone
SQL expect0113. This is bounded catalog verification, not provider/source proof.

## Verified local evidence

Fresh PostgreSQL16.16 C and en-US ICU full-chain replay and standalone attestation
SQL passed. Each locale ran separate fresh clones for:30 new recording checks with
real lock barriers, existing40 provider-processing cases,102 actual reader+guard
catalog mutations plus four witness negatives/predecessor rejection, and existing
mock-payment completion/concurrency integration. No real captures were performed.

Actual Edge handler mock-boundary tests:76 passed, including exact RPC parameters,
no direct upsert, existing advanced/null-token matrix, conflict/missing-RPC-result
handling, and no hold release. With webhook and attestation tests:118 passed.
API TypeScript noEmit, actual Deno check of modified Edge handler and diff check
passed. PostgREST network transport and hosted deployment remain untested here.
