# Scoped success crash composition (test only)

`apps/api/src/scoped-success-crash.integration.mjs` runs only on an explicitly disposable loopback PostgreSQL database. CI clones the fully migrated template for this harness. It forks a synthetic HTTP child, never a production ingress endpoint.

The child copies and freezes its endpoint configuration, verifies exact UTF-8 payload bytes with the existing Stripe verifier, projects explicit v2 success facts, commits the private quarantined receipt, then processes it in a separate transaction. Failure fixtures retain the existing v1 projection. All completed processing responses remain retryable 503. No outbox dispatcher, provider network, external refund, ACK200 policy, runtime caller, hosted configuration, or migration is added.

## Evidence

- Actual child-process termination and observed PostgreSQL backend disappearance after receipt commit, after financial effects but before processing commit, and after processing commit before response. Each boundary is exercised for simple and resource-linked rental bookings. A processing barrier reports the completed decision, not merely entry into the transaction.
- Before-commit effects are invisible externally and roll back on termination. After-commit confirmation, consumed capacity/resources and exactly one durable outbox row survive. Restarted identical redelivery preserves the exact committed snapshot and returns replay, rather than duplicate confirmation/outbox effects.
- Ordinary holds have 60-minute TTLs. Expiry is forced explicitly in a separate scenario. An expired required resource causes parking, releases its still-live sibling resource, creates no confirmation/outbox/refund, and permits a competing booking before that sibling's TTL. The parked booking cannot reacquire capacity.
- Eight concurrent signed duplicates confirm once. Full platform/account/mode identities isolate identical event and intent strings. A conflicting observation committed during the receipt/processing gap remains sticky and prevents success effects.
- A distinct failure event followed by a succeeded event for the same intent persists late-success attention without reopening the failed booking or reacquiring resources. An actual crash after the attention commit and restarted replay leave one attention row. The real owner HTTP reader then exposes the safe history projection and denies cross-tenant/stranger access. Identity transport is synthetic, not live JWT/provider evidence.
- Invalid signatures, stale signatures, exact-byte tampering, malformed UTF-8, wrong source/mode, oversized input and request-supplied configuration overrides do not produce financial or receipt effects. Processing SQL failure preserves the receipt and rolls back effects.

Rental fixtures include a supplemental simple capacity hold to assert it is not incorrectly consumed by the rental path; resource reservations are the rental capacity authority. Parking/failure release that supplemental hold. Synthetic event API version is a fixture, not approval of a deployment version.

## Limits

This proves local PostgreSQL transaction/process-boundary behavior, not database-server/power-loss durability, live Stripe capture, production ingress authentication/configuration, successful notification delivery, or production readiness. Receipts remain quarantined. A conflict arriving after completed processing cannot undo a prior commit. Owner history is not an unresolved-balance assertion; authorization uses the existing bounded transaction snapshot, not instantaneous cancellation of an already-authorized read.
