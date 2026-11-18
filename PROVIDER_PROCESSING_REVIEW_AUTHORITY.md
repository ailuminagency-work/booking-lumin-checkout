# Provider processing versus human review (source candidate)

Base: `f4b21b5` (PR 268). Migration 0101 is additive. This branch deliberately
lacks reserved 0099/0100 and does not establish hosted migration attestation.
No deployment, real Stripe calls, capture, refunds issued, or production changes.

## Defect and authority

Stripe `processing` was stored in payments without a review, but the webhook
handler and failure/park RPCs treated every processing row as human-parked.
A real provider's later success or failure could be acknowledged without action.
The new service-only succeed_payment_webhook takes confirmation/refund table
fences before the payment lock. Review presence (open OR resolved) is authority,
not the overloaded processing label. It locks/validates the tenant-bound booking,
protects terminal outcomes, validates amount, and calls existing canonical
confirmation inside the same transaction. Only exact CONFIRMATION_HOLD_INVALID
is caught and parked; promotion/hold/outbox mutations roll back first. Unrelated
errors remain retryable failures. Rental validation remains in the existing RPC.
The fail/park RPCs now admit unreviewed processing while protecting all reviews.
The handler routing lookup is never used as mutation authorization.

## Review writer contract and lock order

The review trigger obtains the parent payment row FOR UPDATE NOWAIT for all
insert/update/delete paths. UPDATE already holds a review tuple before its row
trigger runs: a blocking parent lock would invert park's payment->review order.
NOWAIT deliberately returns 55P03 under that contention; retry the COMPLETE
transaction. No waiting cycle is introduced by the review-parent edge.
Insert also locks the booking NOWAIT and rejects late reviews for terminal
payments or non-open bookings. Canonical identity must match the payment's
business/booking/provider/reference/money. Identity cannot be reassigned: UPDATE compares the full canonical tuple to OLD,
not just the mutable parent. A privileged parent amount change therefore cannot
authorize rewriting the originally reviewed expected_amount.
Existing status and resolved_at semantics are unchanged; inbound external refund
reconciliation remains allowed and later review resolution remains possible.
Review deletion is forbidden, including cascading parent deletion: history must
not be erased to make a payment automatically eligible. No bulk backfill is
attempted. Existing malformed historical review identity would need separate,
explicitly reviewed remediation before updating that row. The two synthetic
fixture rows claiming stripe/pi_park_suite for park_suite payments were corrected,
not grandfathered by weakening the guard.

This is not a universal deadlock proof across arbitrary service-role SQL,
multiple-payment transactions, or other subsystems. Tests cover the bounded
payment/review/confirmation/refund writers in both competing orders. Database
superusers can disable triggers; they are not an adversary these guards contain.

## Reproduction and evidence

Baseline f4b21b5 handler run against updated actual-handler regression tests:
13 failed / 14 passed. Baseline 0094 failure function in a rollback-only transaction
returned IGNORED for a provider-processing payment without review. No provider
was called. The current focused suite has 104 tests (74 intent,27 webhook,3 outage).

Run local disposable evidence after provisioning local_harness.sql + checked-in
migrations (do NOT apply these source migrations to hosted infrastructure):

```
FLOW_TEST_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=<owned-port> PGUSER=postgres \
PGDATABASE=lumin_<fresh-disposable-db> \
node apps/api/src/provider-processing-authority.integration.mjs
```

The 40 PostgreSQL cases include processing success/failure; replay; expired,
released, missing holds; amount guards; every review status; terminal guards;
canonical review identity; service-only privilege; transaction/outbox/review
failure rollback; review insert/update vs success; park/failure/refund vs success
in both orders; inbound refund plus human resolution; parent-drift immutability; and
rollback-only payment/booking/tenant cascade-deletion rejection. Contender waiting is
observed through pg_stat_activity, not guessed from sleep alone. The integration
runner registers this harness on its own fresh DB, including in existing CI.
Initial candidate full API suite: 109 files, 2474 tests passed. Revision full-suite
reruns were incomplete due unexpected Vitest worker exits (2449 then2453 tests
passed, exit1); do not treat those reruns as PASS. API typecheck passed.
Existing payment_review_park_tests.sql and service_capacity_backstop_tests.sql
also pass. New tests use synthetic verified-event boundaries, not live signatures.

## Limits and release conditions

No durable webhook inbox or promise beyond finite provider retries. No automatic
refund primitive. External refund intent routing limitations remain unchanged.
Review-guard contention now returns a retryable database error to direct writers;
callers must retry rather than acknowledge an uncommitted review. SQL authority
must exist before deploying the new handler; mixed old/new application versions
are not claimed safe by this isolated evidence. Reserved migration candidates
and actual hosted attestation must be independently integrated and verified.

Review correction: the parent-drift regression reproduced the defect in
1541390 (missing expected rejection), then passed on the revised migration
applied with the entire checked-in chain to a fresh disposable database.
