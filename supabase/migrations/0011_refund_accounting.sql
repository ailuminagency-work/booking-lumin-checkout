-- ============================================================================
-- 0011_refund_accounting.sql — RC-3 REFUND ACCOUNTING + DEDUPE (F4, F1 comp.)
--
-- Forward-only migration. Does NOT edit 0001-0010.
--
-- F4: the webhook must record refunds idempotently. Stripe re-delivers
-- charge.refunded / refund.* events (retries + replays within the 5-min
-- window), so a refund insert MUST dedupe on the Stripe refund id — a replayed
-- refund webhook is a no-op. We add the provider + provider_refund_id columns
-- and a UNIQUE key so `insert ... on conflict do nothing` collapses replays.
--
-- This also backs the F1 compensation path (refund-on-oversell): the webhook
-- records its compensating refund here with the Stripe refund id, so a retried
-- delivery of the same succeeded event refunds/records at most once.
-- ============================================================================

alter table public.refunds
  add column if not exists provider           text not null default 'stripe',
  add column if not exists provider_refund_id text;

-- Dedupe anchor: at most one refunds row per (provider, provider_refund_id).
-- A PLAIN (non-partial) unique index so it can serve as the ON CONFLICT arbiter
-- for the webhook's idempotent upsert. Postgres treats NULLs as DISTINCT, so
-- rows with a NULL provider_refund_id (legacy/manual adjustments) are NOT
-- constrained — only webhook-sourced refunds carrying a real Stripe id dedupe.
create unique index if not exists refunds_provider_refund_id_key
  on public.refunds (provider, provider_refund_id);

comment on column public.refunds.provider_refund_id is
  'Stripe refund id (re_…). UNIQUE per provider (partial index) — the webhook dedupe key so a replayed refund webhook records at most once (RC-3 F4).';
