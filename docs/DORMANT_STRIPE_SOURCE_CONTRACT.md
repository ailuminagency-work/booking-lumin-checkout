# Dormant Stripe direct-charge source contract

Opt-in adapter-only prerequisite. Neither Edge handler nor application wiring enables
`directChargeSource` in this change. Omitting it preserves legacy behavior; no connection,
provider credential, financial route or database migration is activated.

Trusted server construction may pass `{accountId, livemode}`. The adapter copies/freezes
this object, validates account header syntax, pins Stripe-Account after extra headers,
and validates returned PaymentIntent.livemode on create/read. Its specialized returned
reference includes the pinned source only after mode validation. This is a routing
context, not a new database authority. Incoming signed events must match source account
and mode when the adapter was constructed in this opt-in mode.

Customer metadata never chooses routing. Mutation/replacement of the options object
cannot redirect subsequent reads or retries from the same adapter instance. Each request
keeps the caller's stable idempotency key. No destination charge, transfer, application
fee or refund endpoint is added.

## Boundaries not solved

- Durable booking/attempt-to-source binding across processes, account reconnects or new
  adapter instances. Different factory construction can select another source; the future
  attempt-recording authority must reject that drift before contacting Stripe.
- Legacy source backfill, payment-row account/mode provenance, inbox/worker activation.
- Provider setup and charge-model approval. An expected mode check verifies a response;
  it does not make a wrongly configured live key safe before a create request occurs.
- Provider response ownership is scoped by the pinned request account, not independently
  proven by PaymentIntent body (which does not include a connected-account field).
- Node cancellation uses the same pinned account; it is not enabled by any new route.
  Existing cancel capability is unchanged; no refund capability exists.

## Offline verification

`npm run test --workspace=@lumin/adapters` executes both Node adapter and Deno mirror
through injected fetch stubs. New tests cover source drift, header injection through
metadata, mode absence/mismatch, malformed source, signed webhook scope and unchanged
legacy callers. These are offline boundary tests, not Stripe sandbox certification.
Deno runtime typecheck remains an exact-head CI gate; no local Deno executable available.
