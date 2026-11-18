# Corrective late-success attention and live resource release

Source only: no ingress, provider calls, refund initiation, automatic replacement charge, ACK behavior or deployment is activated.

After the existing receipt lock, sticky conflict check, v2 status/money gate and full-source payment/booking revalidation, a failed payment with a failed booking records one immutable `late_success_after_failure` attention row per receipt. Duplicates preserve the first record; payment, booking, holds, refunds and outbox remain unchanged. A failed payment with another booking state returns `failed_payment_state_mismatch` quarantine, not ordinary ignored. Wrong source/money creates no attention.

The private service-only reader takes a trusted backend's authenticated tenant and receipt ID. It returns only receipt/booking ID, reason, time and conflict flag, and treats missing/foreign identically. No capability, idempotency key, client secret or raw event is returned. No owner UI/notification is wired. Historical attention is not confirmation or permission to retry/refund. SQL ingress remains a trusted assertion, not signature proof.

Actual FAILED/PARKED transitions now call guarded `release_resource_holds` atomically: only this booking's held rows release, never consumed or another booking's rows. Expired held rows already stop consuming capacity under existing clock-based accounting. The fixed gap is live held siblings retaining capacity until TTL. Rollback restores the transition and reservations.

Canonical `reserve_resource_quantity` and legacy wrappers take booking SHARE NOWAIT after existing group guard/input validation, before resource locks. A fresh state/review check admits new/reactivated/live HELD only for draft/pending bookings with no authoritative review. Exact historical consumed replay remains nonmutating across terminal states. Reserve-first holds the booking lock until commit, then financial transition releases its rows. Transition-first fails admission retryably while locked and rejects after commit. No payment lock is added. Exact predecessor fingerprinting preserves injected 0025 group guard and vetted 0026 pgcrypto binding.

This closes supported nonplanning reservation RPC paths, not arbitrary privileged SQL or all caller transactions that prelock multiple bookings/resources. Group allocations retain their existing rejection guard. Earlier 0126 test limitations on ignored late success and hold-only parking are superseded only by these explicit corrections; no broader financial policy changes.

Verification includes fresh C/ICU chains, extensions-schema crypto preservation, catalog/readiness negatives, attention isolation/immutability/concurrent replay, release before TTL, rollback, both reservation/financial orders, prestarted statement snapshots, confirmation races and consumed replay, plus existing financial/receipt/crash/mock regressions. Synthetic tests are not live capture or deployment evidence.
