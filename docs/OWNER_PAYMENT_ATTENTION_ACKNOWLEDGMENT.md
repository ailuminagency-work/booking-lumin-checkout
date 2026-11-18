# Owner acknowledgment of payment attention

This source-only change adds review accountability, not financial resolution. An active business owner can mark a historical attention observation as reviewed. Staff retain read-only history. Acknowledgment never reopens a booking, changes a payment/refund, reserves/releases capacity, dispatches an outbox item or sends a notification. The owner handles any refund separately in Stripe.

## Authority and concurrency

The verified bearer actor is supplied by the trusted backend, not the browser body. Both API and private SQL RPC reject zero or multiple memberships, including grandfathered historical ambiguity. The RPC independently matches the selected tenant, invokes the established active tenant/owner membership check with tenant-then-membership SHARE locks, rechecks sole membership, and verifies canonical tenant/booking/payment ownership of the attention receipt.

The READ COMMITTED transaction inserts one private acknowledgment per receipt with the authenticated actor UUID and server clock timestamp. Unique-key arbitration plus a fresh read returns the original timestamp on all authorized duplicate requests, including simultaneous owners. UPDATE and DELETE are rejected; service/client table reads and writes are denied. The actor UUID is immutable audit provenance, not a public profile field; it has no deletion cascade to user accounts. Existing attention remains unchanged.

If revocation owns the membership lock first, acknowledgment waits and denies. If acknowledgment has already acquired the authority locks, revocation waits until it commits; this does not promise cancellation of an already-authorized transaction. Later requests are denied. No arbitrary multi-operation transaction deadlock guarantee is claimed.

## Interface

`POST /api/payment-attention/{receiptId}/acknowledgment?tenantId=...` requires existing allowed-origin bearer authentication, JSON `{}`, no extra fields/query values, and the separate exact `BOOKING_LUMIN_PAYMENT_ATTENTION_ACKNOWLEDGMENT=1` flag. Visibility alone does not enable writes. The connected panel also requires exact `VITE_PAYMENT_ATTENTION_ACKNOWLEDGMENT=true`; both flags default off and no deployed setting is changed.

The list adds required nullable `reviewedAt` with full microsecond precision; original attention pagination and history remain intact. Staff may see the timestamp but not the actor UUID. Reviewed items and conflict warnings remain visible. The owner-only button says **Mark as reviewed**, not resolved/refunded. Failed or stale-session responses never optimistically mark reviewed. Strict old/new projections require a coordinated release behind disabled flags; missing fields fail closed rather than guess.

## Evidence scope

Actual disposable PostgreSQL/HTTP tests use the existing Supabase verifier with synthetic upstream identity transport, not live identity/provider proof. Tests cover owner/staff/tenant/identity/origin denial, malformed requests, both revocation orders, historical ambiguity, concurrent/idempotent first acknowledgment, rollback, immutable ledger and ACL denial, default-off behavior, and unchanged booking/payment/hold/resource/refund/review/outbox snapshots. Additive0133 retains prior bounded attestation and adds function bodies/authority, private ledger schema/defaults/constraints/ACLs and immutable trigger checks. It does not attest the full historical chain or authorize runtime activation.
