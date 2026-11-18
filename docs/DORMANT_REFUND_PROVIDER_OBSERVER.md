# Dormant, injected-transport refund observation

This internal module has no barrel export, runtime caller, default network implementation, persistence or money-moving operation. All acceptance tests inject synthetic responses and synthetic credentials. No Stripe request is made by this work.

## Contract and source boundary

The factory copies explicit secret key, platform account, connected account, mode and API version primitives. Unknown configuration fields are rejected. There is no default/latest API version; syntax validation is not compatibility approval. Observation input contains only expected charge and PaymentIntent IDs supplied by a future trusted canonical binding. Caller URLs, extra headers, metadata and credential overrides are not accepted.

Requests are fixed GETs to `https://api.stripe.com/v1/charges/{id}` and `https://api.stripe.com/v1/refunds` with only charge, limit=100 and the last returned refund ID as starting_after. Each request pins Authorization, Stripe-Account and Stripe-Version, requests redirect:error and carries the same abort signal. Final URL and redirect status are independently checked. The adapter never follows a response URL, Location header, expanded pointer or embedded charge refunds list.

Platform/account ownership cannot be proven from these object responses. They are configured request-scope assertions; every outcome has `sourceIdentityVerified: false`. Charge mode must match. Refund mode is optional but must match if present. Explicit null pointers/status are retained as unresolved; non-null pointers must agree with expected charge/PI and currency. Expanded pointers are deliberately outside this supported subset. No metadata or raw error/PII fields are retained.

## Observation, not financial authority

Sequence: charge-before, full bounded refund traversal A, full bounded traversal B, charge-after. Compare closed charge facts and refund facts sorted by refund identity, not event time or provider list order. Detect changed populations/statuses and duplicate IDs; never choose a latest status or sum individual refunds into charge cumulative amounts.

`traversalComplete: true` means only each observed traversal ended with has_more=false within its budgets. Even identical observations are not an atomic snapshot or proof of completeness/current state. Every result retains `atomicSnapshot: false`, `coverageComplete: false`, and `accountingAuthorized: false`. `observed_stable` and `unresolved` contain only frozen detached projected facts. Failure is a closed `verification_required` reason code, never raw exceptions or provider bodies. This module performs no retry, refund issuance, accounting, ACK change or attention resolution.

## Bounds and transport obligation

Hard shared attempt bounds: 40 list pages, 2000 list items across BOTH traversals, 8 MiB response bytes total, 8192 streamed chunks, and a 10-second deadline. Each response is capped at 1 MiB. Bytes are counted before copying/concatenation; decoding is fatal UTF-8. Empty has_more pages, duplicates, malformed or oversized list pages fail closed. No partial projected collection is returned after a failure.

Deadline races bound waiting on a noncooperative async transport/iterator; abort is signaled and iterator.return requested on rejected bodies. The module cannot forcibly stop arbitrary injected code or preempt synchronous JavaScript. Any future real transport must enforce no redirects and bounded streaming at its own I/O boundary, honor abort, and prevent credential leakage. This candidate supplies no such production transport and does not authorize one.

## Primary references

- [Stripe refund list](https://docs.stripe.com/api/refunds/list): charge filter, limit 1–100 and starting_after pagination; embedded charge refund lists are insufficient.
- [Retrieve charge](https://docs.stripe.com/api/charges/retrieve): fixed charge resource and nullable PaymentIntent pointer.
- [Connected accounts](https://docs.stripe.com/api/connected-accounts): per-request Stripe-Account scope.

Real API compatibility, credential/platform ownership verification, trusted source binding, reconciliation completeness, deployment and source-aware financial application remain separate gates.
