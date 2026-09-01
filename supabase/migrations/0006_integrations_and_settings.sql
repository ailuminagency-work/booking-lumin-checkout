-- ============================================================================
-- 0006_integrations_and_settings.sql
-- Per-tenant integration connections (payment / calendar / notification /
-- webhook), their SECRETS in separate service_role-only tables, checkout and
-- tenant settings, and the append-only audit_events log.
--
-- Every connection starts 'not_connected' (SI-12); production integrations
-- connect only after security gates pass (SI-13). Credentials live ONLY in
-- *_connection_secrets tables which carry NO client policies at all in 0007
-- — they are unreachable by anon/authenticated, satisfying SI-5/SI-8: the
-- main connection tables are secret-free by construction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- payment_connections / calendar_connections / notification_connections /
-- webhook_connections — identical shape (IntegrationAdapterContract v1).
-- config holds NON-SECRET provider config only (e.g. publishable key,
-- account label, webhook destination URL). Secrets go in the secrets tables.
-- ----------------------------------------------------------------------------
create table public.payment_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  provider      text not null check (length(provider) >= 1),
  status        text not null default 'not_connected'
                check (status in ('not_connected', 'connected', 'error', 'revoked')),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_check_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table public.calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  provider      text not null check (length(provider) >= 1),
  status        text not null default 'not_connected'
                check (status in ('not_connected', 'connected', 'error', 'revoked')),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_check_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table public.notification_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  provider      text not null check (length(provider) >= 1),
  status        text not null default 'not_connected'
                check (status in ('not_connected', 'connected', 'error', 'revoked')),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_check_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table public.webhook_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  provider      text not null check (length(provider) >= 1),
  status        text not null default 'not_connected'
                check (status in ('not_connected', 'connected', 'error', 'revoked')),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_check_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider)
);

create index payment_connections_tenant_id_idx      on public.payment_connections (tenant_id);
create index calendar_connections_tenant_id_idx     on public.calendar_connections (tenant_id);
create index notification_connections_tenant_id_idx on public.notification_connections (tenant_id);
create index webhook_connections_tenant_id_idx      on public.webhook_connections (tenant_id);

create trigger payment_connections_touch_updated_at
  before update on public.payment_connections
  for each row execute function lumin.touch_updated_at();
create trigger calendar_connections_touch_updated_at
  before update on public.calendar_connections
  for each row execute function lumin.touch_updated_at();
create trigger notification_connections_touch_updated_at
  before update on public.notification_connections
  for each row execute function lumin.touch_updated_at();
create trigger webhook_connections_touch_updated_at
  before update on public.webhook_connections
  for each row execute function lumin.touch_updated_at();

-- ----------------------------------------------------------------------------
-- *_connection_secrets — encrypted provider credentials, one row per
-- connection. RLS in 0007 enables+forces RLS with ZERO policies here, and no
-- table privileges are granted to anon/authenticated: only service_role (the
-- trusted server runtime) can ever read or write these rows (SI-5, SI-8).
-- credentials_encrypted is ciphertext (application-layer encryption before
-- insert); the database never stores plaintext provider secrets.
-- ----------------------------------------------------------------------------
create table public.payment_connection_secrets (
  connection_id         uuid primary key references public.payment_connections (id) on delete cascade,
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  credentials_encrypted bytea not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.calendar_connection_secrets (
  connection_id         uuid primary key references public.calendar_connections (id) on delete cascade,
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  credentials_encrypted bytea not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.notification_connection_secrets (
  connection_id         uuid primary key references public.notification_connections (id) on delete cascade,
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  credentials_encrypted bytea not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.webhook_connection_secrets (
  connection_id         uuid primary key references public.webhook_connections (id) on delete cascade,
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  credentials_encrypted bytea not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index payment_connection_secrets_tenant_id_idx      on public.payment_connection_secrets (tenant_id);
create index calendar_connection_secrets_tenant_id_idx     on public.calendar_connection_secrets (tenant_id);
create index notification_connection_secrets_tenant_id_idx on public.notification_connection_secrets (tenant_id);
create index webhook_connection_secrets_tenant_id_idx      on public.webhook_connection_secrets (tenant_id);

create trigger payment_connection_secrets_touch_updated_at
  before update on public.payment_connection_secrets
  for each row execute function lumin.touch_updated_at();
create trigger calendar_connection_secrets_touch_updated_at
  before update on public.calendar_connection_secrets
  for each row execute function lumin.touch_updated_at();
create trigger notification_connection_secrets_touch_updated_at
  before update on public.notification_connection_secrets
  for each row execute function lumin.touch_updated_at();
create trigger webhook_connection_secrets_touch_updated_at
  before update on public.webhook_connection_secrets
  for each row execute function lumin.touch_updated_at();

comment on table public.payment_connection_secrets is
  'service_role only (no RLS policies, no client grants). Provider credentials never reach the browser (SI-5).';
comment on table public.calendar_connection_secrets is
  'service_role only (no RLS policies, no client grants). Provider credentials never reach the browser (SI-5).';
comment on table public.notification_connection_secrets is
  'service_role only (no RLS policies, no client grants). Provider credentials never reach the browser (SI-5).';
comment on table public.webhook_connection_secrets is
  'service_role only (no RLS policies, no client grants). Provider credentials never reach the browser (SI-5).';

-- ----------------------------------------------------------------------------
-- checkout_settings — public-facing checkout branding and flow config.
-- branding: colors / logo url / copy. flow: step configuration. Both
-- NON-SECRET by definition: anon may SELECT this table (0007).
-- ----------------------------------------------------------------------------
create table public.checkout_settings (
  tenant_id  uuid primary key references public.tenants (id) on delete cascade,
  branding   jsonb not null default '{}'::jsonb check (jsonb_typeof(branding) = 'object'),
  flow       jsonb not null default '{}'::jsonb check (jsonb_typeof(flow) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger checkout_settings_touch_updated_at
  before update on public.checkout_settings
  for each row execute function lumin.touch_updated_at();

comment on table public.checkout_settings is
  'Anon-readable checkout branding/flow. Must never contain secrets — it is served to the public checkout.';

-- ----------------------------------------------------------------------------
-- tenant_settings — private tenant preferences (portal-facing).
-- ----------------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id  uuid primary key references public.tenants (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenant_settings_touch_updated_at
  before update on public.tenant_settings
  for each row execute function lumin.touch_updated_at();

-- ----------------------------------------------------------------------------
-- audit_events — append-only platform audit log (EventContract v1).
-- name is CHECKed against the canonical EVENT_NAMES list; renames there are
-- breaking changes, so extend this CHECK in a new migration when the contract
-- gains names. data must be redacted/PII-minimized (SI-11) — enforced by the
-- writing runtime, documented here.
-- tenant_id NULL = platform-level event; ON DELETE SET NULL preserves the
-- audit trail past tenant deletion.
-- ----------------------------------------------------------------------------
create table public.audit_events (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete set null,
  name      text not null check (name in (
    'booking.created',
    'booking.pending_payment',
    'booking.confirmed',
    'booking.completed',
    'booking.cancelled',
    'booking.refunded',
    'booking.failed',
    'payment.intent_created',
    'payment.succeeded',
    'payment.failed',
    'payment.refunded',
    'integration.connected',
    'integration.disconnected',
    'integration.delivery_failed',
    'tenant.created',
    'tenant.member_invited',
    'tenant.settings_updated'
  )),
  data      jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  at        timestamptz not null default now()
);

create index audit_events_tenant_at_idx on public.audit_events (tenant_id, at desc);
create index audit_events_name_idx      on public.audit_events (name);

comment on table public.audit_events is
  'Append-only (UPDATE/DELETE revoked from every API role in 0007). data is redacted/PII-minimized before insert (SI-11).';
