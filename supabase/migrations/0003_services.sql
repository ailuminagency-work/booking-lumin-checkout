-- ============================================================================
-- 0003_services.sql
-- The generalized service catalog: one Service schema powers every vertical
-- via archetypes (simple | cart | configurable | rental) — flow presets over
-- shared primitives, never separate engines (ServiceConfigContract v1).
--
-- Money: ALL monetary columns are bigint integer minor units (MoneyContract).
-- Floating point money is forbidden platform-wide.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- services
-- ----------------------------------------------------------------------------
create table public.services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  archetype        text not null
                   check (archetype in ('simple', 'cart', 'configurable', 'rental')),
  name             text not null check (length(name) >= 1),
  description      text not null default '',
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Base price in minor units; 0 for pure-cart services.
  base_price       bigint not null default 0 check (base_price >= 0),
  -- Appointment duration for scheduling (non-rental archetypes).
  duration_minutes integer not null default 60 check (duration_minutes >= 5),
  -- Tax rate in basis points applied to the taxable subtotal (0..10000).
  tax_rate_bp      integer not null default 0 check (tax_rate_bp between 0 and 10000),
  -- RentalConfig (rental archetype): {periodMinutes, pricePerPeriod,
  -- minPeriods, maxPeriods, depositAmount} — minor units inside, validated by
  -- the contracts layer; present only for archetype = 'rental'.
  rental           jsonb,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (archetype <> 'rental' or rental is not null)
);

create index services_tenant_id_idx     on public.services (tenant_id);
create index services_tenant_active_idx on public.services (tenant_id, active);

create trigger services_touch_updated_at
  before update on public.services
  for each row execute function lumin.touch_updated_at();

comment on table public.services is
  'Generalized service config (ServiceConfigContract v1). Archetypes are flow presets over shared primitives; all money is bigint minor units.';

-- ----------------------------------------------------------------------------
-- service_items — selectable line items (cart archetype), priced per quantity.
-- item_key mirrors ServiceItem.id (a service-scoped string key).
-- ----------------------------------------------------------------------------
create table public.service_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  service_id  uuid not null references public.services (id) on delete cascade,
  item_key    text not null check (length(item_key) >= 1),
  name        text not null check (length(name) >= 1),
  description text,
  unit_price  bigint not null check (unit_price >= 0),
  min_qty     integer not null default 0 check (min_qty >= 0),
  max_qty     integer not null default 99 check (max_qty >= 1),
  sort_order  integer not null default 0,
  unique (service_id, item_key),
  check (max_qty >= min_qty)
);

create index service_items_tenant_id_idx  on public.service_items (tenant_id);
create index service_items_service_id_idx on public.service_items (service_id);

-- ----------------------------------------------------------------------------
-- service_addons — optional extras on top of the base/items total.
-- ----------------------------------------------------------------------------
create table public.service_addons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  service_id  uuid not null references public.services (id) on delete cascade,
  addon_key   text not null check (length(addon_key) >= 1),
  name        text not null check (length(name) >= 1),
  description text,
  price       bigint not null check (price >= 0),
  sort_order  integer not null default 0,
  unique (service_id, addon_key)
);

create index service_addons_tenant_id_idx  on public.service_addons (tenant_id);
create index service_addons_service_id_idx on public.service_addons (service_id);

-- ----------------------------------------------------------------------------
-- service_questions — configuration questions (configurable archetype).
-- choices: jsonb array of QuestionChoice {id, label, priceDelta,
-- priceMultiplierBp} — multipliers are basis points (10000 = x1.0) so pricing
-- stays in integers. For kind='quantity': unit_price/min_qty/max_qty apply.
-- ----------------------------------------------------------------------------
create table public.service_questions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  service_id   uuid not null references public.services (id) on delete cascade,
  question_key text not null check (length(question_key) >= 1),
  prompt       text not null check (length(prompt) >= 1),
  kind         text not null check (kind in ('single_choice', 'multi_choice', 'quantity')),
  required     boolean not null default true,
  choices      jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  unit_price   bigint check (unit_price is null or unit_price >= 0),
  min_qty      integer check (min_qty is null or min_qty >= 0),
  max_qty      integer check (max_qty is null or max_qty >= 1),
  sort_order   integer not null default 0,
  unique (service_id, question_key),
  check (kind <> 'quantity' or unit_price is not null)
);

create index service_questions_tenant_id_idx  on public.service_questions (tenant_id);
create index service_questions_service_id_idx on public.service_questions (service_id);

-- Note: resources, locations, and service_areas are deferred domain surface —
-- see supabase/migrations/_deferred/0001_resources_locations_service_areas.sql.
-- They are not part of the RC-1 applied set because nothing reads or writes
-- them yet (RC-1 acceptance finding DEF-1).
