# Dormant source-scoped refund associations

This adds evidence routing only. It does not calculate refund totals, choose an authoritative status, alter payments/bookings/capacity/refunds/outbox, resolve attention, issue refunds, change ACKs or activate ingress. Refunds remain owner-issued externally in Stripe.

## Immutable identity

Private `charge_anchors` bind one full historical source scope plus actual charge ID to a canonical scoped payment, attempt, currency and origin receipt. Multiple charge IDs may reference the same PaymentIntent. Charge amount/captured/cumulative-refunded snapshots remain separate immutable receipts; changing those observations does not rewrite the mapping or imply a PI total.

Private `refund_anchors` bind full source plus individual refund ID to the agreed charge/payment, immutable individual amount/currency and origin receipt. Status and event timestamps remain per-event observations, not a latest-wins decision. No charge cumulative total is added to individual refund amounts.

The service-only receipt-ID RPC derives every mapping from a stored non-conflicted v3 receipt, historical source, scoped payment and original attempt/request/intent/envelope lineage. No caller mapping IDs, metadata authority, current-connection lookup, source reassignment or legacy NULL-provenance adoption exists. Both refund pointers must be explicit and agree; missing pointers never get filled from an anchor.

For existing exact-source entities, a contradiction in known immutable facts still creates bounded diagnostic evidence even when another pointer is null. Matching known facts plus missing pointers remain unresolved without a false conflict. Null-first observations create no anchor; a later distinct complete event can bind. This does not infer missing provider facts or silently upgrade an old receipt.

## Conflict and lock contract

The normal path locks its own receipt, candidate payment, booking, charge anchor, then refund anchor. Unique insertion races reread the winning immutable row. It never chases another anchor's payment or locks a second/origin receipt. The null-pointer diagnostic path locks only its own receipt and relevant existing anchor, then returns without acquiring later financial locks.

Separate immutable conflict tables retain the first conflicting receipt and bounded reason/time. Conflicting observations return quarantine while preserving the original mapping. Every call checks origin-receipt conflict markers and entity conflict markers afresh after anchor acquisition; refunds also recheck charge provenance after acquiring their own anchor. Original bindings are historical facts, not permanently clean processing permissions.

A conflict committed after the final observation can make an anchor unusable on subsequent calls. This does not retroactively erase an already-committed association, guarantee instantaneous global visibility, or authorize financial processing. Future financial reconciliation must establish its own coherent provenance/processing boundary. No blanket deadlock-free claim is made for arbitrary caller transactions that acquire unrelated locks first. Non-READ-COMMITTED calls reject; lock/SQL errors propagate rather than pretending handled.

## Security and verification

All four ledgers are RLS-forced with no client or service table grants, immutable update/delete guards, and restrictive canonical references. Only the private service RPC is callable; no public wrapper or production caller is added. Hosted schema exposure remains an activation check, not something inferred from a schema name. Additive0137 retains prior bounded attestation and adds exact bodies, tables/defaults/constraints, immutable triggers and ACL checks including column grants.

Disposable PostgreSQL tests cover full-source identical IDs, multiple charges per PI, immutable first mappings/markers, status order, nullable contradictions, prospective origin conflicts, both-order concurrent same-entity insertion with distinct payments/charges and observed lock contention, no origin/payment lock chasing, fresh canonical revalidation after waiting, legacy nonadoption, rollback, ACLs and unchanged financial snapshots. An actual pre0136 upgrade proves receipts stay byte-equivalent and creates no inferred anchors or conflict backfill. These are source-level synthetic tests, not proof of live capture/refund, delivered notifications or production readiness.
