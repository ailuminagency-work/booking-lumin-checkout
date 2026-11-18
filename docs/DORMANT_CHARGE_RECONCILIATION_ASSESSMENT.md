# Dormant charge reconciliation assessment

This candidate adds only a private service-only `assess_charge_reconciliation(chargeAnchorId)` reader. It is STABLE, uses one calling-statement MVCC snapshot, and performs no writes, row locks, provider requests, accounting, refund issuance, booking transition, attention resolution or ACK change. There is no runtime caller or public wrapper. Hosted schema exposure and trusted backend integration remain separate activation gates.

## Interpretation

Every result has `coverageComplete: false` and `accountingAuthorized: false`. `observed_consistent` means only the selected stored observations agree, not that the provider is current, all events arrived, money moved or a refund is complete. The reader never orders by event creation time, picks a latest status, selects a maximum cumulative amount or adds charge cumulative amounts to individual refunds.

- `authority_conflict`: canonical lineage, immutable identity/money, or receipt/association conflict prevents using the observation.
- `status_needs_verification`: null, non-succeeded, or evolving individual status observations need verification. Pending then succeeded is not immutable identity corruption; no status winner is chosen.
- `coverage_unknown`: incomplete pointers/anchors, differing charge observations, unequal observation amounts, missing evidence, or bounded-evidence/amount overflow.
- `observed_consistent`: charge observations agree on their independent fields, every relevant refund is anchored with exact pointers and only succeeded status observations, and the once-per-source/refund-identity amount equals the single observed charge cumulative value. Zero individual refunds and explicit zero cumulative can agree.

Only the last classification returns `individualObservedAmount` and `chargeCumulativeObservedAmounts`; these remain separate observation categories. All other results suppress both outputs (null and empty array). A cumulative 100 and individual 30+70 yields 100 alongside [100], never 200.

## Scope and bounds

The reader revalidates historical full source, payment, attempt, request, intent association, envelope existence, booking identity, anchor origin and sticky conflicts in one snapshot. It does not consult the current connection or infer tenant/source from metadata. Later committed conflicts affect later snapshots, not an already running read.

Relevant refund evidence is exact full-source and explicit matching charge, an existing refund identity anchored to the selected charge, or a missing charge pointer with a matching PI. The last case is uncertainty, never permission to attribute its amount. Known different charge with the same PI belongs to that other charge. A null-charge observation already anchored elsewhere creates only coverage uncertainty here, not a status verdict about this charge. Conflicting amounts for an unanchored refund remain coverage unknown rather than a definitive authority classification; they can never become observed consistent. Both-null unanchored observations cannot safely be attributed and are not scanned as charge evidence. This blind spot is one reason completeness is always false.

Materialized evidence is limited to 256 charge receipts, 256 refund anchors and 256 relevant refund receipts. A 257th item fails closed before any output sum. This is a bound on returned/materialized evidence, not a guarantee of bounded physical scan cost. Numeric accumulation is exact PostgreSQL numeric with an output ceiling of 9007199254740991; overflow returns no partial total.

All prior immutable ledgers, source boundaries and financial RPC guards remain. No global refund accounting constraint is removed. No operational alert, provider reconciliation coverage or production readiness is implied.
