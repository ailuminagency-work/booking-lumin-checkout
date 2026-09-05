# Baseline Invariants (Runtime Guardian)

The accepted `main` branch and the live Supabase project `pplwyfbxrnodimhzlvdl`
("Booking Lumin Checkout — Clean Runtime Baseline") are protected infrastructure.
Every integration candidate is compared against these invariants before promotion.
A candidate that violates any accepted invariant is BLOCKED and returned to its owner.

## Build / repo invariants (verified in CI on every PR)

- **B1** `npm run typecheck` → 0 errors across all workspaces.
- **B2** `npm run test` → all suites green (no skips, no quarantines to get green).
- **B3** `npm run build` → all three apps build.
- **B4** `bash scripts/contamination-check.sh` → clean: no legacy-client identifier
  anywhere outside `docs/CONTAMINATION_LEDGER.md`; no real secret/PII.
- **B5** Migration integrity: `supabase/migrations/0*.sql` apply cleanly in order on an
  empty DB; `supabase/tests/rls_attack_tests.sql` passes end-to-end. `_deferred/` is
  never applied.
- **B6** No workspace boundary regressions: `@lumin/contracts` depends on nothing
  internal; `core`/`adapters` never import app or framework/IO code; no cross-app imports.

## Runtime / security invariants (live project + schema)

- **R1 Tenant isolation** — cross-tenant SELECT/INSERT/UPDATE/DELETE denied at the DB
  (RLS forced on every table; forged `tenant_id` writes rejected 42501). Public catalog
  (active services + availability inputs) is the only anon-readable data.
- **R2 Payment authority** — a booking reaches `confirmed` ONLY through the designated
  payment-authority path after server-verified success. Generic `transition()` (engine)
  and member UPDATEs (DB guard) cannot reach `confirmed`/`refunded`/`pending_payment`.
- **R3 Server-authoritative amount** — client totals are never authoritative; the charge
  amount is recomputed server-side; Stripe amount must equal the server amount.
- **R4 One payment → at most one booking** — unique `payments(provider,provider_intent_id)`,
  unique `bookings.payment_id`, idempotent `(tenant_id, idempotency_key)`.
- **R5 Availability fail-closed** — a slot that cannot be proven free is unavailable;
  availability must be valid at the authoritative commitment point.
- **R6 Secret boundary** — service-role / provider secrets never appear in browser
  bundles, public env, client logs, or browser-readable DB rows. `*_connection_secrets`
  unreachable by anon/authenticated.
- **R7 Platform ≠ tenant trust** — `platform_admins` and `tenant_members` are disjoint;
  a platform admin has no tenant write powers and (post RC-2) no routine raw customer/
  booking PII read; Command Center analytics are aggregate-only.
- **R8 Webhook authenticity** — provider webhooks are signature-verified server-side;
  duplicate/replayed webhooks are harmless (idempotent).
- **R9 Audit integrity** — `audit_events` is append-only; `booking_state_history` is
  trigger-written only.

## Open items tracked against the baseline

- **RUNTIME-04 (open):** real Supabase Auth/PostgREST *HTTPS-transport* isolation testing
  is not yet performed (egress to the project host was blocked). Not closed indirectly by
  any other milestone.
- **RISK-4 (open, tracked):** platform admin still has raw read of `payments`/`refunds`/
  `audit_events` (financial/audit, not customer PII); `audit_events.data` PII-minimization
  is a runtime (SI-11) duty. No RC-3+ change may WIDEN platform-admin access.

## Process compensations (see GOVERNANCE.md)

Branch protection cannot be set via the available GitHub integration token
("Resource not accessible by integration"). Compensating controls: no direct pushes to
`main`; every change via branch → PR → **required CI green** → independent review →
Runtime-Guardian check → Release-Governor merge. **CI must be green before merge** — a
docs-only PR is not exempt (this document exists because a docs PR merged ahead of CI
introduced a B4 contamination regression).
