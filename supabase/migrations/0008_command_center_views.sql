-- ============================================================================
-- 0008_command_center_views.sql
-- Lumin Command Center reporting views. AGGREGATES ONLY — no PII columns
-- (no names, emails, phones, addresses, references, notes).
--
-- All views are SECURITY INVOKER (PG15 `security_invoker = true`): underlying
-- RLS from 0007 applies to the caller, AND every view body additionally
-- filters through lumin.is_platform_admin() — a non-admin gets zero rows even
-- before RLS is consulted. Defense in depth, two independent gates.
--
-- GMV vs platform revenue are NEVER conflated (ARCHITECTURE.md):
--   * merchant_gmv           — merchants' money that flowed through bookings.
--   * subscription_revenue / transaction_revenue — Lumin's own revenue.
--     Placeholders fixed at 0 until billing lands; they are separate columns
--     precisely so no query can accidentally sum GMV into platform revenue.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- platform_business_stats — tenant counts by status: new per month, plus the
-- running total per status up to that month.
-- ----------------------------------------------------------------------------
create view public.platform_business_stats
with (security_invoker = true)
as
select
  date_trunc('month', t.created_at)::date as month,
  t.status,
  count(*)::bigint as tenants_created,
  sum(count(*)) over (
    partition by t.status
    order by date_trunc('month', t.created_at)::date
  )::bigint as tenants_total_to_date
from public.tenants t
where lumin.is_platform_admin()
group by 1, 2;

-- ----------------------------------------------------------------------------
-- platform_booking_stats — bookings by state by month (created_at month).
-- Cancellations and refunds are the 'cancelled' / 'refunded' state rows.
-- ----------------------------------------------------------------------------
create view public.platform_booking_stats
with (security_invoker = true)
as
select
  date_trunc('month', b.created_at)::date as month,
  b.state,
  count(*)::bigint as booking_count
from public.bookings b
where lumin.is_platform_admin()
group by 1, 2;

-- ----------------------------------------------------------------------------
-- platform_economics — per month AND currency (minor-unit sums must never
-- cross currencies):
--   merchant_gmv         = sum of pricing.total.amount over bookings currently
--                          in state confirmed or completed (merchants' money).
--   refunded_amount      = sum of refunds issued that month.
--   subscription_revenue / transaction_revenue = Lumin platform revenue.
--     ZERO placeholders until billing exists — kept as dedicated columns so
--     platform revenue is never conflated with GMV.
-- ----------------------------------------------------------------------------
create view public.platform_economics
with (security_invoker = true)
as
with gmv as (
  select
    date_trunc('month', b.created_at)::date as month,
    coalesce(b.pricing #>> '{total,currency}', '???') as currency,
    sum(coalesce((b.pricing #>> '{total,amount}')::bigint, 0)) as merchant_gmv
  from public.bookings b
  where lumin.is_platform_admin()
    and b.state in ('confirmed', 'completed')
  group by 1, 2
),
ref as (
  select
    date_trunc('month', r.created_at)::date as month,
    r.currency::text as currency,
    sum(r.amount) as refunded_amount
  from public.refunds r
  where lumin.is_platform_admin()
  group by 1, 2
)
select
  coalesce(g.month, ref.month) as month,
  coalesce(g.currency, ref.currency) as currency,
  coalesce(g.merchant_gmv, 0)::bigint as merchant_gmv,
  coalesce(ref.refunded_amount, 0)::bigint as refunded_amount,
  0::bigint as subscription_revenue,  -- placeholder: Lumin billing, not GMV
  0::bigint as transaction_revenue    -- placeholder: Lumin fees, not GMV
from gmv g
full outer join ref on ref.month = g.month and ref.currency = g.currency;

-- ----------------------------------------------------------------------------
-- platform_integration_health — connections by kind / provider / status.
-- ----------------------------------------------------------------------------
create view public.platform_integration_health
with (security_invoker = true)
as
select kind, provider, status, count(*)::bigint as connection_count
from (
  select 'payment'::text as kind, provider, status
  from public.payment_connections where lumin.is_platform_admin()
  union all
  select 'calendar', provider, status
  from public.calendar_connections where lumin.is_platform_admin()
  union all
  select 'notification', provider, status
  from public.notification_connections where lumin.is_platform_admin()
  union all
  select 'webhook', provider, status
  from public.webhook_connections where lumin.is_platform_admin()
) c
group by 1, 2, 3;

-- ----------------------------------------------------------------------------
-- Privileges: authenticated only (each body still yields zero rows for
-- non-admins). anon gets nothing — revoke undoes Supabase default privileges.
-- ----------------------------------------------------------------------------
revoke all on
  public.platform_business_stats, public.platform_booking_stats,
  public.platform_economics, public.platform_integration_health
from public, anon, authenticated;

grant select on
  public.platform_business_stats, public.platform_booking_stats,
  public.platform_economics, public.platform_integration_health
to authenticated, service_role;

comment on view public.platform_business_stats is
  'Command Center: tenants created per month by status + running totals. Aggregates only; zero rows unless lumin.is_platform_admin().';
comment on view public.platform_booking_stats is
  'Command Center: bookings by state by month. Aggregates only; zero rows unless lumin.is_platform_admin().';
comment on view public.platform_economics is
  'Command Center: merchant GMV vs platform revenue (never conflated) per month and currency, minor units. Zero rows unless lumin.is_platform_admin().';
comment on view public.platform_integration_health is
  'Command Center: connection counts by kind/provider/status. Zero rows unless lumin.is_platform_admin().';
