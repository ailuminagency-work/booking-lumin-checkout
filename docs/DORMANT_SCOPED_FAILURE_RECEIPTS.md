# Dormant scoped failure/cancellation receipt boundary

Source-only successor toe0c81e6. No deployed ingress, public wrapper, provider
calls, automatic refund, success processing or webhook ACK change. Hosted schema
exposure and trusted source configuration remain separate activation gates.

0122 factors the unchanged0101 failure body into the owner-only private
apply_payment_failure(uuid) core. It is SECURITY INVOKER with no PUBLIC, client or
service-role EXECUTE. Definer entry points execute it as their migration owner;
this is not a GUC, boolean flag or caller-asserted verification bypass. Public
fail_payment_webhook retains its locked-payment/notfound and0120 scoped denial
before delegating. The other four legacy financial RPC denials remain untouched.

The new private service-only process_scoped_failure_receipt accepts only a receipt
ID. At READ COMMITTED it locks that receipt, then freshly reads its sticky conflict
marker. Only payment_intent.payment_failed or payment_intent.canceled is eligible.
It derives a preliminary full-source/canonical match through the existing resolver,
locks the derived payment then booking, and revalidates original source, attempt,
request, envelope, money and mutable booking/payment identity under those locks.
Only then may the private core apply existing failure effects. No metadata,
caller-selected payment/source, current connection or intent-only fallback routes it.

The receipt recorder now explicitly locks the receipt before comparing facts or
adding a conflict marker. A conflict that wins this lock prevents processing. A
processor that commits first may already have applied failure before a subsequent
conflict is observed. That later conflict is retained and blocks future decisions,
but **cannot retroactively undo the committed failure**. This limitation is tested,
not hidden behind a claim of globally final conflict detection. Supported paths
use receipt -> payment -> booking ordering; there is no universal guarantee for
arbitrary privileged transactions that combine unrelated lock orders.

Receipts remain immutable and quarantined. Return values failure_applied and
failure_ignored describe this local decision, not permission to ACK a webhook.
Duplicate processing uses existing failed/terminal/review authority for idempotence;
there is no new durable processing ledger or replacement/retry policy. Success
receipts stay quarantined. Refunds are not supported by the receipt shape. Original
refund-source/dedupe activation blockers remain.

## Trust and permissions

SQL receipt ingestion is a trusted server assertion, NOT signature verification.
A service connection can supply facts; this RPC does not prove their provenance.
The isolated composition test uses the real existing synthetic HMAC verifier,
normalizer, private recorder and processor in one transaction. Tampered signatures,
wrong signed account/mode and signed malformed input cause zero receipt/financial
writes. This demonstrates that composition, not the safety of a future production
ingress, secret/configuration management or exposed-schema setup.

0123 retains0121 checks, updates changed bodies and attests the private core as
invoker/noncallable by runtime roles. It additionally rejects every nonowner core
ACL grant, including an otherwise unknown role. Private schema CREATE remains
denied. Trusted database administrators remain outside this owner-only ACL boundary.

## Verification

Fresh PostgreSQL16 C/en-US ICU full chains and standalone SQL.28 new processor
checks cover both supported types across all six payment states, stale failures,
human review, source/account/mode isolation, missing/money/conflict zero effects,
rollback, duplicates, both conflict race orders, mutable-identity revalidation,
ACLs/isolation and synthetic signature composition. Original80 receipt checks and
actual crash/restart journey pass after the recorder lock change. Separate clones
retain47 denial,18 identity,44 legacy webhook,35 provenance,30 recording,40 processing
and mock integration checks.176 catalog mutations plus witness/predecessor cases,
123 handler/recording/attestation tests and API typecheck pass.

These are local synthetic tests, not real capture, refund, deployment or production
readiness evidence. Privileged direct SQL and other booking RPCs are not universally
restricted by this bounded change.
