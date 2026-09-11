-- ============================================================================
-- 0013_platform_pii_hardening.sql — CLOSE RISK-4 / SI-11
--   platform-admin least-privilege on payments / refunds / audit_events
--
-- Forward-only, additive migration. Does NOT edit 0001-0012 or _deferred/**.
-- Idempotent-safe DDL: every policy is `drop policy if exists` before create.
--
-- BACKGROUND
--   RC-2 (0009 / RISK-2) established the least-privilege principle for PII:
--   a PLATFORM_ADMIN gets NO routine raw base-table reads of tenant data;
--   routine platform analytics flow ONLY through SECURITY DEFINER *aggregate*
--   views (no PII columns), each gated by `lumin.is_platform_admin()`.
--   0009's standing rule (see its view comments): "any future raw-PII platform
--   access must be a SEPARATE, explicit, audited path (a SECURITY DEFINER RPC
--   that writes an audit_events row), NEVER a base-table policy."
--
-- RISK-4 (this migration) extends that exact principle to the three financial +
--   audit base tables that 0009 did not yet cover. Before now, the SELECT
--   policies on payments, refunds and audit_events still carried
--   `or lumin.is_platform_admin()`, so a platform admin retained RAW cross-tenant
--   SELECT on every payment, refund and per-tenant audit row. That is exactly
--   the routine raw-base-table access RC-2 forbids. We remove it.
--
-- THE "AGGREGATE / AUDITED-ONLY" RULE (RISK-4 closure)
--   After this migration, routine platform access to financial + audit data is
--   aggregate-only (the Command Center SECURITY DEFINER views) or audited-only
--   (a dedicated SECURITY DEFINER RPC that writes an audit_events row) — NEVER a
--   raw base-table read. There is intentionally NO base-table policy that grants
--   a platform admin per-tenant payment / refund / audit rows.
--
-- ANALYTICS ARE UNAFFECTED (verified during authoring)
--   * No Command Center view reads public.payments at all.
--   * The only view over public.refunds is public.platform_economics, which
--     0009 already converted to SECURITY DEFINER (owner postgres, BYPASSRLS);
--     it therefore reads refunds independently of this base-table policy and
--     keeps returning figures to a platform admin.
--   * No view reads public.audit_events.
--   So tightening these three base tables does not change any aggregate output.
--   The definer views and their `is_platform_admin()` gates are left untouched.
--
-- RLS stays ENABLED + FORCED on all three tables (set in 0007; unchanged here).
-- service_role (BYPASSRLS) payment/refund read + write paths are untouched —
-- no service_role grant is modified. audit_events stays append-only — the
-- 0007 `revoke update, delete ... ` is untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- payments — member-only SELECT (RISK-4).
--
-- Mirrors exactly how 0009 tightened customers / bookings: drop the
-- platform-admin-inclusive policy and replace with a member-only one. A
-- platform admin is not a tenant member, so they now read ZERO payment rows.
-- Tenant members still read their own tenant's payments (positive path). No
-- INSERT/UPDATE/DELETE policy exists for authenticated on payments (writes are
-- service_role-only, SI-2) and none is added.
--
-- HYBRID (RISK-4 + codex financial-minimization): the SELECT is additionally
-- gated on `lumin.tenant_is_active(tenant_id)`. Platform status alone never
-- grants raw finance, AND membership of a SUSPENDED/inactive tenant does not
-- either — a member of an inactive tenant reads ZERO raw payment rows. Active
-- tenants' members keep reading their own payments unchanged.
-- ----------------------------------------------------------------------------
drop policy if exists "member_or_admin_select" on public.payments;
create policy "member_select" on public.payments
  for select to authenticated
  using (lumin.is_tenant_member(tenant_id) and lumin.tenant_is_active(tenant_id));

-- ----------------------------------------------------------------------------
-- refunds — member-only SELECT (RISK-4). Same treatment as payments.
--
-- public.platform_economics reads refunds as a SECURITY DEFINER view (0009), so
-- Command Center refund figures are unaffected by this tighter base policy.
--
-- HYBRID (RISK-4 + codex financial-minimization): same active-tenant gate as
-- payments — a member of a SUSPENDED/inactive tenant reads ZERO raw refund rows.
-- ----------------------------------------------------------------------------
drop policy if exists "member_or_admin_select" on public.refunds;
create policy "member_select" on public.refunds
  for select to authenticated
  using (lumin.is_tenant_member(tenant_id) and lumin.tenant_is_active(tenant_id));

-- ----------------------------------------------------------------------------
-- audit_events — remove raw cross-tenant audit reads for platform admins,
-- while KEEPING platform-level observability (RISK-4).
--
-- Old policy: a tenant owner read their tenant's events OR a platform admin
-- read ALL events (including every per-tenant row) — raw cross-tenant audit.
--
-- New policy (HYBRID — RISK-4 + codex financial-minimization):
--   * a tenant BUSINESS_OWNER reads their OWN tenant's events (tenant_id set)
--     ONLY WHILE that tenant is active (`lumin.tenant_is_active`) — an owner of
--     a SUSPENDED/inactive tenant reads ZERO per-tenant audit rows; and
--   * a platform admin reads ONLY platform-level events (tenant_id IS NULL).
--     Per-tenant audit rows (tenant_id set) are no longer visible to a platform
--     admin — those are tenant-scoped audit data.
--
-- This keeps platform-level observability (system/platform events carry a NULL
-- tenant_id) without exposing any tenant's per-tenant audit trail. audit_events
-- remains append-only (the 0007 UPDATE/DELETE revokes are untouched). Any future
-- need for a specific per-tenant audit row by the platform must go through a
-- SEPARATE, explicit, audited SECURITY DEFINER RPC — never this policy.
-- ----------------------------------------------------------------------------
drop policy if exists "owner_or_admin_select" on public.audit_events;
create policy "owner_or_platform_select" on public.audit_events
  for select to authenticated
  using (
    (tenant_id is not null and lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER' and lumin.tenant_is_active(tenant_id))
    or (tenant_id is null and lumin.is_platform_admin())
  );

comment on table public.audit_events is
  'Append-only (UPDATE/DELETE revoked from every API role in 0007). data is redacted/PII-minimized before insert (SI-11). SELECT: a tenant owner reads their own tenant''s events ONLY while that tenant is active; a platform admin reads ONLY platform-level events (tenant_id IS NULL) — no raw per-tenant audit reads (RC-2/RISK-4). Any per-tenant platform access must be a separate, audited SECURITY DEFINER RPC, never a base-table policy.';
