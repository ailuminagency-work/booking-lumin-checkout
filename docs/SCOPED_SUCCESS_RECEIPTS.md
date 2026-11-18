# Dormant scoped succeeded receipt decisions

Historical 0126 slice: the late-success ignore and hold-only parking limitations below are explicitly superseded by 0128. See LATE_SUCCESS_RESOURCE_RELEASE.md for the current corrective authority.

This source-only slice adds a private, service-only receipt-ID boundary. It is not wired to ingress, does not authorize a webhook ACK, and makes no provider calls, refunds, retries, deployments or claims of signature verification inside SQL.

## Authority and lock order

The processor requires a v2 `payment_intent.succeeded` observation with explicit status `succeeded`, positive requested amount equal to received amount, and zero capturable amount. It locks the immutable receipt, freshly checks its sticky conflict marker, then acquires the existing SHARE fences on service_resources/refunds before payment and booking row locks. Full historical source, attempt/request/intent/envelope and canonical money/currency are resolved and revalidated under those locks, even for replay. Missing, conflicted or ineligible observations have no financial effects. Source authority remains a trusted ingress assertion; this is not deployment configuration proof.

The success, parking and confirmation implementations are moved mechanically from 0120 to owner-only SECURITY INVOKER cores. Only the legacy provenance guard is removed from these cores and their nested calls retargeted. Public legacy wrappers retain their original lock/not-found/guard prefix, then delegate. The existing failure and refund boundaries remain unchanged. No service/client/PUBLIC or other nonowner may execute a core; bounded attestation checks their ACLs and exact bodies.

## Preserved limitations

- If failure commits first, later valid success is ignored under the inherited state policy. This is explicitly tested, not claimed as complete uncertainty recovery.
- Parking releases the capacity hold only. Rental resource reservations retain their inherited status; this is tested and not silently fixed as a new financial/capacity policy.
- A conflict committed before processing prevents effects. A conflict arriving after processing commits is retained and blocks later attempts, but cannot retroactively undo a confirmation.
- Only the exact `40001` / `CONFIRMATION_HOLD_INVALID` exception enters the inherited parking path. The promotion, hold/resource consumption, booking confirmation and outbox insertion are inside the original subtransaction; unrelated failures propagate and roll back.
- Refund identity remains globally deduplicated; no scoped refund processing is activated. Older intent-only runtime callers are still a rollout/rollback blocker. This does not prohibit arbitrary privileged direct SQL.

## Evidence

The isolated PostgreSQL harness covers simple and rental confirmation/replay, all payment states, missing/expired/released holds, incomplete and overlapping resources, expiry during consumption and late outbox insertion, unrelated serialization errors, duplicate/rollback, both failure/success orders, both conflict orders, review contention, historical source/mode isolation, invalid observed facts and replay gates, identity drift after lock waits, private core ACLs and guarded public denial. The existing financial, receipt, failure, crash and mock suites remain required alongside actual catalog mutation/reader tests and fresh C/ICU migration replay.

No live capture, hosted availability, automatic recovery or production-readiness conclusion follows from synthetic local tests.
