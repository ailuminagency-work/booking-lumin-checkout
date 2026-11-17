-- Booking Lumin staging schema attestation.
-- This row is an authenticated, server-read witness of the core schema
-- contract after 0099; it does not prove every historical migration is
-- present or unmodified. Full-chain replay remains a separate CI gate.
-- It is not exposed to anon/authenticated clients and contains no tenant data.
do $$
declare missing text[];
begin
 select array_agg(name order by name) into missing
 from (values
  ('public.tenants',to_regclass('public.tenants') is not null),
  ('public.services',to_regclass('public.services') is not null),
  ('public.bookings',to_regclass('public.bookings') is not null),
  ('public.payments',to_regclass('public.payments') is not null),
  ('public.availability_rules',to_regclass('public.availability_rules') is not null),
  ('public.availability_overrides',to_regclass('public.availability_overrides') is not null),
  ('public.capacity_holds',to_regclass('public.capacity_holds') is not null),
  ('public.resources',to_regclass('public.resources') is not null),
  ('public.resource_reservations',to_regclass('public.resource_reservations') is not null),
  ('public.confirm_succeeded_payment(uuid)',to_regprocedure('public.confirm_succeeded_payment(uuid)') is not null)
 ) required(name,present)
 where not present;
 if missing is not null then
  raise exception using message='MIGRATION_ATTESTATION_SCHEMA_MISMATCH';
 end if;
end
$$;
create table if not exists public.booking_lumin_schema_attestation(
 id boolean primary key default true check (id),
 migration_head text not null check (migration_head='0099_migration_attestation'),
 evidence text not null default 'core_schema_contract' check (evidence='core_schema_contract'),
 applied_at timestamptz not null default timezone('utc',now())
);

insert into public.booking_lumin_schema_attestation(id,migration_head,evidence)
 values(true,'0099_migration_attestation','core_schema_contract')
 on conflict(id) do update set migration_head=excluded.migration_head,evidence=excluded.evidence,applied_at=excluded.applied_at;

revoke all on table public.booking_lumin_schema_attestation from public,anon,authenticated;
grant select on table public.booking_lumin_schema_attestation to service_role;

