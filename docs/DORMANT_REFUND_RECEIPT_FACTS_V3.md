# Dormant external-refund receipt facts v3

This is facts-only quarantine storage and a pure internal projection. Booking Lumin still never initiates a refund; the business owner handles refunds externally in Stripe. No webhook route, ACK policy, provider call, scoped refund processor, accounting migration or financial state transition is enabled here.

## Closed observations

All shapes retain the existing immutable identity: provider + trusted ingress platform + signed event account + signed event mode + event ID. Parser/schema version is not a deduplication key. Original receipt rows and conflict serialization remain immutable; any changed fact, shape or version for the same identity records sticky conflict and preserves the first observation. Distinct event IDs remain independent observations even when their refund ID is identical or timestamps arrive out of order. No latest-status or total calculation is performed.

The explicit v3 union contains 13 common fields and:

- `charge.refunded`: 19 total fields, actual charge ID, nullable explicit PaymentIntent pointer, charge amount, captured boolean, amount captured, cumulative amount refunded, and refunded boolean.
- `refund.created`, `refund.updated`, `refund.failed`: 17 total fields, individual refund ID/amount, explicitly nullable status, and explicitly nullable charge/PaymentIntent pointers.

Charge and refund money never enters `intent_amount`. V3 PI amount/status/received/capturable columns are NULL. Existing PI v1/v2 observations keep their original fields and constraints; upgrading adds only NULL refund fields, no enrichment or inferred association.

Stripe documents nullable Refund status with known values pending, requires_action, succeeded, failed and canceled. Event names do not imply status. Charge captured amount and cumulative refunded amount are separate from requested charge amount and their booleans; this slice does not impose accounting relationships or declare a refund completed. [Refund object](https://docs.stripe.com/api/refunds/object), [Charge object](https://docs.stripe.com/api/charges/object).

Pointers support explicit string or null only. Expanded objects, missing fields and wrong identifier types are deliberately rejected, not guessed. Charge object mode must match event mode. Refund has no required documented object mode; the signed event mode is retained, with any optional object mode required to match exactly. This supported subset can quarantine/reject otherwise legitimate expanded event representations until separately reviewed support exists.

No raw payload, signature, client token, arbitrary metadata, description, failure text, customer details or refund-list entries are stored. No synthetic refund ID, last-list-entry fallback, status inference, charge-to-PI total summing, or current-connection reattribution is used.

## Verification boundary

`normalizeStripeRefundReceiptCandidateV3` is a detached frozen shape projection, not signature proof. Existing Node and Deno verifiers authenticate synthetic exact raw payloads before projection in tests; the function never consumes their generic normalized kind or fallback intent reference. SQL accepts a trusted backend assertion, not independent signature verification.

Tests cover strict nullable field presence and bounds, malformed shapes, actual HMAC composition, old PI replay/upgrade, duplicate/concurrent/conflicting observations, out-of-order statuses, full source separation, rollback, ACL/immutability, and unchanged linked payment/booking/hold/resource/refund/review/outbox rows. Existing success/failure processors reject the new event types and the PI resolver cannot treat NULL intent money as a matching payment observation.

Additive0135 retains prior attestation and fingerprints the changed typed receipt schema, recorder and permissions. This is bounded catalog evidence, not a hosted rollout or complete historical-chain proof. Global legacy refund-ID accounting and runtime source-aware reconciliation remain separate activation blockers. No operational refund outcome or owner notification is claimed.
