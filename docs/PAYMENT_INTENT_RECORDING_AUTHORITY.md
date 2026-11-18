# Payment-intent recording authority

This bounded fix prevents create-intent retries from overwriting a payment row
that a webhook, refund reconciliation, or human-review path has advanced.
Recording uses the existing `(provider, provider_intent_id)` unique anchor with
`ignoreDuplicates: true` (insert-on-conflict-do-nothing), then validates the stored
tenant, booking, provider/intent, amount and currency before returning a client
capability. Resolved/parked states are not reopened.

Provider transport errors and local persistence errors are uncertain outcomes,
not evidence that an earlier usable intent does not exist. This handler therefore
no longer releases a capacity hold on those errors. The existing bounded hold TTL
and booking/cancellation policies remain unchanged. No refund action is added.
Business owners handle refunds outside Booking Lumin in Stripe; inbound refund
reconciliation remains separately authoritative.

Verification: 16 actual-handler tests with mocked provider/DB boundaries pass.
Replacing the handler with baseline6206276 fails15 of16 tests. API typecheck passes.
These mocks exercise delayed-create/advanced-state interleavings but are not a
PostgREST/PostgreSQL concurrency test or proof of a real captured-payment recovery.
Exact-head Edge typecheck and full CI remain required before acceptance.

Remaining gaps: events for genuinely missing payment rows need separate durable
retry/reconciliation policy; this patch does not add an outbox/inbox. It does not
prevent provider idempotency-retention expiry or certify checkout after every
cancellation/hold-expiry race. A state can advance after the validating read; this
patch prevents writes from regressing it, not a serializable client-token lease.
