# Bounded PaymentIntent idempotency test model

Source-only test correction atop PR275. No migrations, runtime behavior changes,
provider calls, actual retry policy, deployment, API version selection or refunds.
The live adapter diff changes comments only.

Inspected all createFakeStripe consumers: stripePayment.test.ts,
stripePaymentConnection.test.ts, and core/paymentConsistency.test.ts. Only the
changed-amount replay assertion relied on the incorrect original-response claim.
The different-key test is retained as a duplication hazard, not permission for a
replacement operation. Connect account/link idempotency remains a separate,
simplified fake; this patch does not claim to model every Stripe POST endpoint.

PaymentIntent create now compares canonical form parameters, scopes cached results
by connected account and key, and stores original serialized responses rather than
references to mutable intent objects. Changed parameters produce idempotency_error.
An explicit millisecond clock allows the test model to prune at 24 hours; real
retention can be longer. Access/replay does not refresh the original timestamp.
The model demonstrates that an expired key can create a second intent, never that
reuse is safe. Test contexts represent one platform credential/mode; cross-platform
or credential/mode identity verification is outside this fake's scope.

armIntentExecutionError injects an endpoint-execution 500 which is cached and
replayed. Its lack of synthetic financial effects is not proof that a real 500 has
none. Existing armServerError remains an uncached pre-execution transport-facing
outage injection, not a claim about all server errors. Validation failure and
pre-execution 429 remain uncached. No blanket automatic retry is introduced.

Sources checked for design:
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/error-low-level

New regressions cover original response after later status changes, reordered
fields, changed money/currency/metadata, cached 500, validation/429, retention
boundary, expired cached errors and connected-account separation. All adapter
suites and core payment consistency: 10 files / 181 tests passed locally.
