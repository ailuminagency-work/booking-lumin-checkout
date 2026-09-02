# supabase/ — clean-room schema, RLS, and attack tests

Reviewable SQL artifacts for a **future, fresh Supabase project**. The database
is the security boundary of Booking Lumin Checkout (SI-4): application code is
a convenience layer on top of what these files enforce.

> ## ⚠️ FRESH PROJECT ONLY — NEVER THE LEGACY PROJECT
>
> These migrations must only ever be applied to a **brand-new Supabase
> project with an empty `public` schema**. **Never run any file in this
> directory against the legacy project** (or any database containing
> inherited customers, bookings, credentials, or connections). The platform's
> clean-environment requirement (see `docs/SECURITY_INVARIANTS.md`) treats
> unknown legacy data and credentials as contamination, not assets (SI-6).
> `0007_rls.sql` in particular rewrites table privileges wholesale
> (`REVOKE ALL ... FROM anon, authenticated`) — running it anywhere but a
> fresh project would be destructive.

## Layout

| Path | Contents |
|---|---|
| `migrations/0001_extensions_and_helpers.sql` | pgcrypto, `lumin` schema, SECURITY DEFINER helpers (`is_platform_admin`, `is_tenant_member`, `tenant_role`, `tenant_is_active`, `touch_updated_at`) |
| `migrations/0002_tenants_and_identity.sql` | `tenants`, `tenant_members`, `platform_admins` (separate trust level, SI-9), `tenant_invitations` |
| `migrations/0003_services.sql` | Generalized catalog: `services` + items/addons/questions |
| `migrations/_deferred/` | **Not applied.** Designed-but-unwired tables (`resources`, `locations`, `service_areas`) held out of the RC-1 set until a reader/writer exists (acceptance finding DEF-1) |
| `migrations/0004_availability.sql` | `availability_rules`, `availability_overrides`, `scheduling_policies` |
| `migrations/0005_customers_bookings_payments.sql` | `customers`, `bookings` (+ state-machine triggers per `BOOKING_TRANSITIONS`), `booking_state_history`, `payments`, `refunds` |
| `migrations/0006_integrations_and_settings.sql` | `*_connections` (secret-free) + `*_connection_secrets` (service_role only), `checkout_settings`, `tenant_settings`, `audit_events` (append-only) |
| `migrations/0007_rls.sql` | **The security core**: FORCE RLS everywhere, deny-by-default policies, public-checkout catalog policies, `lumin.create_booking_draft` RPC |
| `migrations/0008_command_center_views.sql` | SECURITY INVOKER aggregate views for the Command Center (no PII; GMV never conflated with platform revenue) |
| `tests/rls_attack_tests.sql` | Attack simulation: cross-tenant reads/writes, anon probing, role escalation, illegal transitions, idempotency/double-mint duplicates |
| `tests/local_harness.sql` | Optional stub (roles + `auth` schema) for dry runs on plain Postgres 15+. **Not for Supabase.** |

## Applying to a fresh Supabase project

With the Supabase CLI (recommended — it applies `migrations/` in filename
order):

```sh
supabase link --project-ref <NEW_PROJECT_REF>   # the fresh project, nothing else
supabase db push
```

Or with plain `psql`, strictly in order:

```sh
export DATABASE_URL='postgresql://postgres:...@db.<NEW_PROJECT_REF>.supabase.co:5432/postgres'
for f in supabase/migrations/000{1,2,3,4,5,6,7,8}_*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Before applying, verify you are pointed at the fresh project:
`select count(*) from pg_tables where schemaname = 'public';` must return `0`.

Notes:

- Order matters: `0007_rls.sql` assumes every table from 0002–0006 exists;
  `0001` must run first (helpers are referenced by every policy).
- The migrations assume standard Supabase roles (`anon`, `authenticated`,
  `service_role` with BYPASSRLS) and the `auth` schema — all present on any
  fresh project.
- RLS is `FORCE`d on every table. The SECURITY DEFINER helpers and triggers
  are owned by the migration role (`postgres`), which on Supabase holds
  BYPASSRLS — the standard Supabase trust setup.
- The public checkout calls the RPC `public.create_booking_draft(...)`
  (thin wrapper over `lumin.create_booking_draft`). Pricing and payment
  finalization happen only in the trusted server runtime (edge functions,
  `service_role`) — never as `anon`.

## Running the attack tests

Against a fresh project (after all migrations; **never the legacy project**):

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_attack_tests.sql
```

The script simulates JWTs with the standard Supabase RLS-testing technique
(`set_config('request.jwt.claims', ..., true)` + `SET LOCAL ROLE`), runs every
attack inside a single transaction, and **rolls back** — no fixture data
survives. Success = exit code 0 and the final line
`=== ALL RLS ATTACK TESTS PASSED ===`; any repelled-attack failure aborts the
script with a `FAIL n:` exception.

### Local dry run without Supabase (optional, e.g. CI)

```sh
createdb lumin_rls_test
psql -d lumin_rls_test -v ON_ERROR_STOP=1 -f supabase/tests/local_harness.sql
for f in supabase/migrations/*.sql; do
  psql -d lumin_rls_test -v ON_ERROR_STOP=1 -f "$f"
done
psql -d lumin_rls_test -v ON_ERROR_STOP=1 -f supabase/tests/rls_attack_tests.sql
```

## RLS coverage

Every table: RLS **enabled + forced**, deny-by-default (a role without a
matching policy gets zero rows / no writes). `service_role` (trusted server
runtime) bypasses RLS by design; `postgres` is the migration/dashboard role.

| Table | anon | authenticated (tenant member) | BUSINESS_OWNER extra | platform admin | writes for clients |
|---|---|---|---|---|---|
| `tenants` | — | SELECT own tenant | — | SELECT all | none (service_role only) |
| `tenant_members` | — | SELECT self + own-tenant roster | INSERT/UPDATE/DELETE | SELECT all | owner only |
| `platform_admins` | — | SELECT own row only | — | SELECT own row | none (service_role only) |
| `tenant_invitations` | — | SELECT own tenant | INSERT/UPDATE/DELETE | SELECT all | owner only |
| `services` | SELECT active (active tenant) | SELECT/INSERT/UPDATE own tenant | DELETE | SELECT all | member |
| `service_items` / `service_addons` / `service_questions` | SELECT (of active services) | SELECT/INSERT/UPDATE own tenant | DELETE | SELECT all | member |
| `availability_rules` / `availability_overrides` / `scheduling_policies` | SELECT (active tenant/service) | SELECT/INSERT/UPDATE own tenant | DELETE | SELECT all | member |
| `customers` | — | SELECT/INSERT/UPDATE own tenant | DELETE | SELECT all | member |
| `bookings` | — (drafts via RPC only) | SELECT/INSERT/UPDATE own tenant (state machine trigger-enforced) | DELETE | SELECT all | member |
| `booking_state_history` | — | SELECT own tenant | — | SELECT all | none (trigger-written only) |
| `payments`, `refunds` | — | SELECT own tenant | — | SELECT all | none (service_role only, SI-2) |
| `*_connections` (4) | — | SELECT own tenant (status/config, no secrets) | INSERT/UPDATE/DELETE | SELECT all | owner only |
| `*_connection_secrets` (4) | — | **no access** | **no access** | **no access** | none — service_role only (SI-5) |
| `checkout_settings` | SELECT (active tenant) | SELECT own tenant | INSERT/UPDATE/DELETE | SELECT all | owner only |
| `tenant_settings` | — | SELECT own tenant | INSERT/UPDATE/DELETE | SELECT all | owner only |
| `audit_events` | — | — (staff: no) | SELECT own tenant | SELECT all | none; append-only for every role (UPDATE/DELETE revoked incl. service_role) |
| views `platform_*` (4) | — | zero rows | zero rows | SELECT aggregates | n/a (views) |
