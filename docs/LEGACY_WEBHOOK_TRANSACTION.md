# Legacy-only webhook transaction boundary

Source candidate based on61adb1b. No hosted deployment, source-aware activation,
index cutover, provider calls or refund initiation. This removes the Edge handler's
bare-intent payment read followed by a separate UUID mutation. It is an isolation
repair, not proof that legacy payments have authenticated original source.

0116 adds public.process_legacy_payment_webhook, service execution only. The
handler verifies the original signature first and ignores unrecognized deliveries
without DB access. A financial event without an intent returns retryable503.
Supported events make one RPC with kind, original normalized intent, observed
amount and refund id/shape. There is no public raw event, metadata or source input.

For success the wrapper takes SHARE locks on service_resources and refunds before
payment FOR UPDATE. Refund takes ROW EXCLUSIVE on those same tables before the
payment. Failure follows existing payment-first ordering. Do not replace this
with a common payment prelock, or a SHARE-to-ROW EXCLUSIVE upgrade for refunds:
both can introduce inversion against existing financial authorities. Nested
0101/0098 locks are reentrant. Eligibility requires fixed stripe_connect and BOTH
provenance fields NULL under the same transaction as the financial operation.
Missing/scoped/ambiguous identity returns bounded UNAVAILABLE, mapped to503;
SQL/transport errors map to generic500. Global uniqueness remains required and
attested; STRICT selection additionally refuses ambiguity in a corrupted schema.

Existing success/failure/park/refund financial RPC bodies are unchanged. Advanced
and reviewed states, hold failure parking, replay and stale failure handling are
preserved. Refund parsing reuses interpretRefundEvent(raw,0) only to extract
refundId/refundedTotal/isCumulative. Zero is an unused full-flag sentinel; that
helper's isFullyRefunded is NEVER sent to SQL. The wrapper derives the comparison
against the locked server payment amount. Missing/zero/negative refund amounts
retain existing nonmutating responses. Cumulative amounts, individual deltas,
provider refund ID dedupe and existing synthetic dedupe fallback are unchanged.
No refund is initiated.

## Boundaries that remain

Legacy NULL provenance is not trusted platform/account/mode evidence. Signature
verification alone does not establish original-source identity. The parser's
existing refund linked-intent/object-ID fallback is unchanged, not endorsed as
source authority. Finite provider-managed redelivery is still not durable inbox
processing or an unlimited recovery guarantee.

Old UUID financial RPCs and service privileges remain callable. Old Edge lookup
callers must be retired before scoped activation; mixed-version deployment is NOT
declared safe by this patch. The new handler needs0116 deployed first, otherwise
it fails closed500. No deployment occurred here. Source-aware financial decisions,
atomic receipt conflict eligibility, global uniqueness cutover and rollback-floor
decisions are separate work. The dormant receipt resolver still grants no ACK or
processing permission.

0117 preserves0115 contracts, adds exact wrapper and0098 refund-dependency body,
security/search-path/execute checks and advances the witness only after validation.
It is bounded catalog attestation, not live provider or deployment verification.

## Verification

Disposable PostgreSQL16 C and en-US ICU full chains and standalone attestation SQL;
44 new transaction checks cover supported states, park/hold behavior, refund
accounting and no-op parity, missing/redelivery, scoped/ambiguous refusal, caller
rollback, permissions, real reversed-order table/row barriers against success,
failure, refund, legacy/scoped writers and old UUID financial callers. Separate
clones run prior35 provenance,30 recording,40 processing and mock integration;
134 catalog negatives plus four witness/predecessor cases exercise the real reader.
123 handler/recording/attestation tests, API typecheck and actual Deno handler check.
All financial data is synthetic. No real capture, refund or network outage proof.
