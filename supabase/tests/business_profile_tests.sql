-- ============================================================================
-- business_profile_tests.sql — one-tenant-one-profile activation (P1, Lane D).
--
-- Proves lumin.activate_business_profile (via its public wrapper):
--   1. an OWNER activates once → success, profile_key persisted;
--   2. SET-ONCE — a second activation (switch OR same value) is rejected;
--   3. a NON-OWNER (staff, or another tenant's owner) is DENIED;
--   4. an INVALID profile value is rejected;
--   5. anon cannot execute the RPC at all (authenticated-only grant);
--   6. RLS stays FORCED on tenants and the RPC is the ONLY writer of
--      profile_key (a direct UPDATE by an owner is denied).
--
-- Run against a FRESH project with all migrations applied, as a role that can
-- SET ROLE to authenticated/anon (local dry run: superuser after
-- tests/local_harness.sql):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/business_profile_tests.sql
--
-- Everything runs inside ONE transaction, ROLLED BACK at the end. JWTs are
-- simulated with set_config('request.jwt.claims', …, true) + SET LOCAL ROLE.
-- If the last line printed is "ALL BUSINESS PROFILE TESTS PASSED", all passed.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Helper: assert a statement is rejected with an exact sqlstate.
create function pg_temp.bp_reject(q text, expected text) returns void
language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'FAIL wrong sqlstate % (expected %) for %: %', sqlstate, expected, q, sqlerrm;
  end;
  raise exception 'FAIL accepted (expected % rejection): %', expected, q;
end $$;

-- ----------------------------------------------------------------------------
-- Fixtures (privileged migration role; RLS bypassed here).
--   Tenant A: owner-a + staff-a. Tenant B: owner-b.
-- ----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'staff-a@example.test'),
  ('b1111111-1111-1111-1111-111111111111', 'owner-b@example.test');

insert into public.tenants (id, name, slug, timezone, currency, status) values
  ('aaaa0000-0000-0000-0000-000000000001', 'Tenant A', 'bp-tenant-a', 'America/Chicago', 'USD', 'active'),
  ('bbbb0000-0000-0000-0000-000000000001', 'Tenant B', 'bp-tenant-b', 'Europe/Amsterdam', 'EUR', 'active');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaa0000-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'BUSINESS_OWNER'),
  ('aaaa0000-0000-0000-0000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'BUSINESS_STAFF'),
  ('bbbb0000-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111111', 'BUSINESS_OWNER');

-- Sanity: both tenants start with NO profile.
do $t$
begin
  if exists (select 1 from public.tenants where profile_key is not null) then
    raise exception 'FAIL 0: fixture tenants must start with NULL profile_key';
  end if;
  raise notice 'PASS 0: fixtures start unactivated';
end $t$;

-- ----------------------------------------------------------------------------
-- TEST 1 — owner-a activates CLEANING once (success + persistence).
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated","email":"owner-a@example.test"}', true);
set local role authenticated;

do $t$
declare v text; k text;
begin
  v := public.activate_business_profile('aaaa0000-0000-0000-0000-000000000001', 'CLEANING');
  if v is distinct from 'CLEANING' then raise exception 'FAIL 1a: returned %', v; end if;
  select profile_key into k from public.tenants where id = 'aaaa0000-0000-0000-0000-000000000001';
  if k is distinct from 'CLEANING' then raise exception 'FAIL 1b: profile_key persisted as %', k; end if;
  raise notice 'PASS 1: owner-a activated CLEANING (persisted)';
end $t$;

-- ----------------------------------------------------------------------------
-- TEST 2 — SET-ONCE: a second activation is rejected (switch AND same value).
-- ----------------------------------------------------------------------------
do $t$
begin
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('aaaa0000-0000-0000-0000-000000000001','DETAILING')$q$, '55000');
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('aaaa0000-0000-0000-0000-000000000001','CLEANING')$q$, '55000');
  -- The stored value is unchanged after the rejected attempts.
  if (select profile_key from public.tenants where id = 'aaaa0000-0000-0000-0000-000000000001')
       is distinct from 'CLEANING' then
    raise exception 'FAIL 2c: profile_key mutated by a rejected activation';
  end if;
  raise notice 'PASS 2: set-once — second activation rejected, value immutable';
end $t$;

-- ----------------------------------------------------------------------------
-- TEST 3a — staff-a (member but NOT owner) is denied on tenant A.
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated","email":"staff-a@example.test"}', true);
set local role authenticated;

do $t$
begin
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('aaaa0000-0000-0000-0000-000000000001','DETAILING')$q$, '42501');
  raise notice 'PASS 3a: BUSINESS_STAFF denied activation';
end $t$;

-- ----------------------------------------------------------------------------
-- TEST 3b — owner-b (owner of B, not a member of A) is denied on tenant A.
-- TEST 4  — invalid profile value is rejected (on B, which owner-b DOES own).
-- Positive control: owner-b activates B with a valid profile → success.
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated","email":"owner-b@example.test"}', true);
set local role authenticated;

do $t$
declare v text;
begin
  -- 3b: cross-tenant owner denied on A.
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('aaaa0000-0000-0000-0000-000000000001','JUNK_REMOVAL')$q$, '42501');
  -- 4: invalid value rejected on B (owner-b's own tenant) — proves value
  -- validation, not just the ownership gate, blocks it.
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('bbbb0000-0000-0000-0000-000000000001','NOT_A_PROFILE')$q$, '22023');
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('bbbb0000-0000-0000-0000-000000000001','cleaning')$q$, '22023');
  -- Positive control: a valid activation on B still succeeds.
  v := public.activate_business_profile('bbbb0000-0000-0000-0000-000000000001', 'EQUIPMENT_RENTAL');
  if v is distinct from 'EQUIPMENT_RENTAL' then raise exception 'FAIL 4c: control returned %', v; end if;
  raise notice 'PASS 3b/4: cross-tenant owner denied; invalid value rejected; valid activation succeeds';
end $t$;

-- ----------------------------------------------------------------------------
-- TEST 5 — anon cannot execute the RPC (authenticated-only grant).
-- ----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $t$
begin
  perform pg_temp.bp_reject(
    $q$select public.activate_business_profile('bbbb0000-0000-0000-0000-000000000001','CLEANING')$q$, '42501');
  perform pg_temp.bp_reject(
    $q$select lumin.activate_business_profile('bbbb0000-0000-0000-0000-000000000001','CLEANING')$q$, '42501');
  raise notice 'PASS 5: anon cannot execute the activation RPC';
end $t$;

-- ----------------------------------------------------------------------------
-- TEST 6 — RLS stays FORCED and the RPC is the ONLY writer of profile_key:
-- a member/owner has no direct UPDATE path (no grant, forced RLS).
-- ----------------------------------------------------------------------------
reset role;
do $t$
begin
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.tenants'::regclass) then
    raise exception 'FAIL 6a: RLS is not forced on public.tenants';
  end if;
  if has_table_privilege('authenticated', 'public.tenants', 'UPDATE') then
    raise exception 'FAIL 6b: authenticated unexpectedly holds UPDATE on tenants';
  end if;
  raise notice 'PASS 6a/b: RLS forced on tenants; authenticated has no UPDATE grant';
end $t$;

select set_config('request.jwt.claims',
  '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated","email":"owner-b@example.test"}', true);
set local role authenticated;

do $t$
begin
  -- Owner-b cannot silently switch B's profile via a direct table write.
  perform pg_temp.bp_reject(
    $q$update public.tenants set profile_key = 'CLEANING' where id = 'bbbb0000-0000-0000-0000-000000000001'$q$, '42501');
  raise notice 'PASS 6c: direct UPDATE of profile_key by an owner is denied (RPC is the only writer)';
end $t$;

reset role;

do $t$
begin
  raise notice '';
  raise notice '=== ALL BUSINESS PROFILE TESTS PASSED ===';
end $t$;

-- Leave no trace.
rollback;
