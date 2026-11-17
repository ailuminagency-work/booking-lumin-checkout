-- 0090 payment review park (removes the automatic refund).
--
-- POLICY REVERSAL, recorded deliberately. supabase/functions/stripe-webhook/index.ts
-- shipped an F1 'deterministic refund-on-oversell': when a succeeded Stripe intent
-- could not be confirmed (amount mismatch, or the capacity hold missing/expired/
-- released), its compensate() path called stripe.refund(), wrote public.refunds and
-- moved the booking to the TERMINAL state 'failed' -- all with no human action.
--
-- That is incompatible with a standing product rule: Booking Lumin must NEVER
-- automatically issue a refund. Moving a customer's money without a person
-- deciding is exactly the class of action the rule exists to prevent, and it fired
-- on a race (a hold expiring between capture and webhook delivery), not on fraud.
--
-- The replacement is to PARK, not refund:
--   * payments.state := 'processing'   (captured, unresolved, and NOT confirmable:
--     confirm_succeeded_payment requires 'succeeded', so a parked payment can never
--     be turned into a booking by any later automatic path)
--   * one row in this table, carrying the evidence a person needs to decide
--   * the capacity hold is released, because a slot must not be held for a payment
--     nobody has resolved
--   * the booking is deliberately LEFT ALONE, in a non-terminal state. The old path
--     could move it to 'failed' because the money had already gone back; with the
--     money still captured, a terminal booking would strand it. 'pending_payment'
--     keeps BOTH resolutions legal (-> confirmed, or -> failed) per the 0005
--     transition table, so a reviewer can honour the booking or refund by hand.
--
-- STRICTLY CLOSING. This migration adds no route and no credential. It creates the
-- durable record that makes removing the automatic refund safe rather than silent.
begin;

create table if not exists public.payment_reviews (
  payment_id          uuid primary key references public.payments (id) on delete cascade,
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  booking_id          uuid not null references public.bookings (id) on delete cascade,
  reason              text not null check (reason in ('amount_mismatch', 'capacity_oversold')),
  provider            text not null check (length(provider) between 1 and 60),
  provider_intent_id  text not null check (length(provider_intent_id) between 1 and 200),
  expected_amount     bigint not null check (expected_amount >= 0),
  observed_amount     bigint,
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  status              text not null default 'open'
                      check (status in ('open', 'resolved_honoured', 'resolved_refunded', 'resolved_other')),
  resolution_note     text check (resolution_note is null or length(resolution_note) between 1 and 2000),
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  constraint payment_reviews_resolved_coherent
    check ((status = 'open') = (resolved_at is null))
);

create index if not exists payment_reviews_open_idx
  on public.payment_reviews (tenant_id, created_at) where status = 'open';

-- Same posture as public.capacity_holds (0010) and public.confirmable_payment_providers
-- (0088): RLS enabled AND forced with no policies, every client verb revoked. A money
-- decision queue must not be readable or writable through PostgREST by a tenant or an
-- owner -- the rows name amounts and provider intent ids, and a tenant must not be able
-- to mark its own payment 'resolved_honoured'.
alter table public.payment_reviews enable row level security;
alter table public.payment_reviews force row level security;
revoke all on public.payment_reviews from public, anon, authenticated, service_role;
grant select, insert, update on public.payment_reviews to service_role;

comment on table public.payment_reviews is
 'Captured payments that could NOT be confirmed and are awaiting a HUMAN decision. Booking Lumin never refunds automatically: the webhook parks here instead of calling the provider refund API. A row means money is held, the booking is unconfirmed and non-terminal, and a person must either honour the booking or refund it by hand. Server-authoritative: never grant a verb to a client role.';
comment on column public.payment_reviews.observed_amount is
 'The amount the provider reported, when it was present. NULL means the webhook carried no usable amount, which is itself the reason for the review.';

commit;
