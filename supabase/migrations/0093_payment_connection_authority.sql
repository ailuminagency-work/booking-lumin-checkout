-- 0093 payment connection authority.
--
-- Step 2 of docs/P1_PAYMENT_CONNECTION_DECISION.md. 0089 closed the client write
-- path to public.payment_connections and said what would replace it: "service_role
-- SECURITY DEFINER RPCs that verify with the provider before recording". This is
-- that replacement, and nothing more -- it adds no route, needs no credential, and
-- reaches no network.
--
-- NO CREDENTIAL IS STORED BY THIS MIGRATION, FOR PAYMENTS, EVER. Stripe Connect
-- Standard accounts are charged with DIRECT CHARGES: the platform secret plus a
-- `Stripe-Account: acct_...` header. An account id is an IDENTIFIER, not a bearer
-- credential -- nothing can be done with it without the platform secret, which
-- lives only in the server runtime's secret store. So public.payment_connection_
-- secrets stays EMPTY for payments and the credential-encryption subsystem this
-- repository deliberately lacks never has to be invented. Three standing rules (no
-- hardcoded tenant secret, no customer pasting a secret key, no stored tenant
-- payment passwords) are satisfied structurally rather than by policy.
--
-- WHAT AUTOMATION MAY AND MAY NOT DO. The standing rule is that AI must never
-- change a merchant connection without owner action. A design that gave automation
-- a verb able to move a connection connected -> error was rejected for exactly
-- this: a transient provider blip would take a tenant's checkout offline with
-- nobody deciding. The line this migration draws instead:
--
--   * STATUS IS DERIVED, NEVER PASSED. A caller supplies what the provider SAID;
--     lumin.payment_connection_status decides. There is no verb anywhere that sets
--     a status directly, so there is nothing for a caller to assert.
--   * THE DERIVATION CANNOT PRODUCE 'error'. Proven below over the whole 4 x 2 x 7
--     cross product. A restricted merchant -- connected, looks fine, cannot charge
--     -- stays 'connected' and is surfaced as a HEALTH verdict instead, which is
--     why 'error' is unnecessary rather than merely unused.
--   * 'error' AND 'revoked' ARE TERMINAL FOR AUTOMATION, AND ONLY FOR AUTOMATION.
--     lumin.payment_connection_status returns either unchanged, so
--     public.observe_payment_connection -- which takes no actor -- can never bring
--     a dead connection back. public.record_payment_connection restarts the
--     derivation from 'not_connected', because it requires BUSINESS_OWNER and a
--     fresh handoff: a person reconnecting is the recovery path, and it must exist.
--     Automation being able to revoke with no way back would be a permanent brick,
--     which is the very thing the standing rule forbids.
--   * AUTOMATION MAY RECORD 'revoked' ONLY ON THE PROVIDER'S OWN WORD -- a reason
--     of credentials_invalid or account_rejected, which means the connection is
--     already dead out there. Recording that is not a decision.
--   * AN INCONCLUSIVE ANSWER NEVER ARRIVES HERE. A 5xx, a timeout or a non-JSON
--     body throws PROVIDER_UNAVAILABLE in the adapter and no RPC is called, so the
--     row keeps its status. That is enforced on the adapter side (see
--     packages/adapters/src/mockPaymentConnection.ts and its tests); this migration
--     simply has no way to express "the provider did not answer".
--
-- REVERT IS FORWARD-ONLY. To stand this down, a later migration revokes EXECUTE on
-- the four RPCs from service_role. Never a DROP: every migration must still replay
-- from zero on an empty database. That lesson is 0092's.
begin;

-- ----------------------------------------------------------------------------
-- Provider-reported facts on the connection row.
--
-- All additive and all nullable-or-defaulted, so the existing rows (and the RLS
-- attack fixture's two) stay legal. Deliberately NOT added: a constraint tying
-- status='connected' to account_id being present. The attack fixture holds exactly
-- such a row, and an attack suite you had to edit is an attack suite you weakened.
-- The constraint would also not be load-bearing: the charge path requires an
-- account id to build a request at all, so a bound-less 'connected' row cannot
-- take money regardless of what the status column says.
-- ----------------------------------------------------------------------------
alter table public.payment_connections
  add column if not exists account_id          text,
  add column if not exists charges_enabled     boolean not null default false,
  add column if not exists payouts_enabled     boolean not null default false,
  add column if not exists onboarding_complete boolean not null default false,
  add column if not exists blocked_reason      text,
  add column if not exists last_observed_at    timestamptz;

do $add$
begin
  -- The account reference is sent in a REQUEST HEADER on every charge, so a value
  -- carrying CR, LF, a space or a colon would be a request-smuggling primitive.
  -- The shape is pinned at the column, not at the point of use, and mirrors
  -- PROVIDER_ACCOUNT_ID_PATTERN in packages/contracts/src/paymentConnection.ts.
  if not exists (select 1 from pg_constraint where conname = 'payment_connections_account_id_header_safe') then
    alter table public.payment_connections
      add constraint payment_connections_account_id_header_safe
      check (account_id is null or account_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$');
  end if;

  -- A CLOSED vocabulary, because blocked_reason is published to every
  -- BUSINESS_STAFF member of the tenant and is the likeliest place a raw provider
  -- error body would land. Same six values as PaymentConnectionReason.
  if not exists (select 1 from pg_constraint where conname = 'payment_connections_blocked_reason_known') then
    alter table public.payment_connections
      add constraint payment_connections_blocked_reason_known
      check (blocked_reason is null or blocked_reason in (
        'onboarding_incomplete', 'charges_disabled', 'payouts_disabled',
        'requirements_past_due', 'credentials_invalid', 'account_rejected'));
  end if;

  -- If a BOUND connection cannot charge, the record must say why. The converse is
  -- deliberately allowed: a reason WITH charges enabled is how partial onboarding
  -- (usable now, more information due later) and a payouts problem are expressed.
  -- An unbound row is exempt -- there is nothing to explain.
  if not exists (select 1 from pg_constraint where conname = 'payment_connections_blocked_reason_present') then
    alter table public.payment_connections
      add constraint payment_connections_blocked_reason_present
      check (account_id is null or charges_enabled or blocked_reason is not null);
  end if;
end
$add$;

-- Two tenants must not be able to bind the SAME connected account, and a bound
-- connection must not be repointable. This bounds the "point my tenant at a
-- victim's account" diversion by making the second bind fail rather than by trying
-- to prove the first one legitimate.
create unique index if not exists payment_connections_provider_account_key
  on public.payment_connections (provider, account_id) where account_id is not null;

-- ----------------------------------------------------------------------------
-- Composite tenant integrity, closing a PRE-EXISTING hole.
--
-- 0006 binds payment_connection_secrets.tenant_id to public.tenants and
-- payment_connection_secrets.connection_id to public.payment_connections, but
-- nothing ties the two together: a secrets row naming tenant B's id against
-- tenant A's connection satisfies every foreign key in the schema today. House
-- precedent for the fix is 0014_resource_tenant_integrity.sql.
-- ----------------------------------------------------------------------------
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_connections_id_tenant_key') then
    alter table public.payment_connections
      add constraint payment_connections_id_tenant_key unique (id, tenant_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_connection_secrets_connection_tenant_fkey') then
    alter table public.payment_connection_secrets
      add constraint payment_connection_secrets_connection_tenant_fkey
      foreign key (connection_id, tenant_id)
      references public.payment_connections (id, tenant_id) on delete cascade;
  end if;
end
$fk$;

-- ----------------------------------------------------------------------------
-- The handoff ledger: an owner pressed connect.
--
-- It makes beginConnection idempotent (a double-click must not begin a second
-- handoff) and it is what resolveConnection is resolved AGAINST, so an account can
-- only be bound to the tenant whose owner began the handoff that produced it.
-- Holding a row grants nothing: until a PERSON finishes at the provider, the
-- account cannot charge.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_connection_handoffs (
  handoff_id      text primary key check (handoff_id ~ '^[A-Za-z0-9_.-]{8,200}$'),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  provider        text not null check (length(provider) between 1 and 60),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  account_id      text check (account_id is null or account_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$'),
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint payment_connection_handoffs_idempotent unique (tenant_id, provider, idempotency_key),
  constraint payment_connection_handoffs_resolved_coherent
    check ((resolved_at is null) = (account_id is null))
);

create index if not exists payment_connection_handoffs_tenant_idx
  on public.payment_connection_handoffs (tenant_id, created_at desc);

-- Same posture as public.capacity_holds (0010), public.confirmable_payment_providers
-- (0088) and public.payment_reviews (0090): RLS enabled AND forced with no
-- policies, every verb revoked, SELECT to service_role only. An owner must not be
-- able to forge a handoff and then present an account id against it -- that is the
-- diversion this ledger exists to prevent, so the ledger itself is written only by
-- the definer RPCs below.
alter table public.payment_connection_handoffs enable row level security;
alter table public.payment_connection_handoffs force row level security;
revoke all on public.payment_connection_handoffs from public, anon, authenticated, service_role;
grant select on public.payment_connection_handoffs to service_role;

comment on table public.payment_connection_handoffs is
 'Owner-initiated payment connection handoffs. A row means a PERSON began connecting a provider; it grants no payment capability until that person finishes at the provider. Written only by public.begin_payment_connection / public.record_payment_connection (SECURITY DEFINER). Server-authoritative: never grant a write verb to any role, client or service.';

-- ----------------------------------------------------------------------------
-- The derivation. A caller reports what the provider said; this decides.
-- ----------------------------------------------------------------------------
create or replace function lumin.payment_connection_status(
  p_current         text,
  p_charges_enabled boolean,
  p_blocked_reason  text
) returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select case
    -- Terminal for automation. Only an owner completing a fresh handoff moves a
    -- connection out of 'error' or 'revoked'.
    when p_current in ('error', 'revoked') then p_current
    -- The provider says the connection is dead out there. Recording that is not a
    -- decision this system is making.
    when p_blocked_reason in ('credentials_invalid', 'account_rejected') then 'revoked'
    -- It can take money. Whether it SHOULD is the health verdict's question.
    when p_charges_enabled then 'connected'
    -- The owner never finished: there is nothing here yet.
    when p_blocked_reason = 'onboarding_incomplete' then 'not_connected'
    -- A real connection that currently cannot charge (restricted merchant, charges
    -- disabled). Stays CONNECTED on purpose -- see the header.
    else 'connected'
  end
$fn$;

revoke all on function lumin.payment_connection_status(text, boolean, text) from public, anon, authenticated, service_role;

comment on function lumin.payment_connection_status(text, boolean, text) is
 'Derives a payment connection status from what a provider reported. Total; returns only not_connected / connected / revoked, and NEVER creates ''error''. ''error'' and ''revoked'' are terminal for automation: given either as p_current it returns it unchanged, so no automatic path can resurrect a dead connection. A restricted merchant stays ''connected'' and is surfaced as a health verdict instead.';

-- The executable cross-product guard. 4 statuses x 2 charges_enabled x 7 reason
-- values (six plus NULL) = 56 combinations, every one of them checked, so the
-- claims in the header above are proven at apply time rather than asserted.
do $guard$
declare
  n_total   integer;
  n_illegal integer;
  n_invented_error integer;
  n_not_terminal   integer;
  n_not_revoked    integer;
  n_distinct       integer;
begin
  create temporary table lumin_pcs_guard on commit drop as
  select c.current_status,
         e.charges_enabled,
         r.blocked_reason,
         lumin.payment_connection_status(c.current_status, e.charges_enabled, r.blocked_reason) as derived
    from unnest(array['not_connected', 'connected', 'error', 'revoked']) as c(current_status),
         unnest(array[false, true]) as e(charges_enabled),
         unnest(array['onboarding_incomplete', 'charges_disabled', 'payouts_disabled',
                      'requirements_past_due', 'credentials_invalid', 'account_rejected', null]) as r(blocked_reason);

  select count(*) into n_total from lumin_pcs_guard;
  if n_total <> 56 then
    raise exception 'PAYMENT_CONNECTION_STATUS_GUARD_INCOMPLETE: % of 56', n_total;
  end if;

  -- Totality: every combination yields one of the four legal column values, and
  -- never NULL (a CASE with no ELSE would).
  select count(*) into n_illegal from lumin_pcs_guard
   where derived is null or derived not in ('not_connected', 'connected', 'error', 'revoked');
  if n_illegal > 0 then
    raise exception 'PAYMENT_CONNECTION_STATUS_NOT_TOTAL: % combinations', n_illegal;
  end if;

  -- Automation cannot CREATE 'error'. The only way out is in.
  select count(*) into n_invented_error from lumin_pcs_guard
   where derived = 'error' and current_status <> 'error';
  if n_invented_error > 0 then
    raise exception 'PAYMENT_CONNECTION_STATUS_INVENTS_ERROR: % combinations', n_invented_error;
  end if;

  -- 'error' and 'revoked' are terminal: nothing a provider reports moves them.
  select count(*) into n_not_terminal from lumin_pcs_guard
   where current_status in ('error', 'revoked') and derived <> current_status;
  if n_not_terminal > 0 then
    raise exception 'PAYMENT_CONNECTION_STATUS_NOT_TERMINAL: % combinations', n_not_terminal;
  end if;

  -- A provider disowning the account is the ONLY automatic route to 'revoked'.
  select count(*) into n_not_revoked from lumin_pcs_guard
   where current_status not in ('error', 'revoked')
     and ((blocked_reason in ('credentials_invalid', 'account_rejected')) <> (derived = 'revoked'));
  if n_not_revoked > 0 then
    raise exception 'PAYMENT_CONNECTION_STATUS_REVOKE_PATH_WRONG: % combinations', n_not_revoked;
  end if;

  -- No verdict is dead code.
  select count(distinct derived) into n_distinct from lumin_pcs_guard;
  if n_distinct <> 4 then
    raise exception 'PAYMENT_CONNECTION_STATUS_VERDICT_UNREACHABLE: only % distinct', n_distinct;
  end if;
end
$guard$;

-- ----------------------------------------------------------------------------
-- RPC 1 of 4 -- begin a handoff. OWNER action, owner authority.
-- ----------------------------------------------------------------------------
create or replace function public.begin_payment_connection(
  p_actor           uuid,
  p_tenant          uuid,
  p_provider        text,
  p_idempotency_key text,
  p_handoff_id      text,
  p_expires_at      timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $fn$
declare existing public.payment_connection_handoffs; conn_id uuid;
begin
  -- BUSINESS_OWNER of this tenant, or 42501. The actor is never client-supplied:
  -- apps/api derives it from a verified Supabase JWT before any writer runs.
  perform lumin.flow_actor(p_actor, p_tenant, true);

  -- The connect-time gate is 0088's allowlist, reused rather than duplicated.
  -- 'stripe_connect' is seeded everywhere; the simulated labels only on a
  -- disposable database, which is what makes a mock connection physically
  -- unrecordable in production.
  if not exists (select 1 from public.confirmable_payment_providers where provider = p_provider) then
    raise exception 'PAYMENT_PROVIDER_NOT_CONFIRMABLE'
      using errcode = '22023', detail = format('provider %s is not declared confirmable in this deployment', p_provider);
  end if;

  -- Idempotent: a double-click must not begin a second handoff.
  select * into existing from public.payment_connection_handoffs
   where tenant_id = p_tenant and provider = p_provider and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('handoffId', existing.handoff_id, 'provider', existing.provider,
                              'expiresAt', existing.expires_at, 'replayed', true);
  end if;

  -- A placeholder connection row so the portal can show "connecting". It carries
  -- no account and therefore no capability; status stays 'not_connected'.
  insert into public.payment_connections (tenant_id, provider, status)
  values (p_tenant, p_provider, 'not_connected')
  on conflict (tenant_id, provider) do nothing;
  select id into conn_id from public.payment_connections where tenant_id = p_tenant and provider = p_provider;

  insert into public.payment_connection_handoffs (handoff_id, tenant_id, provider, idempotency_key, expires_at)
  values (p_handoff_id, p_tenant, p_provider, p_idempotency_key, p_expires_at);

  return jsonb_build_object('handoffId', p_handoff_id, 'provider', p_provider,
                            'expiresAt', p_expires_at, 'connectionId', conn_id, 'replayed', false);
end
$fn$;

-- ----------------------------------------------------------------------------
-- RPC 2 of 4 -- bind a verified account. OWNER action, write-once.
-- ----------------------------------------------------------------------------
create or replace function public.record_payment_connection(
  p_actor               uuid,
  p_tenant              uuid,
  p_handoff_id          text,
  p_account_id          text,
  p_charges_enabled     boolean,
  p_payouts_enabled     boolean,
  p_onboarding_complete boolean,
  p_blocked_reason      text,
  p_observed_at         timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $fn$
declare h public.payment_connection_handoffs; row_before public.payment_connections; new_status text;
begin
  perform lumin.flow_actor(p_actor, p_tenant, true);

  -- The account may only be bound against a handoff THIS tenant's owner began.
  -- Without this the account id would be a bearer of binding authority on its own.
  select * into h from public.payment_connection_handoffs
   where handoff_id = p_handoff_id and tenant_id = p_tenant;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'no handoff of this tenant matches';
  end if;

  -- A handoff is a short-lived authorization to bind, not a permanent token.
  -- expires_at was recorded and then never consulted, so a handoff from any time
  -- in the past stayed usable forever. The grace window absorbs the gap between
  -- the provider-side link expiring and the owner's browser returning.
  if h.expires_at + interval '1 hour' < clock_timestamp() then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'this handoff has expired; begin a new one';
  end if;

  select * into row_before from public.payment_connections
   where tenant_id = p_tenant and provider = h.provider for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED' using errcode = '22023', detail = 'no connection row for this handoff';
  end if;

  -- A bind must name an account. Spelled out rather than left to the <> below,
  -- because `account_id <> NULL` is NULL, not true, so a NULL argument slipped
  -- past the write-once guard and unbound the connection. (It did not actually
  -- repoint anything -- the ledger's resolved-coherence constraint aborted the
  -- transaction a few lines later -- but that was luck, not design.)
  if p_account_id is null then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'a bind must name a provider account';
  end if;

  -- WRITE-ONCE WHILE THE CONNECTION IS LIVE. Rebinding a live connection to a
  -- different account would silently move a tenant's money, and rebinding to the
  -- same one is a replay that must be harmless.
  --
  -- A DEAD connection is the exception, and it has to be: when a provider
  -- disowns an account, the owner's fresh handoff necessarily produces a
  -- DIFFERENT account, so refusing it here would leave the tenant permanently
  -- unable to take payments. Reconnecting a dead connection is owner action --
  -- this function requires BUSINESS_OWNER above -- not automation repointing a
  -- live one. public.observe_payment_connection, which has no actor, cannot
  -- reach this branch at all.
  if row_before.account_id is not null
     and row_before.account_id <> p_account_id
     and row_before.status not in ('revoked', 'error') then
    raise exception 'PAYMENT_CONNECTION_ALREADY_BOUND'
      using errcode = '42501', detail = 'this connection is already bound to a different account';
  end if;

  -- An OWNER binding against a fresh handoff restarts the derivation from
  -- 'not_connected'. Without this, 'revoked' and 'error' were terminal for the
  -- owner too: a connection the provider had disowned stayed revoked forever
  -- even as the provider reported the new account fully healthy, leaving the row
  -- incoherent (status 'revoked' beside charges_enabled true and no reason) and
  -- the tenant permanently unable to charge. The terminal rule exists to stop
  -- AUTOMATION resurrecting a dead connection, and observe_payment_connection
  -- still cannot; it was never meant to bind the owner.
  new_status := lumin.payment_connection_status(
    case when row_before.status in ('revoked', 'error') then 'not_connected' else row_before.status end,
    p_charges_enabled, p_blocked_reason);

  update public.payment_connections
     set account_id          = p_account_id,
         charges_enabled     = p_charges_enabled,
         payouts_enabled     = p_payouts_enabled,
         onboarding_complete = p_onboarding_complete,
         blocked_reason      = p_blocked_reason,
         last_observed_at    = p_observed_at,
         status              = new_status,
         last_check_at       = p_observed_at,
         -- last_error is left alone on purpose: blocked_reason is the closed
         -- vocabulary a member may see, and nothing here forwards provider prose.
         last_error          = row_before.last_error
   where id = row_before.id;

  update public.payment_connection_handoffs
     set account_id = p_account_id, resolved_at = coalesce(resolved_at, p_observed_at)
   where handoff_id = p_handoff_id;

  return jsonb_build_object('connectionId', row_before.id, 'provider', h.provider,
                            'accountId', p_account_id, 'status', new_status,
                            'replayed', row_before.account_id is not null);
end
$fn$;

-- ----------------------------------------------------------------------------
-- RPC 3 of 4 -- record a fresh provider observation. NO ACTOR: this is the health
-- refresh and runs without a person. It is therefore the most constrained of the
-- four, and the constraints are structural:
--   * it cannot set a status -- only report facts the derivation reads;
--   * it cannot create 'error' or leave 'error'/'revoked', because the derivation
--     cannot;
--   * it cannot change account_id or provider: neither is in the SET list, and the
--     row is located BY the account id it was given;
--   * it cannot create a connection: a miss raises.
-- ----------------------------------------------------------------------------
create or replace function public.observe_payment_connection(
  p_tenant              uuid,
  p_account_id          text,
  p_charges_enabled     boolean,
  p_payouts_enabled     boolean,
  p_onboarding_complete boolean,
  p_blocked_reason      text,
  p_observed_at         timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $fn$
declare row_before public.payment_connections; new_status text;
begin
  select * into row_before from public.payment_connections
   where tenant_id = p_tenant and account_id = p_account_id for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'no bound connection of this tenant holds that account';
  end if;

  new_status := lumin.payment_connection_status(row_before.status, p_charges_enabled, p_blocked_reason);

  update public.payment_connections
     set charges_enabled     = p_charges_enabled,
         payouts_enabled     = p_payouts_enabled,
         onboarding_complete = p_onboarding_complete,
         blocked_reason      = p_blocked_reason,
         last_observed_at    = p_observed_at,
         status              = new_status,
         last_check_at       = p_observed_at
   where id = row_before.id;

  return jsonb_build_object('connectionId', row_before.id, 'status', new_status,
                            'statusChanged', new_status <> row_before.status);
end
$fn$;

-- ----------------------------------------------------------------------------
-- RPC 4 of 4 -- the member-facing read. Returns FACTS, not a verdict.
--
-- The health verdict (chargeable / degraded / blocked / not_connected) is derived
-- in ONE place, derivePaymentConnectionHealth in packages/contracts, where a
-- 112-combination cross-product test guards it. Deriving it here as well would
-- create a second authority that could disagree with the first.
-- ----------------------------------------------------------------------------
create or replace function public.payment_connection_facts(
  p_actor  uuid,
  p_tenant uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $fn$
declare result jsonb;
begin
  -- Member-level, not owner-only: staff must be able to see that payments are
  -- degraded. Reading is not the hazard (0089's own reasoning for keeping
  -- member_or_admin_select).
  perform lumin.flow_actor(p_actor, p_tenant, false);

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider',           c.provider,
           'status',             c.status,
           'accountId',          c.account_id,
           'chargesEnabled',     c.charges_enabled,
           'payoutsEnabled',     c.payouts_enabled,
           'onboardingComplete', c.onboarding_complete,
           'blockedReason',      c.blocked_reason,
           'lastObservedAt',     c.last_observed_at
         ) order by c.provider), '[]'::jsonb)
    into result
    from public.payment_connections c
   where c.tenant_id = p_tenant;

  return jsonb_build_object('schemaVersion', 1, 'connections', result);
end
$fn$;

-- ----------------------------------------------------------------------------
-- Grants: the trusted runtime, and nobody else.
-- ----------------------------------------------------------------------------
revoke all on function
  public.begin_payment_connection(uuid, uuid, text, text, text, timestamptz),
  public.record_payment_connection(uuid, uuid, text, text, boolean, boolean, boolean, text, timestamptz),
  public.observe_payment_connection(uuid, text, boolean, boolean, boolean, text, timestamptz),
  public.payment_connection_facts(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.begin_payment_connection(uuid, uuid, text, text, text, timestamptz),
  public.record_payment_connection(uuid, uuid, text, text, boolean, boolean, boolean, text, timestamptz),
  public.observe_payment_connection(uuid, text, boolean, boolean, boolean, text, timestamptz),
  public.payment_connection_facts(uuid, uuid)
  to service_role;

-- The RPCs are SECURITY DEFINER and owned by the migration runner, so they keep
-- working while every DIRECT write verb on the table is taken away. After this,
-- the ONLY way any row of public.payment_connections changes is through a function
-- whose body constrains what may change -- including for the trusted runtime,
-- which could otherwise `update ... set config = ...` at will. 0089 verified there
-- is no other writer: zero references in apps/ and packages/, and no SQL writer
-- outside the RLS attack fixture (which runs as the superuser).
--
-- TRUNCATE, TRIGGER and REFERENCES are revoked too, and each for its own reason:
-- TRUNCATE empties every tenant's connection in one statement, which is a write
-- by any honest reading; TRIGGER lets a role attach a BEFORE UPDATE trigger that
-- then runs INSIDE these definer RPCs and rewrites whatever it likes, which would
-- defeat write-once and the claim above outright; REFERENCES lets a foreign key be
-- pointed at the table. Revoking only insert/update/delete left all three, and the
-- guard below used to check only those three, so it passed.
revoke insert, update, delete, truncate, trigger, references on public.payment_connections from service_role;
revoke truncate, trigger, references on public.payment_connection_handoffs from service_role;

do $guard$
declare v text;
begin
  foreach v in array array['insert', 'update', 'delete', 'truncate', 'trigger', 'references'] loop
    if has_table_privilege('authenticated', 'public.payment_connections', v)
       or has_table_privilege('anon', 'public.payment_connections', v)
       or has_table_privilege('service_role', 'public.payment_connections', v) then
      raise exception 'PAYMENT_CONNECTION_DIRECT_WRITE_REACHABLE: %', v;
    end if;
    if has_table_privilege('authenticated', 'public.payment_connection_handoffs', v)
       or has_table_privilege('anon', 'public.payment_connection_handoffs', v)
       or has_table_privilege('service_role', 'public.payment_connection_handoffs', v) then
      raise exception 'PAYMENT_CONNECTION_HANDOFF_WRITE_REACHABLE: %', v;
    end if;
  end loop;

  -- 0089's own guard, restated so a later re-opening fails here too.
  if exists (select 1 from pg_policy where polrelid = 'public.payment_connections'::regclass and polcmd <> 'r') then
    raise exception 'PAYMENT_CONNECTION_WRITE_POLICY_PRESENT';
  end if;

  -- The four RPCs must be reachable by the runtime and by nobody else.
  foreach v in array array[
    'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)',
    'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)',
    'public.observe_payment_connection(uuid,text,boolean,boolean,boolean,text,timestamptz)',
    'public.payment_connection_facts(uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', v, 'execute') then
      raise exception 'PAYMENT_CONNECTION_RPC_UNREACHABLE: %', v;
    end if;
    if has_function_privilege('anon', v, 'execute') or has_function_privilege('authenticated', v, 'execute') then
      raise exception 'PAYMENT_CONNECTION_RPC_CLIENT_REACHABLE: %', v;
    end if;
  end loop;
end
$guard$;

comment on column public.payment_connections.account_id is
 'The connected account REFERENCE this tenant charges on. An identifier, not a credential: nothing can be done with it without the platform secret, which lives only in the server runtime. WRITE-ONCE -- public.record_payment_connection refuses to repoint a bound connection.';
comment on column public.payment_connections.blocked_reason is
 'Why this connection cannot charge, or charges with a caveat. Closed vocabulary, because this value is shown to every staff member of the tenant. Provider prose is never forwarded here.';
comment on column public.payment_connections.charges_enabled is
 'What the PROVIDER last said about charging. Reported, never asserted: the status column is derived from this by lumin.payment_connection_status.';

commit;
