# Evidence Ledger

Statuses: PROPOSED → READY → IN PROGRESS → IMPLEMENTED → UNIT TESTED →
INTEGRATION TESTED → SECURITY TESTED → ADVERSARIAL TESTED → RELEASED → PRODUCTION VERIFIED.
"DONE" is not a status.

| Work ID | Workstream | Builder | Scope | Status | Evidence |
|---------|-----------|---------|-------|--------|----------|
| W-001 | Program | governor | Monorepo bootstrap, toolchain | IMPLEMENTED | `npm install` clean; workspaces linked. |
| W-002 | Architecture | governor | Contracts v1 (10 contracts) | UNIT TESTED | `tsc --noEmit` green; consumed by all builders. |
| W-003 | Control plane | governor | Governance docs + ledgers | IMPLEMENTED | This directory. |
| W-004 | WS6/WS7 | core-builder | Pricing/availability/booking engines | ADVERSARIAL TESTED | 47 tests; D1/D2/D3/D5 found in review, all fixed + re-tested. |
| W-005 | WS4/WS5 | db-builder | Tenant schema + RLS + attack SQL | ADVERSARIAL TESTED | 8 migrations apply clean; S1/S2 found in review, fixed; attack suite 25/25 on real PG16. |
| W-006 | WS8 | core-builder | Mock adapters | ADVERSARIAL TESTED | 11 tests; D4 (forgeable webhook sig) fixed → keyed HMAC + replay guard, RFC-4231 verified. |
| W-007 | WS9 | checkout-builder | Customer checkout app | ADVERSARIAL TESTED | 12 tests; D1 app-glue confirm-on-error path removed; browser build green. |
| W-008 | WS10 | portal-builder | Business portal | UNIT TESTED | 16 tests; two-tenant isolation asserted; no defects found in review. |
| W-009 | WS11 | cc-builder | Command center | UNIT TESTED | 21 tests; GMV/revenue separation + no-PII asserted; no defects found. |
| W-010 | WS12 | reviewers | Adversarial pass + generalization proofs | INTEGRATION TESTED | 2 independent reviewers; 6 defects found (1 HIGH, 4 MED, 2 LOW), all resolved; generalization proof holds. |
| W-011 | WS1/WS2 | — | Legacy + contamination forensics | READY (BLOCKED: external access) | — |

## Phase A staging implementation evidence

| Work ID | Builder | Independent reviewer | Candidate | Status | Evidence |
|---------|---------|-----------------------|-----------|--------|----------|
| PH-A1 | `/root/baseline_context` | `/root/phase_a_final_independent_review` | `5afa46613880f1b7b8a3198df4871b2ea63c08cb` | ADVERSARIAL TESTED / PUSHED | Authenticated `POST /api/reservations/hold` is tenant-bound and strict-input; the database `reserve_capacity` authority owns capacity, advisory serialization, idempotent retry, and five-minute TTL. API 18 tests, disposable PostgreSQL concurrency/tenant tests, and independent review passed. |
| PH-A2 | `/root/baseline_context` | `/root/phase_a_final_independent_review` | `667090844990cae2837792a41a9f7b456fc8f552` | ADVERSARIAL TESTED / PUSHED / FAIL-CLOSED | Authenticated `POST /api/bookings/confirm` accepts only `bookingId`, verifies active tenant membership and tenant-owned booking, then returns `UNSUPPORTED_CONFIG` from a read-only transaction. API 27 tests, disposable PostgreSQL zero-mutation/concurrency tests, and independent review passed. No caller-controlled payment or confirmed state is accepted. |
| PH-A3 | `/root/baseline_context` | `/root/phase_a_frontend_independent_review` | `f8263205b9802473fb6a9310e6ad3139484868a2` | ADVERSARIAL TESTED / PUSHED / PROVIDER-NEUTRAL | Migration `0032_atomic_confirmation.sql` adds service-role-only `confirm_succeeded_payment(paymentId)`: derives tenant/booking/service/pricing from persisted rows, verifies a stored succeeded payment and exact active/consumed hold, serializes and atomically consumes/links/confirms, and is idempotent on replay. Resource/planning services remain fail-closed. Disposable PostgreSQL replay on source candidate `bc0a95c8ea0197e4c7993a5ee660c20fbf0c2129` covered concurrency, tenant/amount/state/slot mismatch, browser denial and rollback; API 27 tests, typecheck and independent review passed. No provider or live DB wiring. |

## Adversarial findings ledger (WS12)

| ID | Sev | Defect | Resolution | Verified |
|----|-----|--------|-----------|----------|
| D1 | HIGH | Booking could reach `confirmed` without a *succeeded* payment (engine `confirmFromPayment` + checkout confirm-on-error fallback). | Engine verifies intent state via injected provider; app fallback removed. | core+checkout tests (a/b/c/d) |
| S2 | MED | Tenant members could INSERT a `confirmed` booking with arbitrary pricing / UPDATE pricing. | `lumin.guard_booking_client_write` trigger: no client booking INSERT; financial columns frozen on UPDATE. | attack 10a/10b/10c on PG16 |
| S1 | MED | Anon `create_booking_draft` overwrote existing customer name/phone on email conflict. | Upsert keeps existing identity; only backfills a missing phone. | attack 11 on PG16 |
| D2 | MED | Pricing had no non-negative floor → negative charge. | Reject sub-zero subtotal/total; positive-amount guard before intent. | pricing + booking tests |
| D3 | MED | Quantity × price could exceed `MAX_SAFE_INTEGER` silently. | Safe-integer assertions; default maxQty 10000. | pricing test |
| D4 | LOW | Dev-mock webhook signature keyless/forgeable, no replay guard. | Keyed HMAC-SHA256, constant-time compare, replay guard; cross-env crypto. | adapters tests + RFC-4231 vector |
| D5 | LOW | Payment-failed booking permanently poisoned its idempotency key. | `failed` booking is superseded by a same-key retry; race guard intact. | booking test |
