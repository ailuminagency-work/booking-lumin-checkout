-- Booking Lumin staging schema attestation.
-- This row is an authenticated, server-read witness of the migration chain;
-- it is not exposed to anon/authenticated clients and contains no tenant data.
create table if not exists public.booking_lumin_schema_attestation(
 id boolean primary key default true check (id),
 migration_head text not null check (migration_head='0099_migration_attestation'),
 applied_at timestamptz not null default timezone('utc',now())
);

insert into public.booking_lumin_schema_attestation(id,migration_head)
 values(true,'0099_migration_attestation')
 on conflict(id) do update set migration_head=excluded.migration_head,applied_at=excluded.applied_at;

revoke all on table public.booking_lumin_schema_attestation from public,anon,authenticated;
grant select on table public.booking_lumin_schema_attestation to service_role;

