-- Booking Lumin security-advisor hardening.
--
-- These functions are intentionally split between public SQL wrappers and
-- internal trigger functions. Their callers already enforce the service-role
-- or trigger boundary; this migration only pins name resolution so a mutable
-- session search_path cannot redirect an unqualified lookup. It does not
-- change function bodies, grants, tenant predicates, or payment authority.
begin;

alter function public.create_booking_draft(
  uuid, text, jsonb, timestamptz, timestamptz, jsonb, jsonb, text
) set search_path = pg_catalog;

alter function public.reserve_capacity(
  uuid, uuid, timestamptz, timestamptz, uuid, integer, interval
) set search_path = pg_catalog;

alter function public.consume_hold(uuid) set search_path = pg_catalog;
alter function public.release_hold(uuid) set search_path = pg_catalog;

alter function public.reserve_resource(
  uuid, uuid, timestamptz, timestamptz, uuid, interval
) set search_path = pg_catalog;

alter function public.consume_resource_holds(uuid) set search_path = pg_catalog;
alter function public.release_resource_holds(uuid) set search_path = pg_catalog;

alter function lumin.enforce_booking_transition() set search_path = pg_catalog;
alter function lumin.guard_booking_client_write() set search_path = pg_catalog;
alter function lumin.touch_updated_at() set search_path = pg_catalog;

-- Advance the existing attestation witness without replaying or duplicating
-- migrations 0094-0099. The check constraint keeps a stale 0099 witness from
-- being mistaken for a database that has received this hardening batch.
alter table public.booking_lumin_schema_attestation
  drop constraint if exists booking_lumin_schema_attestation_migration_head_check;
update public.booking_lumin_schema_attestation
   set migration_head = '0100_security_advisor_hardening',
       applied_at = timezone('utc', now())
 where id = true;
alter table public.booking_lumin_schema_attestation
  add constraint booking_lumin_schema_attestation_migration_head_check
  check (migration_head = '0100_security_advisor_hardening');

commit;
