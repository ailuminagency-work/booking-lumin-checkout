-- ============================================================================
-- 0004_availability.sql
-- Availability inputs (AvailabilityContract v1). The AvailabilityEngine in
-- @lumin/core consumes these rows and FAILS CLOSED: a slot that cannot be
-- proven free is unavailable (SI-7). All rule times are minutes-from-midnight
-- in the TENANT's timezone; slots exchanged over APIs are UTC instants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- availability_rules — weekly recurring windows. service_id NULL applies to
-- all services of the tenant. weekday: 0 = Sunday … 6 = Saturday.
-- ----------------------------------------------------------------------------
create table public.availability_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  service_id   uuid references public.services (id) on delete cascade,
  weekday      integer not null check (weekday between 0 and 6),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute   integer not null check (end_minute between 1 and 1440),
  -- Concurrent bookings this window supports (crew count, bays, rooms…).
  capacity     integer not null default 1 check (capacity >= 1),
  created_at   timestamptz not null default now(),
  check (end_minute > start_minute)
);

create index availability_rules_tenant_id_idx on public.availability_rules (tenant_id);
create index availability_rules_lookup_idx
  on public.availability_rules (tenant_id, service_id, weekday);

-- ----------------------------------------------------------------------------
-- availability_overrides — date-specific exceptions in the tenant timezone.
--   kind = 'closed': the date is fully closed (window columns must be NULL).
--   kind = 'open'  : replacement window for that date (start/end required).
-- ----------------------------------------------------------------------------
create table public.availability_overrides (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  service_id   uuid references public.services (id) on delete cascade,
  date         date not null,
  kind         text not null check (kind in ('closed', 'open')),
  start_minute integer check (start_minute is null or start_minute between 0 and 1439),
  end_minute   integer check (end_minute is null or end_minute between 1 and 1440),
  capacity     integer check (capacity is null or capacity >= 1),
  created_at   timestamptz not null default now(),
  check (
    (kind = 'closed' and start_minute is null and end_minute is null and capacity is null)
    or
    (kind = 'open' and start_minute is not null and end_minute is not null
       and end_minute > start_minute)
  )
);

create index availability_overrides_tenant_id_idx on public.availability_overrides (tenant_id);
create index availability_overrides_lookup_idx
  on public.availability_overrides (tenant_id, date);

-- ----------------------------------------------------------------------------
-- scheduling_policies — lead time / horizon / slot grid (SchedulingPolicy).
-- One policy per (tenant, service) pair; service_id NULL is the tenant-wide
-- default. UNIQUE NULLS NOT DISTINCT (PG15) makes the NULL slot unique too.
-- ----------------------------------------------------------------------------
create table public.scheduling_policies (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  service_id            uuid references public.services (id) on delete cascade,
  -- Minimum notice before a slot may start.
  lead_time_minutes     integer not null default 0 check (lead_time_minutes >= 0),
  -- How far ahead booking is allowed.
  horizon_days          integer not null default 60 check (horizon_days >= 1),
  -- Slot grid granularity.
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes >= 5),
  created_at            timestamptz not null default now(),
  unique nulls not distinct (tenant_id, service_id)
);

create index scheduling_policies_tenant_id_idx on public.scheduling_policies (tenant_id);
