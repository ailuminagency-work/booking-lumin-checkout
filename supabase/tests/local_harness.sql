-- ============================================================================
-- local_harness.sql — OPTIONAL, for local vanilla-Postgres dry runs ONLY.
--
-- A fresh Supabase project already provides everything this file creates
-- (anon / authenticated / service_role roles, the auth schema, auth.users,
-- auth.uid()). DO NOT run this against a Supabase project — it is a no-op
-- guarded stub used to verify the migrations + attack tests on a plain
-- Postgres 15+ instance (e.g. in CI) before a Supabase project exists.
--
-- Usage (plain Postgres, superuser):
--   psql -d lumin_test -f tests/local_harness.sql
--   psql -d lumin_test -f migrations/0001_... (in order)
--   psql -d lumin_test -f tests/rls_attack_tests.sql
-- ============================================================================

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$do$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;

do $do$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id         uuid primary key,
      email      text,
      created_at timestamptz not null default now()
    );
  end if;
end;
$do$;

-- Supabase-compatible auth.uid(): the 'sub' claim of the request JWT.
do $do$
begin
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $fn$
      select nullif(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
        ''
      )::uuid
    $fn$;
  end if;
end;
$do$;

grant usage on schema auth to anon, authenticated, service_role;
