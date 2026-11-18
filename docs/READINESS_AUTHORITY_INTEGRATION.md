# Readiness authority integration checkpoint: NOT deployable

Fresh isolated branch/worktree: test/readiness-authority-integration-20261118.
No dirty/native worktree changed. No provider calls, deploy, activation or push.

Verified remote inputs: PR261 d04c7a2; PR262 8226ec4 (includes261);
PR267 b2b4f3c; PR268 f4b21b5; PR269 b42eacc; PR270 08c3486;
PR271 be4add3 (includes267/268/269). Started at271, cherry-picked270's three
unique commits; incorporated262's cumulative delta versus staging6206276 using
normalized-line-ending three-way comparison. CI retains BOTH source-binding
isolated/safety jobs and attestation/hardening checks. Readiness retains stronger
authenticated sentinel checks plus source-derived healthy fixtures and distinct
drift fixtures. No SQL rejection guard weakened.

## Local evidence
Fresh owned PostgreSQL18.6 on loopback55436; full chain through0102. Distinct
cloned databases for payment authority, owner reader and source concurrency.
-156 focused API and33 direct-source adapter tests passed; API typecheck passed.
-40 actual PG authority cases; owner review reader; source-binding SQL passed.
-8-way same-source and8-way mixed-mode source concurrency passed.
- Source harness safety tests and offline readiness self-test passed.
- Attestation, hardening, review-park and capacity-backstop SQL suites passed.
Full Windows suite intentionally not repeated after native fail-fast crashes.
Combined CI and local Deno not run. No hosted evidence claimed.

## Verified integration blocker
0099/0100 included unchanged.0100 pins sentinel/check and reader to0100, while
source head is0102.0101/0102 do not advance witness. The actual reader on the
fully migrated local DB returns0100/core_schema_contract. Passing that actual
result through readiness using synthetic HTTP transport and source metadata0102
reproduces `FAIL migration attestation: MIGRATION_ATTESTATION_DRIFT`.
The legacy SQL attestation suite proves its0100 contract only; healthy self-test
fixtures do not prove actual DB attestation. Proposed separate additive migration
must validate newer authority objects, advance witness, and update reader/negative
tests. Do not edit old applied migrations or weaken head equality to hide drift.

## Additive0103 follow-up (supersedes blocker above, source-only)

0103_payment_readiness_attestation validates the bounded0101/0102 contract and
advances the witness in one transaction, requiring the prior0100 witness. It does
not edit prior migrations. The reader requires0103 AND rechecks the live contract
on each call, so a current-looking row alone is insufficient.

The contract fingerprints the seven reviewed function bodies (CRLF normalized;
independently matched to0101/0102 source), return/signature/security/language/
volatility/default/search-path/execute boundaries, source/review table columns and
constraints, enabled correctly bound trigger events, RLS/FORCE/policy absence and
role privileges. Fingerprints intentionally fail closed on definition drift; they
are equality checks, not malicious-superuser tamper resistance. NOT NULL catalog
constraints introduced inPG18 are excluded from constraint hashes because column
attnotnull is checked separately. SQL catalog rendering is version-sensitive:
localPG18 passes; CI PostgreSQL16 still requires verification. This is a bounded
live contract, not every historical migration or real payment-provider evidence.

Verified: fresh full chain0103;21 rollback-only catalog corruptions rejected by
actual reader AND original migration guard;3 actual missing/stale/forged witness
rejections; healthy actual DB reader through synthetic readiness HTTP transport;
complete0103 applied against disabled review guard aborts and leaves0100 witness
with no new helper (atomic rollback).40 payment-authority cases and all named SQL
suites passed.156 focused API tests, typecheck and offline readiness self-test
passed. The registered integration harness receives its own fresh CI database.
An ad hoc owner-reader run initially reused the40-case populated DB and failed
its global count24 vs3; rerunning on its own freshly migrated0103 database passed,
without weakening assertions. No full Windows suite retry, deployment or activation.
