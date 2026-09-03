-- ============================================================================
-- rls_attack_tests.sql — RLS / state-machine attack simulation (SI-2..SI-5).
--
-- Run with psql against a FRESH project that has all migrations applied,
-- connected as a role that can SET ROLE to anon/authenticated/service_role
-- (Supabase: the postgres connection string; local dry run: superuser after
-- tests/local_harness.sql):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_attack_tests.sql
--
-- Everything runs inside ONE transaction that is ROLLED BACK at the end —
-- no fixture data survives. JWTs are simulated with the standard Supabase
-- technique: set_config('request.jwt.claims', ..., true) + SET LOCAL ROLE.
--
-- A failed assertion raises an exception; with ON_ERROR_STOP=1 the script
-- aborts non-zero. If the last line printed is "ALL RLS ATTACK TESTS PASSED",
-- every attack was repelled.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ----------------------------------------------------------------------------
-- Fixtures (as the privileged migration role; RLS is bypassed here).
--   Tenant A: owner + staff, one active service, one confirmed booking with a
--             succeeded payment, one payment connection + secret.
--   Tenant B: owner, one active service, one draft booking, one connection.
-- ----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'owner-b@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'platform-admin@example.test');

insert into public.tenants (id, name, slug, timezone, currency, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A', 'tenant-a', 'America/Chicago', 'USD', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B', 'tenant-b', 'Europe/Amsterdam', 'EUR', 'active');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'BUSINESS_OWNER'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'BUSINESS_STAFF'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'BUSINESS_OWNER');

insert into public.platform_admins (user_id) values
  ('44444444-4444-4444-4444-444444444444');

insert into public.services (id, tenant_id, archetype, name, currency, base_price) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'simple', 'Deep Clean A', 'USD', 15000),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'simple', 'Detailing B', 'EUR', 9900);

insert into public.customers (id, tenant_id, name, email) values
  ('a0000000-0000-0000-0000-00000000c001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice A', 'alice@example.test'),
  ('b0000000-0000-0000-0000-00000000c001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob B', 'bob@example.test');

-- Booking A1 enters as draft, then walks the LEGAL path to confirmed so the
-- transition trigger is exercised (and the history rows accumulate).
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
   customer_id, idempotency_key)
values
  ('a0000000-0000-0000-0000-00000000b001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'LMN-AAA001', 'draft', '{"serviceId":"a0000000-0000-0000-0000-000000000001"}',
   '{"total":{"amount":16200,"currency":"USD"}}',
   now() + interval '2 days', now() + interval '2 days 2 hours',
   'a0000000-0000-0000-0000-00000000c001', 'idem-key-tenant-a-0001'),
  ('b0000000-0000-0000-0000-00000000b001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'LMN-BBB001', 'draft', '{"serviceId":"b0000000-0000-0000-0000-000000000001"}',
   '{"total":{"amount":9900,"currency":"EUR"}}',
   now() + interval '3 days', now() + interval '3 days 1 hour',
   'b0000000-0000-0000-0000-00000000c001', 'idem-key-tenant-b-0001');

update public.bookings set state = 'pending_payment'
  where id = 'a0000000-0000-0000-0000-00000000b001';
update public.bookings set state = 'confirmed'
  where id = 'a0000000-0000-0000-0000-00000000b001';

insert into public.payments
  (id, tenant_id, booking_id, provider, provider_intent_id, state, amount, currency)
values
  ('a0000000-0000-0000-0000-00000000d001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a0000000-0000-0000-0000-00000000b001', 'mock', 'pi_mock_0001', 'succeeded',
   16200, 'USD');

update public.bookings set payment_id = 'a0000000-0000-0000-0000-00000000d001'
  where id = 'a0000000-0000-0000-0000-00000000b001';

insert into public.payment_connections (id, tenant_id, provider, status, config) values
  ('a0000000-0000-0000-0000-00000000e001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'mock', 'connected', '{"label":"A mock"}'),
  ('b0000000-0000-0000-0000-00000000e001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'mock', 'connected', '{"label":"B mock"}');

insert into public.payment_connection_secrets (connection_id, tenant_id, credentials_encrypted) values
  ('a0000000-0000-0000-0000-00000000e001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '\x6465616462656566'),
  ('b0000000-0000-0000-0000-00000000e001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '\x6465616462656566');

-- RC-2 (RISK-1) fixtures for ATTACK 12: a Tenant-A booking parked in
-- pending_payment (the state a member must NOT be able to push to confirmed),
-- plus two confirmed Tenant-A bookings used as positive controls (a member MAY
-- still complete or cancel). Pricing is left empty so these rows contribute 0
-- to platform_economics GMV — ATTACK 9d's exact USD total (16200 from A1) is
-- preserved. Inserted directly by the privileged fixture role (the INSERT-time
-- guard bypasses for non-authenticated; the transition trigger is UPDATE-only).
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
   customer_id, idempotency_key)
values
  ('a0000000-0000-0000-0000-00000000b0aa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'LMN-APP001', 'pending_payment',
   '{"serviceId":"a0000000-0000-0000-0000-000000000001"}', '{}',
   now() + interval '7 days', now() + interval '7 days 2 hours',
   'a0000000-0000-0000-0000-00000000c001', 'idem-key-tenant-a-pp01'),
  ('a0000000-0000-0000-0000-00000000b0bb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'LMN-ACF001', 'confirmed',
   '{"serviceId":"a0000000-0000-0000-0000-000000000001"}', '{}',
   now() + interval '8 days', now() + interval '8 days 2 hours',
   'a0000000-0000-0000-0000-00000000c001', 'idem-key-tenant-a-cf01'),
  ('a0000000-0000-0000-0000-00000000b0cc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'LMN-ACF002', 'confirmed',
   '{"serviceId":"a0000000-0000-0000-0000-000000000001"}', '{}',
   now() + interval '9 days', now() + interval '9 days 2 hours',
   'a0000000-0000-0000-0000-00000000c001', 'idem-key-tenant-a-cf02');

-- ============================================================================
-- ATTACK 1 — Tenant B's owner tries to read Tenant A's data. Expect 0 rows
-- everywhere, while B's own rows stay visible (positive control).
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"owner-b@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.bookings
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1a: B member read % of A''s bookings', n; end if;

  select count(*) into n from public.customers
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1b: B member read % of A''s customers', n; end if;

  -- Note: A's ACTIVE service is public catalog (anon-visible by design), so
  -- the isolation check for services targets member-only visibility: an
  -- INACTIVE service of A must be invisible to B. All A services here are
  -- active, so assert B cannot see A rows via the member policy on customers/
  -- bookings/connections, and cannot see A's payments:
  select count(*) into n from public.payments
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1c: B member read % of A''s payments', n; end if;

  select count(*) into n from public.payment_connections
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1d: B member read % of A''s connections', n; end if;

  -- Positive control: B sees its own rows.
  select count(*) into n from public.bookings
    where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if n <> 1 then raise exception 'FAIL 1e: B member expected 1 own booking, saw %', n; end if;

  raise notice 'PASS 1: cross-tenant reads return zero rows';
end;
$t$;

-- Inactive-service isolation: deactivate one A service as the privileged role,
-- then confirm B (a mere member of another tenant) cannot see it.
reset role;
update public.services set active = false
  where id = 'a0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"owner-b@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.services
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 0 then raise exception 'FAIL 1f: B member read % of A''s inactive services', n; end if;
  raise notice 'PASS 1f: inactive services of another tenant are invisible';
end;
$t$;

reset role;
update public.services set active = true
  where id = 'a0000000-0000-0000-0000-000000000001';

-- ============================================================================
-- ATTACK 2 — Tenant B's owner forges tenant_id = A on an INSERT into a
-- member-writable table (services). Expect the WITH CHECK to reject it
-- (SQLSTATE 42501). (Bookings are separately INSERT-blocked for all members
-- by the server-authoritative guard — see ATTACK 10a.)
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"owner-b@example.test"}',
  true);
set local role authenticated;

do $t$
begin
  begin
    insert into public.services (tenant_id, archetype, name, currency, base_price)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'simple', 'Forged Service', 'USD', 100);
    raise exception 'FAIL 2: forged tenant_id INSERT was accepted';
  exception
    when insufficient_privilege then
      raise notice 'PASS 2: forged tenant_id INSERT rejected by RLS (42501)';
  end;
end;
$t$;

reset role;

-- ============================================================================
-- ATTACK 3 — anon tries to read customers / payments / connection secrets.
-- Expect denial (42501: no grant + no policy). Positive control: the public
-- catalog and checkout branding remain readable.
-- ============================================================================
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $t$
declare
  n bigint;
begin
  begin
    select count(*) into n from public.customers;
    raise exception 'FAIL 3a: anon could query customers (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3a: anon denied on customers';
  end;

  begin
    select count(*) into n from public.payments;
    raise exception 'FAIL 3b: anon could query payments (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3b: anon denied on payments';
  end;

  begin
    select count(*) into n from public.bookings;
    raise exception 'FAIL 3c: anon could query bookings (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3c: anon denied on bookings';
  end;

  begin
    select count(*) into n from public.payment_connection_secrets;
    raise exception 'FAIL 3d: anon could query connection secrets (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 3d: anon denied on payment_connection_secrets';
  end;

  -- Positive control: catalog is readable.
  select count(*) into n from public.services where active;
  if n < 2 then
    raise exception 'FAIL 3e: anon should see the active public catalog, saw % services', n;
  end if;
  raise notice 'PASS 3e: anon reads active catalog (% services)', n;
end;
$t$;

-- ============================================================================
-- ATTACK 4 — anon inserts directly into bookings. Expect denial (42501).
-- ============================================================================
do $t$
begin
  begin
    insert into public.bookings
      (tenant_id, reference, state, selection, pricing, slot_start, slot_end, idempotency_key)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'LMN-ANON01', 'draft', '{}', '{}',
       now() + interval '1 day', now() + interval '1 day 1 hour',
       'anon-direct-key-000001');
    raise exception 'FAIL 4: anon direct INSERT into bookings was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS 4: anon direct INSERT into bookings denied';
  end;
end;
$t$;

-- Positive control: the sanctioned path — SECURITY DEFINER RPC — works for
-- anon and is idempotent (same key ⇒ same booking).
do $t$
declare
  first_id  uuid;
  second_id uuid;
begin
  select t.booking_id into first_id
  from public.create_booking_draft(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'anon-rpc-idem-key-0001',
    '{"serviceId":"a0000000-0000-0000-0000-000000000001"}'::jsonb,
    now() + interval '4 days',
    now() + interval '4 days 2 hours',
    '{"name":"Carol","email":"carol@example.test"}'::jsonb
  ) t;

  select t.booking_id into second_id
  from public.create_booking_draft(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'anon-rpc-idem-key-0001',
    '{"serviceId":"a0000000-0000-0000-0000-000000000001"}'::jsonb,
    now() + interval '4 days',
    now() + interval '4 days 2 hours',
    '{"name":"Carol","email":"carol@example.test"}'::jsonb
  ) t;

  if first_id is null or first_id is distinct from second_id then
    raise exception 'FAIL 4b: RPC not idempotent (% vs %)', first_id, second_id;
  end if;
  raise notice 'PASS 4b: anon draft creation works only via RPC and is idempotent';
end;
$t$;

reset role;

-- ============================================================================
-- ATTACK 5 — role escalation: Tenant A STAFF updates tenant_members to make
-- themselves BUSINESS_OWNER. Expect 0 rows affected (policy: owner-only) and
-- the stored role unchanged. Staff also cannot write integrations/settings.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","email":"staff-a@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n integer;
  v_role text;
begin
  update public.tenant_members
     set role = 'BUSINESS_OWNER'
   where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id   = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5a: staff updated % tenant_members row(s)', n; end if;

  select role into v_role from public.tenant_members
   where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id   = '22222222-2222-2222-2222-222222222222';
  if v_role <> 'BUSINESS_STAFF' then
    raise exception 'FAIL 5b: staff role changed to %', v_role;
  end if;

  begin
    update public.payment_connections
       set status = 'revoked'
     where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 5c: staff updated % connection row(s)', n; end if;
  end;

  begin
    insert into public.tenant_members (tenant_id, user_id, role)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '33333333-3333-3333-3333-333333333333', 'BUSINESS_OWNER');
    raise exception 'FAIL 5d: staff inserted a tenant_members row';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'PASS 5: staff role escalation and integration writes denied';
end;
$t$;

-- Bonus: authenticated member cannot reach connection secrets at all.
do $t$
declare
  n bigint;
begin
  begin
    select count(*) into n from public.payment_connection_secrets;
    raise exception 'FAIL 5e: member could query connection secrets (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS 5e: member denied on payment_connection_secrets';
  end;
end;
$t$;

reset role;

-- ============================================================================
-- ATTACK 6 — illegal booking state transition confirmed → draft. The trigger
-- must raise ILLEGAL_TRANSITION for EVERY role (server-authoritative, SI-2).
-- Legal transitions still work, and history is appended automatically.
-- ============================================================================
do $t$
declare
  n bigint;
begin
  begin
    update public.bookings set state = 'draft'
     where id = 'a0000000-0000-0000-0000-00000000b001';  -- currently 'confirmed'
    raise exception 'FAIL 6a: confirmed -> draft was accepted';
  exception when others then
    if sqlerrm <> 'ILLEGAL_TRANSITION' then raise; end if;
    raise notice 'PASS 6a: confirmed -> draft raises ILLEGAL_TRANSITION';
  end;

  begin
    update public.bookings set state = 'confirmed'
     where id = 'b0000000-0000-0000-0000-00000000b001';  -- draft: must pass pending_payment first
    raise exception 'FAIL 6b: draft -> confirmed was accepted';
  exception when others then
    if sqlerrm <> 'ILLEGAL_TRANSITION' then raise; end if;
    raise notice 'PASS 6b: draft -> confirmed raises ILLEGAL_TRANSITION';
  end;

  -- Legal path still works and is journaled.
  update public.bookings set state = 'pending_payment'
   where id = 'b0000000-0000-0000-0000-00000000b001';
  update public.bookings set state = 'failed'
   where id = 'b0000000-0000-0000-0000-00000000b001';

  begin
    update public.bookings set state = 'draft'
     where id = 'b0000000-0000-0000-0000-00000000b001';  -- failed is terminal
    raise exception 'FAIL 6c: failed (terminal) accepted a transition';
  exception when others then
    if sqlerrm <> 'ILLEGAL_TRANSITION' then raise; end if;
    raise notice 'PASS 6c: terminal state rejects all transitions';
  end;

  select count(*) into n from public.booking_state_history
   where booking_id = 'b0000000-0000-0000-0000-00000000b001';
  -- created(null->draft) + draft->pending_payment + pending_payment->failed
  if n <> 3 then
    raise exception 'FAIL 6d: expected 3 history rows, found %', n;
  end if;
  raise notice 'PASS 6d: state history auto-appended (% rows)', n;
end;
$t$;

-- ============================================================================
-- ATTACK 7 — idempotency replay: second booking with the same
-- (tenant_id, idempotency_key) must violate the unique constraint (SI-3).
-- ============================================================================
do $t$
begin
  begin
    insert into public.bookings
      (tenant_id, reference, state, selection, pricing, slot_start, slot_end, idempotency_key)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'LMN-DUPKEY', 'draft', '{}', '{}',
       now() + interval '5 days', now() + interval '5 days 1 hour',
       'idem-key-tenant-a-0001');  -- already used by booking A1
    raise exception 'FAIL 7: duplicate (tenant_id, idempotency_key) was accepted';
  exception when unique_violation then
    raise notice 'PASS 7: duplicate idempotency_key violates unique constraint';
  end;
end;
$t$;

-- ============================================================================
-- ATTACK 8 — double-mint: a second payment with the same
-- (provider, provider_intent_id) must violate the unique constraint (SI-3).
-- ============================================================================
do $t$
begin
  begin
    insert into public.payments
      (tenant_id, booking_id, provider, provider_intent_id, state, amount, currency)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a0000000-0000-0000-0000-00000000b001',
       'mock', 'pi_mock_0001', 'succeeded', 16200, 'USD');  -- intent already recorded
    raise exception 'FAIL 8: duplicate provider_intent_id was accepted';
  exception when unique_violation then
    raise notice 'PASS 8: duplicate (provider, provider_intent_id) violates unique constraint';
  end;
end;
$t$;

-- ============================================================================
-- ATTACK 9 — Command Center views leak nothing to non-admins; admins get
-- aggregates only.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"owner-b@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.platform_business_stats;
  if n <> 0 then raise exception 'FAIL 9a: non-admin saw % platform_business_stats rows', n; end if;
  select count(*) into n from public.platform_economics;
  if n <> 0 then raise exception 'FAIL 9b: non-admin saw % platform_economics rows', n; end if;
  raise notice 'PASS 9a: command-center views are empty for non-admins';
end;
$t$;

reset role;
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"platform-admin@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.platform_business_stats;
  if n < 1 then raise exception 'FAIL 9c: platform admin saw no business stats'; end if;
  select coalesce(sum(merchant_gmv), 0) into n from public.platform_economics
    where currency = 'USD';
  if n <> 16200 then
    raise exception 'FAIL 9d: expected USD GMV 16200 (confirmed booking A1), got %', n;
  end if;
  raise notice 'PASS 9b: platform admin sees aggregates (USD GMV = %)', n;
end;
$t$;

reset role;

-- ============================================================================
-- ATTACK 10 — a tenant MEMBER (here STAFF) tries to fabricate financial state
-- directly on bookings, bypassing the server runtime. The guard trigger
-- lumin.guard_booking_client_write must forbid client INSERTs and freeze every
-- financial/identity column on UPDATE, while still permitting a legal
-- state-only transition. (SI-1 / SI-2)
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","email":"staff-a@example.test"}',
  true);
set local role authenticated;

-- 10a: direct INSERT of a fabricated confirmed booking → FORBIDDEN.
do $t$
begin
  begin
    insert into public.bookings
      (tenant_id, reference, state, selection, pricing, slot_start, slot_end,
       customer_id, idempotency_key)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'LMN-FORGE1', 'confirmed',
       '{"serviceId":"a0000000-0000-0000-0000-000000000001"}',
       '{"total":{"amount":99999999,"currency":"USD"}}',
       now() + interval '5 days', now() + interval '5 days 2 hours',
       'a0000000-0000-0000-0000-00000000c001', 'idem-forge-0001');
    raise exception 'FAIL 10a: member INSERT of a booking was accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm not like '%FORBIDDEN%' and sqlerrm not like '%server runtime%' then raise; end if;
      raise notice 'PASS 10a: member direct booking INSERT forbidden';
    when insufficient_privilege then
      raise notice 'PASS 10a: member direct booking INSERT denied by RLS';
  end;
end;
$t$;

-- 10b: UPDATE the pricing of an existing booking without a state change → FORBIDDEN.
do $t$
begin
  begin
    update public.bookings
      set pricing = '{"total":{"amount":1,"currency":"USD"}}'
      where id = 'a0000000-0000-0000-0000-00000000b001';
    raise exception 'FAIL 10b: member repriced a booking';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%FORBIDDEN%' and sqlerrm not like '%server-authoritative%' then raise; end if;
    raise notice 'PASS 10b: member reprice of a booking forbidden';
  end;
end;
$t$;

-- 10c: positive control — a member MAY advance state (confirmed → completed)
--      and edit notes; the guard leaves those columns free.
do $t$
declare
  v_state text;
begin
  update public.bookings
    set state = 'completed', notes = 'done on site'
    where id = 'a0000000-0000-0000-0000-00000000b001';
  select state into v_state from public.bookings
    where id = 'a0000000-0000-0000-0000-00000000b001';
  if v_state <> 'completed' then
    raise exception 'FAIL 10c: legal member transition did not apply (state=%)', v_state;
  end if;
  raise notice 'PASS 10c: member may still advance booking state (confirmed -> completed)';
end;
$t$;

reset role;

-- ============================================================================
-- ATTACK 11 — anonymous customer-identity tampering via create_booking_draft.
-- The tenant_id + a victim email are publicly guessable; the RPC must NOT let
-- anon overwrite an existing customer's stored name or phone. (SI-1)
-- ============================================================================
-- Seed a real customer with a phone (as the privileged fixture role).
insert into public.customers (id, tenant_id, name, email, phone) values
  ('a0000000-0000-0000-0000-00000000c777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Victim Real Name', 'victim@example.test', '+15551234567');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- anon fires the tampering attempt through the public RPC.
select public.create_booking_draft(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'anon-tamper-idem-key-0001',
  '{"serviceId":"a0000000-0000-0000-0000-000000000001"}'::jsonb,
  now() + interval '6 days', now() + interval '6 days 2 hours',
  '{"name":"ATTACKER OVERWRITE","email":"victim@example.test","phone":"+19999999999"}'::jsonb,
  null, null);

reset role;  -- read back as the privileged fixture role (RLS bypassed)

do $t$
declare
  v_name  text;
  v_phone text;
begin
  select name, phone into v_name, v_phone from public.customers
    where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and email = 'victim@example.test';
  if v_name <> 'Victim Real Name' then
    raise exception 'FAIL 11a: anon overwrote customer name to %', v_name;
  end if;
  if v_phone <> '+15551234567' then
    raise exception 'FAIL 11b: anon overwrote customer phone to %', v_phone;
  end if;
  raise notice 'PASS 11: anon draft cannot overwrite an existing customer identity';
end;
$t$;

-- ============================================================================
-- ATTACK 12 (RC-2 / RISK-1) — a tenant MEMBER (STAFF) tries to push a
-- pending_payment booking straight to 'confirmed' via a plain authenticated
-- UPDATE, fabricating a payment-confirmed booking with no payment. The guard
-- lumin.guard_booking_client_write must FORBID it (P0001): confirmation /
-- refund / payment states are server-authoritative. Positive controls: a member
-- MAY still complete (confirmed -> completed) and cancel (confirmed ->
-- cancelled) — the manual operational outcomes. (SI-1 / SI-2)
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","email":"staff-a@example.test"}',
  true);
set local role authenticated;

-- 12a: pending_payment -> confirmed by a member → FORBIDDEN, state unchanged.
do $t$
declare
  v_state text;
begin
  begin
    update public.bookings set state = 'confirmed'
      where id = 'a0000000-0000-0000-0000-00000000b0aa';  -- currently pending_payment
    raise exception 'FAIL 12a: member drove pending_payment -> confirmed';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%FORBIDDEN%' and sqlerrm not like '%server-authoritative%' then raise; end if;
    raise notice 'PASS 12a: member pending_payment -> confirmed forbidden';
  end;

  select state into v_state from public.bookings
    where id = 'a0000000-0000-0000-0000-00000000b0aa';
  if v_state <> 'pending_payment' then
    raise exception 'FAIL 12b: booking state changed to % after forbidden update', v_state;
  end if;
  raise notice 'PASS 12b: booking remains pending_payment after forbidden confirm';
end;
$t$;

-- 12c: positive control — a member MAY complete a confirmed booking.
do $t$
declare
  v_state text;
begin
  update public.bookings set state = 'completed'
    where id = 'a0000000-0000-0000-0000-00000000b0bb';  -- confirmed -> completed
  select state into v_state from public.bookings
    where id = 'a0000000-0000-0000-0000-00000000b0bb';
  if v_state <> 'completed' then
    raise exception 'FAIL 12c: member could not complete a confirmed booking (state=%)', v_state;
  end if;
  raise notice 'PASS 12c: member may complete (confirmed -> completed)';
end;
$t$;

-- 12d: positive control — a member MAY cancel a confirmed booking.
do $t$
declare
  v_state text;
begin
  update public.bookings set state = 'cancelled'
    where id = 'a0000000-0000-0000-0000-00000000b0cc';  -- confirmed -> cancelled
  select state into v_state from public.bookings
    where id = 'a0000000-0000-0000-0000-00000000b0cc';
  if v_state <> 'cancelled' then
    raise exception 'FAIL 12d: member could not cancel a confirmed booking (state=%)', v_state;
  end if;
  raise notice 'PASS 12d: member may cancel (confirmed -> cancelled)';
end;
$t$;

reset role;

-- ============================================================================
-- ATTACK 13 (RC-2 / RISK-2) — a PLATFORM_ADMIN no longer has routine raw-PII
-- access: SELECT on the base customers / bookings tables must return ZERO rows
-- (the SELECT policies are now member-only, and an admin is not a tenant
-- member). Command Center analytics still work: the SECURITY DEFINER aggregate
-- views return rows for the admin (>0) and ZERO rows for a non-admin.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"platform-admin@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  -- No raw PII: base tables return zero rows for the platform admin.
  select count(*) into n from public.customers;
  if n <> 0 then raise exception 'FAIL 13a: platform admin read % raw customer row(s)', n; end if;
  raise notice 'PASS 13a: platform admin has no raw-PII access to customers (0 rows)';

  select count(*) into n from public.bookings;
  if n <> 0 then raise exception 'FAIL 13b: platform admin read % raw booking row(s)', n; end if;
  raise notice 'PASS 13b: platform admin has no raw-PII access to bookings (0 rows)';

  -- Aggregates still flow to the admin via the definer views.
  select count(*) into n from public.platform_booking_stats;
  if n < 1 then raise exception 'FAIL 13c: platform admin saw no platform_booking_stats rows'; end if;
  select count(*) into n from public.platform_economics;
  if n < 1 then raise exception 'FAIL 13d: platform admin saw no platform_economics rows'; end if;
  raise notice 'PASS 13c: platform admin still sees aggregate analytics (definer views)';
end;
$t$;

reset role;

-- Non-admin (Tenant B owner) still sees zero aggregate rows (gate preserved).
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"owner-b@example.test"}',
  true);
set local role authenticated;

do $t$
declare
  n bigint;
begin
  select count(*) into n from public.platform_booking_stats;
  if n <> 0 then raise exception 'FAIL 13e: non-admin saw % platform_booking_stats rows', n; end if;
  select count(*) into n from public.platform_economics;
  if n <> 0 then raise exception 'FAIL 13f: non-admin saw % platform_economics rows', n; end if;
  raise notice 'PASS 13e: definer aggregate views remain empty for non-admins';
end;
$t$;

reset role;

do $t$
begin
  raise notice '';
  raise notice '=== ALL RLS ATTACK TESTS PASSED ===';
end;
$t$;

-- Leave no trace: fixtures and every side effect are discarded.
rollback;
