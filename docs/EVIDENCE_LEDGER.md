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
