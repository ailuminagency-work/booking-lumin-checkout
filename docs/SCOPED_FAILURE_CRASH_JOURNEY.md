# Test-only raw-byte failure processing crash journey

Based on reviewedfef6478. New isolated loopback child/harness only; no migration,
production adapter/handler, schema exposure, provider call, dispatch, ACK policy or
outcome ledger changes. CI runs this as a separate disposable integration database.

The child copies and freezes its trusted synthetic endpoint configuration at
construction: secret, platform, account and mode. The verifier gets an owned frozen
options object with its own frozen source. The original supplied object is then
deliberately mutated. The adapter itself still reads opts.webhookSecret on each
parse; this test does NOT claim the adapter independently snapshots mutable options.
HTTP query, headers and metadata cannot override the owned configuration.

The endpoint bounds payload bytes to64KiB, fatal-decodes UTF8 without discarding a
BOM, and passes the exact resulting raw string to the existing verifier before
normalization. It commits the quarantined receipt first, then starts a separate
failure-processing transaction. Even successful committed effects return503 only.
Invalid signature, stale timestamp, wrong secret/account/mode, whitespace/BOM
tampering, malformed shape/UTF8, excessive body and configuration-override attempts
are rejected without receipt or financial changes. Valid Unicode and misleading
metadata do not change source identity or leak payload/client-token fields.

## Real process barriers

The parent observes the owned child at three deterministic IPC barriers:

- After receipt commit: receipt is visible, financial state unchanged.
- After processing effects but before processing commit: receipt is visible;
  uncommitted effects are invisible to the independent reader.
- After processing commit before HTTP response: receipt and failure effects persist.

It kills the actual child process, waits for process exit and disappearance of that
database backend, checks the pending request disconnected, starts a new child and
redelivers the same signed event. The receipt survives every phase. Interrupted
processing rolls back; committed processing replays as ignored. Full financial
snapshots prove no duplicate transition, hold release, refund, review or outbox
effects. This is process-crash evidence, not PostgreSQL failover or hardware-durability
proof.

A real processing SQL error also preserves the committed receipt with no effects.
A conflicting delivery committed during the receipt/processing gap prevents later
processing. Eight concurrent duplicates yield one failure transition. Identical
event/intent IDs across fixed platform/account/mode profiles affect only the exact
source's payment; all other payment/booking/hold snapshots stay unchanged. Receipts
remain quarantined throughout. The existing late-conflict-after-commit limitation
is unchanged; there is no retroactive rollback promise.

## Evidence

The exact journey passed in separate fresh clones of the reviewed0123 PostgreSQL16
C and en-US ICU templates. All provider/signing configuration is synthetic and
provider network calls throw. No hosted ingress or live provider was exercised.
Original workers and production code were not modified.
