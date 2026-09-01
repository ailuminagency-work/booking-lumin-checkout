-- ============================================================================
-- 0005_customers_bookings_payments.sql
-- Customers, bookings (with the BookingContract v1 state machine enforced by
-- trigger), state history, payments, refunds.
--
-- Server-authoritative state (SI-2): triggers below enforce the exact
-- BOOKING_TRANSITIONS table from packages/contracts/src/booking.ts.
-- One payment ⇒ at most one booking (SI-3): unique
-- payments(provider, provider_intent_id), unique bookings.payment_id, and
-- idempotent creation keyed unique (tenant_id, idempotency_key).
-- All money: bigint minor units (MoneyContract).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- customers
-- ----------------------------------------------------------------------------
create table public.customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (length(name) >= 1),
  email      text not null check (position('@' in email) > 1),
  phone      text,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

-- unique (tenant_id, email) also serves as the tenant_id index (leading column).

-- ----------------------------------------------------------------------------
-- bookings — the 7 BookingState values, exactly as in contracts.
-- selection: Selection jsonb (INPUT ONLY — never carries prices, SI-1).
-- pricing:   PriceBreakdown jsonb computed by the server PricingEngine only.
-- ----------------------------------------------------------------------------
create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  -- Human-facing reference, e.g. 'LMN-3F8K2Q'. Unique per tenant.
  reference       text not null check (length(reference) >= 6),
  state           text not null default 'draft'
                  check (state in ('draft', 'pending_payment', 'confirmed',
                                   'completed', 'cancelled', 'refunded', 'failed')),
  selection       jsonb not null default '{}'::jsonb check (jsonb_typeof(selection) = 'object'),
  pricing         jsonb not null default '{}'::jsonb check (jsonb_typeof(pricing) = 'object'),
  slot_start      timestamptz not null,
  slot_end        timestamptz not null,
  customer_id     uuid references public.customers (id) on delete set null,
  address         jsonb check (address is null or jsonb_typeof(address) = 'object'),
  -- SI-3: at most one booking per successful payment (FK added below).
  payment_id      uuid unique,
  -- SI-3: idempotent creation — retries of the same checkout reuse the key.
  idempotency_key text not null check (length(idempotency_key) >= 16),
  notes           text check (notes is null or length(notes) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, reference),
  unique (tenant_id, idempotency_key),
  check (slot_end > slot_start)
);

create index bookings_tenant_id_idx         on public.bookings (tenant_id);
create index bookings_tenant_slot_start_idx on public.bookings (tenant_id, slot_start);
create index bookings_tenant_state_idx      on public.bookings (tenant_id, state);
create index bookings_customer_id_idx       on public.bookings (customer_id);

-- ----------------------------------------------------------------------------
-- booking_state_history — append-only audit of every state change (and the
-- initial state at insert, with from_state NULL). Rows are written ONLY by
-- the lumin.log_booking_state trigger below.
-- ----------------------------------------------------------------------------
create table public.booking_state_history (
  id         bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  from_state text check (from_state is null or from_state in
               ('draft', 'pending_payment', 'confirmed', 'completed',
                'cancelled', 'refunded', 'failed')),
  to_state   text not null check (to_state in
               ('draft', 'pending_payment', 'confirmed', 'completed',
                'cancelled', 'refunded', 'failed')),
  reason     text,
  at         timestamptz not null default now()
);

create index booking_state_history_booking_id_idx
  on public.booking_state_history (booking_id);

-- ----------------------------------------------------------------------------
-- payments — the 6 PaymentState values, exactly as in contracts.
-- unique (provider, provider_intent_id) is the SI-3 anchor: a replayed
-- webhook or a duplicated intent can never mint a second payment row.
-- ----------------------------------------------------------------------------
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  booking_id         uuid not null references public.bookings (id) on delete cascade,
  provider           text not null check (length(provider) >= 1),
  provider_intent_id text not null check (length(provider_intent_id) >= 1),
  state              text not null default 'requires_payment'
                     check (state in ('requires_payment', 'processing', 'succeeded',
                                      'failed', 'refunded', 'partially_refunded')),
  amount             bigint not null check (amount >= 0),
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (provider, provider_intent_id)
);

create index payments_tenant_id_idx          on public.payments (tenant_id);
create index payments_booking_id_idx         on public.payments (booking_id);
create index payments_provider_intent_id_idx on public.payments (provider_intent_id);

-- Close the SI-3 loop: bookings.payment_id must point at a real payment.
-- (Added after payments exists; both directions nullable-safe.)
alter table public.bookings
  add constraint bookings_payment_id_fkey
  foreign key (payment_id) references public.payments (id) on delete set null;

-- ----------------------------------------------------------------------------
-- refunds — money returned against a payment (Refund contract).
-- ----------------------------------------------------------------------------
create table public.refunds (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  amount     bigint not null check (amount > 0),
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason     text,
  created_at timestamptz not null default now()
);

create index refunds_tenant_id_idx  on public.refunds (tenant_id);
create index refunds_booking_id_idx on public.refunds (booking_id);
create index refunds_payment_id_idx on public.refunds (payment_id);

-- ============================================================================
-- Booking state machine triggers (SI-2)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- lumin.enforce_booking_transition — BEFORE UPDATE guard mirroring
-- BOOKING_TRANSITIONS in packages/contracts/src/booking.ts EXACTLY:
--   draft           → pending_payment | failed
--   pending_payment → confirmed | failed
--   confirmed       → completed | cancelled | refunded
--   completed       → refunded
--   cancelled       → refunded
--   refunded        → (terminal)
--   failed          → (terminal)
-- Any other change of state raises ILLEGAL_TRANSITION (ErrorContract code).
-- No role is exempt: the trigger fires for service_role and postgres too.
-- ----------------------------------------------------------------------------
create or replace function lumin.enforce_booking_transition()
returns trigger
language plpgsql
as $fn$
declare
  allowed text[];
begin
  if new.state = old.state then
    return new;
  end if;

  allowed := case old.state
    when 'draft'           then array['pending_payment', 'failed']
    when 'pending_payment' then array['confirmed', 'failed']
    when 'confirmed'       then array['completed', 'cancelled', 'refunded']
    when 'completed'       then array['refunded']
    when 'cancelled'       then array['refunded']
    else array[]::text[]  -- 'refunded' and 'failed' are terminal
  end;

  if not (new.state = any (allowed)) then
    raise exception 'ILLEGAL_TRANSITION'
      using errcode = 'P0001',
            detail  = format('booking %s: transition %s -> %s is not allowed by BOOKING_TRANSITIONS',
                             old.id, old.state, new.state);
  end if;

  return new;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- lumin.log_booking_state — appends to booking_state_history on INSERT
-- (from_state NULL) and on every state change. SECURITY DEFINER so the append
-- succeeds for any legitimate writer without granting clients INSERT on the
-- history table (which stays trigger-written only; see 0007).
-- ----------------------------------------------------------------------------
create or replace function lumin.log_booking_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_state_history (booking_id, from_state, to_state, reason)
    values (new.id, null, new.state, 'created');
  elsif old.state is distinct from new.state then
    insert into public.booking_state_history (booking_id, from_state, to_state, reason)
    values (new.id, old.state, new.state, null);
  end if;
  return null;
end;
$fn$;

revoke all on function lumin.enforce_booking_transition() from public, anon, authenticated;
revoke all on function lumin.log_booking_state()          from public, anon, authenticated;

create trigger bookings_enforce_transition
  before update on public.bookings
  for each row execute function lumin.enforce_booking_transition();

create trigger bookings_log_state
  after insert or update on public.bookings
  for each row execute function lumin.log_booking_state();

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function lumin.touch_updated_at();

create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function lumin.touch_updated_at();
