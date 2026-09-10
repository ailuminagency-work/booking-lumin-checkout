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
  a platform admin has no tenant write powers and no routine raw base-table read of tenant
  data: no customer/booking PII (post RC-2 / 0009) and no `payments`/`refunds`/per-tenant
  `audit_events` (post 0013 / RISK-4). Routine platform access is aggregate-only (Command
  Center SECURITY DEFINER views) or audited-only (a SECURITY DEFINER RPC that writes an
  `audit_events` row) — never a base-table policy. Platform admins retain only platform-level
  `audit_events` (rows where `tenant_id IS NULL`) for observability.
- **R8 Webhook authenticity** — provider webhooks are signature-verified server-side;
  duplicate/replayed webhooks are harmless (idempotent).
- **R9 Audit integrity** — `audit_events` is append-only; `booking_state_history` is
  trigger-written only.

## Open items tracked against the baseline

- **RUNTIME-04 (open):** real Supabase Auth/PostgREST *HTTPS-transport* isolation testing
  is not yet performed (egress to the project host was blocked). Not closed indirectly by
  any other milestone.
- **RISK-4 (closed in repo — migration `0013_platform_pii_hardening.sql`):** platform
  admins no longer have raw base-table read of `payments`, `refunds`, or per-tenant
  `audit_events`. The `payments`/`refunds` SELECT policies are now member-only (mirroring
  0009's customers/bookings tightening); the `audit_events` SELECT policy gives a tenant
  owner only their own tenant's events and a platform admin only platform-level rows
  (`tenant_id IS NULL`). Analytics are unaffected — no aggregate view reads `payments` or
  `audit_events`, and the only view over `refunds` (`platform_economics`) is SECURITY
  DEFINER (0009), so Command Center figures still flow. Proven by new attack cases (ATTACK
  14) in `supabase/tests/rls_attack_tests.sql`. **Live-apply to project
  `pplwyfbxrnodimhzlvdl` is a follow-up step** (closed in repo/CI only). `audit_events.data`
  PII-minimization remains a runtime (SI-11) duty. No later change may WIDEN platform-admin
  access.

## Process compensations (see GOVERNANCE.md)

Branch protection cannot be set via the available GitHub integration token
("Resource not accessible by integration"). Compensating controls: no direct pushes to
`main`; every change via branch → PR → **required CI green** → independent review →
Runtime-Guardian check → Release-Governor merge. **CI must be green before merge** — a
docs-only PR is not exempt (this document exists because a docs PR merged ahead of CI
introduced a B4 contamination regression).
