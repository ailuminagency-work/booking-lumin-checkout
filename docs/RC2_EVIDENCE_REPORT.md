# RC-2 Evidence Report — Clean Supabase Runtime

**Milestone:** RC-2 — Clean Supabase Runtime. **Target outcome:** *Booking Lumin Checkout — Clean
Runtime Baseline.* **Date:** 2026-09-03.

**Live project:** "Booking Lumin Checkout" — ref `pplwyfbxrnodimhzlvdl`, org `esqxhonfprdoonvnwsmh`
("ailuminagency-work's Org"), region `us-east-1`, Postgres 17.6. Brand-new; no relationship to
`embed-checkout`, the prior-client project, `leadgate`, or `card-craft-embed` (all left untouched).

**Method note (important):** the session's egress policy blocks direct HTTPS to the project host
(`pplwyfbxrnodimhzlvdl.supabase.co`, 403 at the proxy). The Supabase management/SQL channel is
reachable, and it reproduces PostgREST's exact post-verification request context
(`set role authenticated|anon` + `request.jwt.claims` → correct `auth.uid()`/`auth.role()`), so the
**database authorization boundary — RLS, the SECURITY DEFINER RPC, triggers, where 100% of the
tenant-isolation logic lives — was attacked faithfully**. What could NOT be exercised is the blocked
network layer: GoTrue signup/login + JWT signature issuance/verification, and PostgREST over HTTP.
Those items are marked **UNVERIFIED (egress-blocked)** and require allowlisting the host.

## Test identities (real `auth.users` rows; no secrets shown)

| Handle | Role | user_id |
|---|---|---|
| Owner A | BUSINESS_OWNER, Tenant A | `1111…1111` |
| Staff A | BUSINESS_STAFF, Tenant A | `2222…2222` |
| Owner B | BUSINESS_OWNER, Tenant B | `3333…3333` |
| Staff B | BUSINESS_STAFF, Tenant B | `4444…4444` |
| Platform Admin | PLATFORM_ADMIN | `5555…5555` |

Tenant A (`aaaa…`, USD, America/Chicago) and Tenant B (`bbbb…`, EUR, Europe/Amsterdam), each with a
service, customer, confirmed booking + succeeded payment, a `not_connected` payment connection + secret,
and checkout branding. No real PII (reserved `.example.test` domains, `+1555…` phones).

## Acceptance gates

| Gate | Verdict | Evidence |
|---|---|---|
| RUNTIME-01 clean project | **PASS** | New project; 0 auth users, 0 public tables, 0 legacy refs at creation. |
| RUNTIME-02 clean data | **PASS** | Only newly-created test identities + fixtures exist; no inherited users/data/secrets/providers/domains. |
| RUNTIME-03 migration integrity | **PASS** | Exactly `0001`–`0009` applied (accepted on `main`); `_deferred/` NOT applied; 27 tables, all RLS enabled+forced; matches repo. |
| RUNTIME-04 real Auth | **PARTIAL / UNVERIFIED** | Real `auth.users` rows created & used for authorization; GoTrue-issued JWT login over HTTP is egress-blocked. |
| RUNTIME-05 tenant read isolation | **PASS** | Owner A & Staff A → Tenant B private reads all 0 (bookings/customers/payments/connections/settings/members/audit). Services = public catalog by design. |
| RUNTIME-06 tenant write isolation | **PASS** | Forged-tenant INSERT (services, customers) → 42501; cross-tenant UPDATE → 0 rows; DELETE → 0 rows. |
| RUNTIME-07 RPC isolation | **PASS** | `create_booking_draft` sets state/pricing server-side; tenant/service forgery → SERVICE_NOT_FOUND; anon cannot read the result. |
| RUNTIME-08 financial authority | **PASS** (after RISK-1 fix) | Member `pending_payment→confirmed` and `→refunded` now FORBIDDEN (P0001); `service_role` payment path preserved; engine `transition()` cannot reach `confirmed`. |
| RUNTIME-09 platform privilege | **PASS** | Tenant users cannot execute platform helpers or read `platform_admins`; admin has zero tenant write powers (insert 42501, update 0 rows). |
| RUNTIME-10 PII minimization | **PASS** (after RISK-2 fix) | Platform admin base-table `customers`/`bookings` = 0 rows; Command Center aggregates intact via SECURITY DEFINER views (no PII columns); non-admin views = 0 rows. |
| RUNTIME-11 secret boundary | **PASS** | `*_connection_secrets` unreachable by anon/authenticated (no grant, no policy); no service-role/provider secret in browser bundles (RC-1 bundle scan). |
| RUNTIME-12 adversarial pass | **PASS** | Independent reviewer (did not build) applied `0001`–`0009` on its own PG, ran 32 shipped + 24 novel attacks incl. every RISK-1 bypass route → APPROVE. |

## Attack categories exercised (authorization boundary)

SELECT / INSERT / UPDATE / DELETE / RPC, as Owner A, Staff A, Platform Admin, and anon:
cross-tenant reads (all private data), cross-tenant writes, forged `tenant_id`, role escalation
(staff→owner via UPDATE and INSERT), direct booking INSERT, financial-column tampering (reprice),
financial-state forgery (member→confirmed/refunded), RPC tenant/service forgery, anon direct writes,
secret-table reads, platform-only boundary, and bypass variants (multi-row UPDATE, UPDATE…FROM,
data-modifying CTE, no-op-then-confirm, reprice-on-complete, payment_id linking). All denied except
intended public-catalog reads and legitimate operational transitions (complete/cancel).

## Remediations (this milestone)

| ID | Issue | Fix | PR |
|----|-------|-----|----|
| RISK-1 | Member could set a booking to `confirmed` with no payment (RUNTIME-08). | `0009`: guard restricts authenticated state changes to `{completed, cancelled}`; engine `transition()` refuses `confirmed`. | #5 (merged `3f2a049`) |
| RISK-2 | Platform admin read raw customer/booking PII (RUNTIME-10). | `0009`: `customers`/`bookings` SELECT member-only; the two PII-reading analytics views → SECURITY DEFINER (aggregates only, `is_platform_admin()` gate preserved). | #5 (merged `3f2a049`) |

CI added (`.github/workflows/ci.yml`): typecheck/test/build/contamination + a Postgres job that
applies `0001`–`0009` and runs the RLS attack suite — both green on PR #5.

## Open RISKs (non-blocking)

- **RISK-3 (egress):** RUNTIME-04 real GoTrue login/JWT + PostgREST-over-network attacks are
  UNVERIFIED because the project host is blocked by session egress policy. **Recommendation:**
  allowlist `pplwyfbxrnodimhzlvdl.supabase.co` and run the HTTP-layer attacks to close RUNTIME-04.
  All isolation logic is at the DB boundary (certified); the gap is the Supabase-managed transport.
- **RISK-4 (residual PII surface):** `payments`, `refunds`, `audit_events` base-table SELECT
  policies still allow platform-admin raw cross-tenant reads (financial/audit, not structured
  customer PII — out of RISK-2's stated scope, and unchanged by RC-2). `audit_events.data` is free
  JSON whose PII-minimization is a runtime responsibility (SI-11). **Recommendation:** extend the
  "no routine raw platform base-table access" principle to these three tables (aggregate/audited
  paths only) as a follow-up.

## Go / No-Go for RC-3 (Real Payment Runtime, Stripe TEST mode)

**Conditional GO.** The database authorization boundary — every line of tenant-isolation, financial-
authority, RPC, and platform-privilege logic — is certified against the live runtime and
independently adversarially reviewed. RC-3's payment path runs through the trusted server runtime
(`service_role`), which is the boundary certified here, so RC-3 can proceed on this baseline.

Two conditions attached, neither blocking RC-3 start:
1. Close **RUNTIME-04** by allowlisting the host and running the real GoTrue+PostgREST HTTP attacks
   (recommended before production, can run in parallel with RC-3).
2. Track **RISK-4** as a scoped follow-up.

No external provider (Stripe, Google, Gmail, Calendar, Resend, SendGrid, Twilio, SMS, webhooks, CRM,
Lovable, Netlify) was connected during RC-2.

## Baseline freeze

On merge of PR #5, `main` is tagged **`rc2-clean-runtime-baseline`** and the live project
`pplwyfbxrnodimhzlvdl` is the *Booking Lumin Checkout — Clean Runtime Baseline*.
