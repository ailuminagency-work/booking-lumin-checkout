-- ============================================================================
-- 0009_rc2_hardening.sql — RC-2 SECURITY HARDENING (RISK-1 / RISK-2)
--
-- Forward-only migration. Does NOT edit 0001-0008; re-creates the guard
-- function in full and swaps two SELECT policies + two view security contexts.
--
-- RISK-1 (RUNTIME-08 FAIL): a tenant member (even BUSINESS_STAFF) could, via a
--   plain authenticated UPDATE, move a booking pending_payment -> confirmed
--   directly — fabricating a payment-confirmed booking with no payment. The
--   guard `lumin.guard_booking_client_write` froze financial COLUMNS but allowed
--   ANY legal STATE change by members. Fix: portal members may only drive state
--   INTO 'completed' or 'cancelled'; every other target (pending_payment,
--   confirmed, refunded, failed, draft) is server-authoritative and FORBIDDEN.
--
-- RISK-2 (RUNTIME-10 FAIL): a PLATFORM_ADMIN could directly SELECT raw
--   customer / booking PII from the base tables, because the SELECT policies on
--   public.customers and public.bookings included `or lumin.is_platform_admin()`.
--   Fix: those SELECT policies become member-only (no routine raw-PII access for
--   platform admins); the two analytics views that read PII tables become
--   SECURITY DEFINER so Command Center still aggregates (aggregates only, never
--   PII), with their internal `where lumin.is_platform_admin()` gate preserved.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RISK-1 (DB): re-create the write guard IN FULL, adding the state gate.
--
-- Keeps every existing behavior:
--   * non-authenticated (service_role / SECURITY DEFINER RPC owner) bypasses;
--   * authenticated INSERT is FORBIDDEN (bookings are server-created);
--   * financial / identity columns are frozen on a member UPDATE.
-- ADDS:
--   * an authenticated UPDATE that changes `state` may target ONLY
--     'completed' or 'cancelled'. Any other target raises FORBIDDEN (P0001).
--
-- The BEFORE-UPDATE transition trigger (lumin.enforce_booking_transition) still
-- runs and validates edge legality on top of this — so, e.g., a member driving
-- a pending_payment booking to 'confirmed' is rejected here (server-authoritative
-- state), and an illegal edge like draft->completed is still rejected there.
-- The triggers already reference this function, so no trigger re-create needed.
-- ----------------------------------------------------------------------------
create or replace function lumin.guard_booking_client_write()
returns trigger
language plpgsql
as $fn$
begin
  if current_user <> 'authenticated' then
    return new;  -- service_role / definer-owned RPC: trusted server runtime
  end if;

  if tg_op = 'INSERT' then
    raise exception 'FORBIDDEN'
      using errcode = 'P0001',
            detail  = 'bookings are created by the server runtime, not by portal clients';
  end if;

  -- UPDATE by a portal user: freeze every financial / identity column.
  if new.tenant_id       is distinct from old.tenant_id
     or new.reference       is distinct from old.reference
     or new.idempotency_key is distinct from old.idempotency_key
     or new.selection       is distinct from old.selection
     or new.pricing         is distinct from old.pricing
     or new.slot_start      is distinct from old.slot_start
     or new.slot_end        is distinct from old.slot_end
     or new.customer_id     is distinct from old.customer_id
     or new.payment_id      is distinct from old.payment_id
     or new.address         is distinct from old.address then
    raise exception 'FORBIDDEN'
      using errcode = 'P0001',
            detail  = 'portal users may change booking state and notes only; '
                      || 'pricing, selection, slot, customer and payment are server-authoritative';
  end if;

  -- RC-2 (RISK-1): booking confirmation / refund / payment states are
  -- server-authoritative. A portal user may drive state ONLY into a manual
  -- operational outcome ('completed' or 'cancelled'); reaching 'confirmed',
  -- 'refunded', 'pending_payment', 'failed' or 'draft' from a client UPDATE is
  -- forbidden even when the edge itself is legal in BOOKING_TRANSITIONS.
  if tg_op = 'UPDATE'
     and new.state is distinct from old.state
     and new.state not in ('completed', 'cancelled') then
    raise exception 'FORBIDDEN'
      using errcode = 'P0001',
            detail  = 'booking confirmation/refund/payment states are '
                      || 'server-authoritative; portal users may only complete or cancel';
  end if;

  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- RISK-2 (DB): remove routine raw-PII access for platform admins.
--
-- The SELECT policies on customers / bookings become member-only. Platform
-- admins are NOT tenant members, so they now read ZERO base rows from these
-- PII tables. (INSERT/UPDATE/DELETE policies are untouched — those were already
-- member/owner-only and never granted platform admins anything.)
-- ----------------------------------------------------------------------------
drop policy if exists "member_or_admin_select" on public.customers;
create policy "member_select" on public.customers
  for select to authenticated
  using (lumin.is_tenant_member(tenant_id));

drop policy if exists "member_or_admin_select" on public.bookings;
create policy "member_select" on public.bookings
  for select to authenticated
  using (lumin.is_tenant_member(tenant_id));

-- ----------------------------------------------------------------------------
-- RISK-2 (DB): keep Command Center analytics working WITHOUT raw PII.
--
-- The two views that read PII base tables (bookings, refunds) are converted
-- from SECURITY INVOKER to SECURITY DEFINER. In Postgres a view is definer when
-- security_invoker is false. Their owner is postgres (BYPASSRLS), so they read
-- all base rows and expose ONLY aggregate columns — no names, emails, phones,
-- addresses, references or notes. Their internal `where lumin.is_platform_admin()`
-- gate is preserved and (reading auth.uid() from the request JWT, independent of
-- the view's security context) still yields ZERO rows for non-admins.
--
-- platform_business_stats (reads tenants) and platform_integration_health
-- (reads connections) stay INVOKER — they read non-PII tables.
-- ----------------------------------------------------------------------------
alter view public.platform_booking_stats set (security_invoker = false);
alter view public.platform_economics     set (security_invoker = false);

comment on view public.platform_booking_stats is
  'Command Center: bookings by state by month. SECURITY DEFINER aggregate view (RC-2 RISK-2) — aggregates only, no PII; zero rows unless lumin.is_platform_admin(). Routine platform analytics use these aggregate views; any future raw-PII platform access must be a SEPARATE, explicit, audited path (e.g. a SECURITY DEFINER RPC that writes an audit_events row), NEVER a base-table policy.';

comment on view public.platform_economics is
  'Command Center: merchant GMV vs platform revenue (never conflated) per month and currency, minor units. SECURITY DEFINER aggregate view (RC-2 RISK-2) — aggregates only, no PII; zero rows unless lumin.is_platform_admin(). Routine platform analytics use these aggregate views; any future raw-PII platform access must be a SEPARATE, explicit, audited path (e.g. a SECURITY DEFINER RPC that writes an audit_events row), NEVER a base-table policy.';
