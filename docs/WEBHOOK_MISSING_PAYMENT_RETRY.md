# Missing payment webhook retry boundary

Verified supported financial events (`payment_succeeded`, `payment_failed`,
`refund_completed`) with a successful but empty payment lookup now return generic
HTTP503. A payment row may arrive after the event because intent persistence and
provider delivery are independent. The handler does not fabricate payment, tenant,
booking or pricing authority from event metadata. Lookup failures remain HTTP500.
Unrecognized verified events are acknowledged HTTP200 before database access.

This is finite provider-managed retry, not a durable inbox, dead-letter queue, or
reconciliation guarantee beyond the provider retry window. Truly unrelated
financial intents may retry because the handler lacks proven routing provenance.
No provider retry duration or delivery guarantee is assumed by this change.

The existing parser is unchanged: refund events prefer their linked PaymentIntent
but can fall back to Charge (`ch_`) or Refund (`re_`) object IDs. Such fallback IDs
may not match payments.provider_intent_id and can remain retryable without resolving.
Canonical provider lookup or durable quarantine requires a separate reviewed design.
Supported events without any intent ID retain existing acknowledgement behavior.

No refunds are initiated. Refund events reconcile actions the business owner made
outside Booking Lumin in Stripe. This patch changes neither account/business
membership nor tenant authority.

Tests import the real handler while replacing signature parsing and DB/provider
boundaries. They cover all three missing-row kinds, later-row delivery, irrelevant
kind short-circuit, DB lookup errors, parked-state preservation, and bad signatures.
They are not live-signature/provider, database-concurrency or production recovery
certification. Independent review and exact-head CI are still required.
