-- 0095 payment connection repair.
--
-- Step 6 of docs/P1_PAYMENT_CONNECTION_DECISION.md. Adversarial reviews of the step-6 change found defects in
-- the authority functions of 0093, and the reviews of round 1 found more in this migration. It redefines the
-- functions that move a connection between states, with the same signatures, redefines the reader RPC, adds
-- two helpers and one read policy, restricts the columns a client reads, and restates every grant it relies
-- on. It changes no table and no column.
--
--   1. THE WINDOW GOVERNS A BIND. A bind names an account the connection does not hold, or brings a connection
--      that is not connected to 'connected'. A refresh of a connection that is already connected, and a record
--      that disowns it, are not refused by the clock: a disowning must be recorded. A lapsed handoff therefore
--      cannot revive a revoked connection on the account it had bound.
--   2. A NEVER-CONNECTED OWNER IS NOT CONNECTED. An unfinished onboarding derives not_connected whatever the
--      charges flag says. A connected row stays connected on an unfinished-onboarding report, and its health
--      verdict shows the blocker. A connection that was never connected may be bound to another account;
--      write-once still refuses every connected row.
--   3. AN OLDER OBSERVATION CHANGES NOTHING, for the same account. Observations are applied in the order the
--      provider ANSWERED. A TERMINAL connection (revoked or error) is not changed by automation at all: the
--      facts that revoked it stay with it, and a disowning keeps the stored onboarding fact, which Stripe did
--      not report.
--   4. A HANDOFF ALREADY RECORDED CANNOT REBIND THE CONNECTION. A recorded handoff may refresh only the account
--      it produced. A record that names another account, for a handoff or for a connection that has moved on,
--      is refused as a conflict.
--   5. A CONNECTED TENANT STARTS NO NEW HANDOFF. begin refuses a new idempotency key for a connected tenant.
--   6. THE RECEIPT STATES THE WINDOW THAT IS ENFORCED. begin_payment_connection returns bindDeadline, computed by
--      the helper record_payment_connection enforces.
--   7. replayed MEANS THIS HANDOFF WAS ALREADY RECORDED. It does not mean that nothing changed.
--   8. CONFLICTS ARE 23505 (409): write-once, supersession, and a new handoff for a connected tenant.
--   9. THE DECLARATION IS CHECKED WHEREVER A WRITE OR A READ DEPENDS ON IT: begin, record, observe, the reader
--      RPC and the member read policy. A label withdrawn from the allowlist is refused everywhere.
--  10. A MEMBER READS ONLY DECLARED PROVIDERS OF AN ACTIVE TENANT, AND ONLY CONNECTION FACTS. last_error and
--      config are not granted to a client role. The helper answers a probe only for a row the member can see.
--
-- LOCK ORDER. record takes the handoff row, then the connection row. begin and observe take the connection row
-- and never the handoff row. No function takes the two in the opposite order.
--
-- REVERT IS FORWARD-ONLY, as for 0093. Never a DROP: every migration must still replay from zero on an empty
-- database.
begin;

-- ----------------------------------------------------------------------------
-- The bind window, in one place.
-- ----------------------------------------------------------------------------
create or replace function lumin.payment_handoff_bind_deadline(p_expires_at timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog
as $fn$
  select p_expires_at + interval '1 hour'
$fn$;

revoke all on function lumin.payment_handoff_bind_deadline(timestamptz) from public, anon, authenticated, service_role;

comment on function lumin.payment_handoff_bind_deadline(timestamptz) is
 'The last moment a payment connection handoff may bind a NEW account: its ledger expiry plus a one-hour grace. The grace absorbs the gap between the provider-side link expiring and the owner''s browser returning. It does not govern a refresh of the account the connection already holds.';

-- ----------------------------------------------------------------------------
-- The derivation, repaired (3). Redefined here; 0093 defined it.
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
    -- An owner who never finished is not connected, whatever the charges flag says. A row becomes
    -- connected only when its owner has finished onboarding, or when it already is connected.
    when p_blocked_reason = 'onboarding_incomplete' and p_current <> 'connected' then 'not_connected'
    -- It can take money. Whether it SHOULD is the health verdict's question.
    when p_charges_enabled then 'connected'
    -- A connection that is already connected is not disconnected by an unfinished
    -- onboarding report. The binding is unchanged and the health verdict shows the blocker.
    when p_blocked_reason = 'onboarding_incomplete' and p_current = 'connected' then 'connected'
    -- The owner never finished: there is nothing here yet.
    when p_blocked_reason = 'onboarding_incomplete' then 'not_connected'
    -- A real connection that currently cannot charge (restricted merchant, charges
    -- disabled). Stays CONNECTED on purpose: the health verdict reports the restriction.
    else 'connected'
  end
$fn$;

revoke all on function lumin.payment_connection_status(text, boolean, text) from public, anon, authenticated, service_role;

comment on function lumin.payment_connection_status(text, boolean, text) is
 'Derives a payment connection status from what a provider reported. Total; returns only not_connected / connected / revoked, and NEVER creates ''error''. ''error'' and ''revoked'' are terminal for automation: given either as p_current it returns it unchanged. A connected row is never demoted to not_connected by an onboarding report; it stays connected and the health verdict shows the blocker.';

-- ----------------------------------------------------------------------------
-- RPC 1 of 4 -- begin a handoff. OWNER action. Repaired for (6), (7), (8).
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
declare existing public.payment_connection_handoffs; conn_id uuid; conn_status text; inserted boolean := false;
begin
  perform lumin.flow_actor(p_actor, p_tenant, true);

  if not exists (select 1 from public.confirmable_payment_providers where provider = p_provider) then
    raise exception 'PAYMENT_PROVIDER_NOT_CONFIRMABLE'
      using errcode = '22023', detail = format('provider %s is not declared confirmable in this deployment', p_provider);
  end if;

  -- A replay of a key this tenant already began. It is answered BEFORE the connected
  -- check below, so a connected tenant can still have its begin replayed.
  select * into existing from public.payment_connection_handoffs
   where tenant_id = p_tenant and provider = p_provider and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('handoffId', existing.handoff_id, 'provider', existing.provider,
                              'expiresAt', existing.expires_at,
                              'bindDeadline', lumin.payment_handoff_bind_deadline(existing.expires_at),
                              'replayed', true);
  end if;

  insert into public.payment_connections (tenant_id, provider, status)
  values (p_tenant, p_provider, 'not_connected')
  on conflict (tenant_id, provider) do nothing;
  select id, status into conn_id, conn_status from public.payment_connections
   where tenant_id = p_tenant and provider = p_provider;

  -- A CONNECTED TENANT starts no new handoff. A new key would make the provider create a
  -- second account, which record would then refuse to bind. The writer refuses it before the
  -- provider is asked. This refusal is the database's own, and it runs AFTER the provider has
  -- been asked: it catches a race between the writer's read and this insert. The account the
  -- provider created is then unbound, because no handoff of it is ever recorded.
  if conn_status = 'connected' then
    raise exception 'PAYMENT_CONNECTION_ALREADY_CONNECTED'
      using errcode = '23505', detail = 'this tenant already has a connected account for this provider';
  end if;

  begin
    insert into public.payment_connection_handoffs (handoff_id, tenant_id, provider, idempotency_key, expires_at)
    values (p_handoff_id, p_tenant, p_provider, p_idempotency_key, p_expires_at);
    inserted := true;
  exception when unique_violation then
    -- A concurrent begin with the same key won the insert. Its row is read below, and
    -- this call is a replay of it.
    null;
  end;

  select * into existing from public.payment_connection_handoffs
   where tenant_id = p_tenant and provider = p_provider and idempotency_key = p_idempotency_key;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'handoff could not be recorded';
  end if;

  return jsonb_build_object('handoffId', existing.handoff_id, 'provider', p_provider,
                            'expiresAt', existing.expires_at,
                            'bindDeadline', lumin.payment_handoff_bind_deadline(existing.expires_at),
                            'connectionId', conn_id,
                            'replayed', not inserted);
end
$fn$;

-- ----------------------------------------------------------------------------
-- RPC 2 of 4 -- record what the provider said about a handoff's account.
-- OWNER action. Repaired for (1), (2), (4), (5), (8), (9), (10 is in the policy below).
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
declare h public.payment_connection_handoffs; row_before public.payment_connections; row_after public.payment_connections; new_status text; was_recorded boolean;
begin
  perform lumin.flow_actor(p_actor, p_tenant, true);

  -- The handoff, LOCKED. Two concurrent records of one handoff serialise here, and the
  -- second reads what the first committed, so was_recorded is a fact about this call.
  select * into h from public.payment_connection_handoffs
   where handoff_id = p_handoff_id and tenant_id = p_tenant for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'no handoff of this tenant matches';
  end if;
  was_recorded := h.resolved_at is not null;

  -- A provider this deployment no longer declares is not recorded, even for a handoff
  -- begun while it was declared. The writer checks this too, before it calls the provider.
  if not exists (select 1 from public.confirmable_payment_providers where provider = h.provider) then
    raise exception 'PAYMENT_PROVIDER_NOT_CONFIRMABLE'
      using errcode = '22023', detail = format('provider %s is not declared confirmable in this deployment', h.provider);
  end if;

  select * into row_before from public.payment_connections
   where tenant_id = p_tenant and provider = h.provider for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED' using errcode = '22023', detail = 'no connection row for this handoff';
  end if;

  -- A bind must name an account. Spelled out rather than left to the comparisons below,
  -- because `account_id <> NULL` is NULL, not true.
  if p_account_id is null then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'a bind must name a provider account';
  end if;
  -- Shape-checked here as well as by the column constraint, so a malformed reference is
  -- refused as unverifiable rather than surfacing as a 23514.
  if p_account_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$' then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'provider account reference is not header-safe';
  end if;

  -- A HANDOFF ALREADY RECORDED may only refresh the account it produced. A connection
  -- that has moved on to another account is not moved back by an older handoff.
  if was_recorded and (h.account_id is distinct from p_account_id
                       or row_before.account_id is distinct from p_account_id) then
    raise exception 'PAYMENT_CONNECTION_HANDOFF_SUPERSEDED'
      using errcode = '23505', detail = 'this handoff was recorded for an account the connection no longer holds';
  end if;

  -- AN OLDER OBSERVATION CHANGES NOTHING. Same account, and this answer is older than the
  -- one stored: the stored state is the later truth, and the receipt states it.
  if row_before.account_id = p_account_id
     and row_before.last_observed_at is not null
     and p_observed_at < row_before.last_observed_at then
    -- The receipt states what the database STORED, not what this answer said: a stale answer changed nothing.
    return jsonb_build_object('connectionId', row_before.id, 'provider', h.provider,
                              'accountId', row_before.account_id, 'status', row_before.status,
                              'chargesEnabled', row_before.charges_enabled,
                              'payoutsEnabled', row_before.payouts_enabled,
                              'onboardingComplete', row_before.onboarding_complete,
                              'blockedReason', row_before.blocked_reason,
                              'replayed', was_recorded);
  end if;

  -- The status this record would give the connection. Computed before the window, because a record
  -- that brings a connection to 'connected' is a bind, whatever account it names.
  new_status := lumin.payment_connection_status(
    case when row_before.status in ('revoked', 'error') then 'not_connected' else row_before.status end,
    p_charges_enabled, p_blocked_reason);

  -- THE WINDOW GOVERNS A BIND. A bind names an account the connection does not hold, or brings a
  -- connection that is not connected to 'connected': a revoked connection reconnected, or an unfinished
  -- one finished. A refresh of a connection that is already connected is not refused by the clock, and
  -- neither is a record that disowns it, because a disowning must still be recorded. Without the second
  -- clause a lapsed handoff could revive a revoked connection on the account it had bound.
  if lumin.payment_handoff_bind_deadline(h.expires_at) < clock_timestamp()
     and (row_before.account_id is distinct from p_account_id
          or (new_status = 'connected' and row_before.status <> 'connected')) then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'this handoff has expired; begin a new one';
  end if;

  -- WRITE-ONCE WHILE CONNECTED. Rebinding a connection that is connected, or that the
  -- provider has not yet disowned, to a different account would silently move a tenant's
  -- money. A DEAD connection (revoked, error) is the owner's reconnect. A NOT_CONNECTED one
  -- was never connected, so it has no money to move: its owner did not finish.
  if row_before.account_id is not null
     and row_before.account_id <> p_account_id
     and row_before.status not in ('revoked', 'error', 'not_connected') then
    raise exception 'PAYMENT_CONNECTION_ALREADY_BOUND'
      using errcode = '23505', detail = 'this connection is already bound to a different account';
  end if;

  -- An OWNER binding restarts the derivation from 'not_connected' when the connection was
  -- dead, so a reconnect is not stuck on 'revoked'. Automation cannot reach this function:
  -- observe_payment_connection, which has no actor, cannot.
  update public.payment_connections
     set account_id          = p_account_id,
         charges_enabled     = p_charges_enabled,
         payouts_enabled     = p_payouts_enabled,
         onboarding_complete = case when p_blocked_reason in ('credentials_invalid', 'account_rejected')
                                    and row_before.account_id = p_account_id
                                    then row_before.onboarding_complete else p_onboarding_complete end,
         blocked_reason      = p_blocked_reason,
         last_observed_at    = p_observed_at,
         status              = new_status,
         last_check_at       = p_observed_at,
         -- last_error is left alone on purpose: blocked_reason is the closed vocabulary a
         -- member may see, and nothing here forwards provider prose.
         last_error          = row_before.last_error
   where id = row_before.id
  returning * into row_after;

  update public.payment_connection_handoffs
     set account_id = p_account_id, resolved_at = coalesce(resolved_at, p_observed_at)
   where handoff_id = p_handoff_id and tenant_id = p_tenant;

  -- The receipt states what the database STORED, so the writer never pairs a status with facts it did not store.
  return jsonb_build_object('connectionId', row_after.id, 'provider', h.provider,
                            'accountId', p_account_id, 'status', row_after.status,
                            'chargesEnabled', row_after.charges_enabled,
                            'payoutsEnabled', row_after.payouts_enabled,
                            'onboardingComplete', row_after.onboarding_complete,
                            'blockedReason', row_after.blocked_reason,
                            'replayed', was_recorded);
end
$fn$;

-- ----------------------------------------------------------------------------
-- RPC 3 of 4 -- observe. AUTOMATION, no actor. Repaired for (3) and (4).
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
  -- FIRST, before the lookup, mirroring the adapter's own ordering. A reference carrying
  -- CR or LF is refused as not header-safe, not merely as not found.
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$' then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'provider account reference is not header-safe';
  end if;

  select * into row_before from public.payment_connections
   where tenant_id = p_tenant and account_id = p_account_id for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'no bound connection of this tenant holds that account';
  end if;

  -- A label withdrawn from the allowlist is not written to by automation either: record and begin refuse it.
  if not exists (select 1 from public.confirmable_payment_providers where provider = row_before.provider) then
    raise exception 'PAYMENT_PROVIDER_NOT_CONFIRMABLE'
      using errcode = '22023', detail = format('provider %s is not declared confirmable in this deployment', row_before.provider);
  end if;

  -- A TERMINAL connection is not changed by automation at all. The facts that revoked it stay with it:
  -- a later healthy answer must not show charges enabled beside a revoked status.
  if row_before.status in ('revoked', 'error') then
    return jsonb_build_object('connectionId', row_before.id, 'status', row_before.status, 'statusChanged', false);
  end if;

  -- AN OLDER OBSERVATION CHANGES NOTHING. Automation can deliver a report late; the stored
  -- state came from a later answer and is kept.
  if row_before.last_observed_at is not null and p_observed_at < row_before.last_observed_at then
    return jsonb_build_object('connectionId', row_before.id, 'status', row_before.status,
                              'statusChanged', false);
  end if;

  new_status := lumin.payment_connection_status(row_before.status, p_charges_enabled, p_blocked_reason);

  update public.payment_connections
     set charges_enabled     = p_charges_enabled,
         payouts_enabled     = p_payouts_enabled,
         onboarding_complete = case when p_blocked_reason in ('credentials_invalid', 'account_rejected')
                                    then row_before.onboarding_complete else p_onboarding_complete end,
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
-- The helper for the member read policy (10). A member reads a row only when the
-- provider is declared on this deployment and the tenant is active: the two checks the
-- reader RPC applies. SECURITY DEFINER, because the member has no read grant on the
-- allowlist, and no write verb on anything.
-- ----------------------------------------------------------------------------
create or replace function lumin.payment_connection_readable(p_tenant uuid, p_provider text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $fn$
  select lumin.is_tenant_member(p_tenant)
     and exists (select 1 from public.tenants t where t.id = p_tenant and t.status = 'active')
     and exists (select 1 from public.payment_connections c where c.tenant_id = p_tenant and c.provider = p_provider)
     and exists (select 1 from public.confirmable_payment_providers d where d.provider = p_provider)
$fn$;

revoke all on function lumin.payment_connection_readable(uuid, text) from public, anon, authenticated, service_role;
grant execute on function lumin.payment_connection_readable(uuid, text) to authenticated;

comment on function lumin.payment_connection_readable(uuid, text) is
 'True only for a member of the tenant, when the tenant is active, the tenant holds a connection under this provider, and the provider is declared confirmable here. A probe for a label returns true only where the member could already see a declared row of its own, so it reveals nothing about the allowlist.';

-- The reader RPC applies the declaration check in the database too. The header of this migration said it
-- already refused undeclared labels, which it did not: the only filter was in TypeScript.
create or replace function public.payment_connection_facts(p_actor uuid, p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $fn$
declare result jsonb;
begin
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
   where c.tenant_id = p_tenant
     and exists (select 1 from public.confirmable_payment_providers d where d.provider = c.provider);
  return jsonb_build_object('schemaVersion', 1, 'connections', result);
end
$fn$;

-- The reader RPC keeps its grants: CREATE OR REPLACE preserves them, and the guard below proves them.

-- A member reads the connection's facts, never its free text or its configuration. last_error is the
-- column a raw provider error would land in, and config is the operator's: neither is granted to a
-- client role. The table-level select is replaced by the listed columns, so a column added later is
-- unreadable by clients until someone grants it.
revoke select on public.payment_connections from authenticated;
grant select (id, tenant_id, provider, status, account_id, charges_enabled, payouts_enabled,
              onboarding_complete, blocked_reason, last_observed_at, last_check_at, created_at, updated_at)
  on public.payment_connections to authenticated;

drop policy if exists "member_or_admin_select" on public.payment_connections;
create policy "member_or_admin_select" on public.payment_connections
  for select to authenticated
  using ((lumin.is_tenant_member(tenant_id) and lumin.payment_connection_readable(tenant_id, provider))
         or lumin.is_platform_admin());

-- The redefined functions keep their grants, which CREATE OR REPLACE preserves. They are
-- restated here so this migration states the reachability it relies on, and so a later
-- change that drops it is visible in this file.
revoke all on function
  public.begin_payment_connection(uuid, uuid, text, text, text, timestamptz),
  public.record_payment_connection(uuid, uuid, text, text, boolean, boolean, boolean, text, timestamptz),
  public.observe_payment_connection(uuid, text, boolean, boolean, boolean, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  public.begin_payment_connection(uuid, uuid, text, text, text, timestamptz),
  public.record_payment_connection(uuid, uuid, text, text, boolean, boolean, boolean, text, timestamptz),
  public.observe_payment_connection(uuid, text, boolean, boolean, boolean, text, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- Guard: prove what the header claims at apply time.
-- ----------------------------------------------------------------------------
do $guard$
declare terminal text; charges boolean; reason text;
begin
  -- The window is one hour past the LEDGER expiry, and the helper is the only place that
  -- says so. Pin both the arithmetic and the reachability.
  if lumin.payment_handoff_bind_deadline(timestamptz '2030-06-01 12:00:00+00')
     <> timestamptz '2030-06-01 13:00:00+00' then
    raise exception 'PAYMENT_HANDOFF_BIND_DEADLINE_WRONG';
  end if;
  if has_function_privilege('anon', 'lumin.payment_handoff_bind_deadline(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'lumin.payment_handoff_bind_deadline(timestamptz)', 'execute')
     or has_function_privilege('service_role', 'lumin.payment_handoff_bind_deadline(timestamptz)', 'execute') then
    raise exception 'PAYMENT_HANDOFF_BIND_DEADLINE_REACHABLE';
  end if;

  -- A connected row is never demoted to not_connected by an onboarding report, and a
  -- revoking report still revokes it.
  if lumin.payment_connection_status('connected', false, 'onboarding_incomplete') <> 'connected'
     or lumin.payment_connection_status('not_connected', false, 'onboarding_incomplete') <> 'not_connected'
     or lumin.payment_connection_status('connected', false, 'credentials_invalid') <> 'revoked'
     or lumin.payment_connection_status('revoked', true, null) <> 'revoked'
     or lumin.payment_connection_status('not_connected', true, 'onboarding_incomplete') <> 'not_connected' then
    raise exception 'PAYMENT_CONNECTION_DERIVATION_WRONG';
  end if;
  -- Every flag and reason, for each terminal state: the state comes back unchanged. Exhaustive, so
  -- an edit that lets a terminal row derive anything else is refused here, not by a sample.
  foreach terminal in array array['error', 'revoked'] loop
    foreach charges in array array[false, true] loop
      foreach reason in array array['credentials_invalid', 'account_rejected', 'onboarding_incomplete',
                                    'charges_disabled', 'payouts_disabled', 'requirements_past_due', null::text] loop
        if lumin.payment_connection_status(terminal, charges, reason) <> terminal then
          raise exception 'PAYMENT_CONNECTION_TERMINAL_NOT_TERMINAL';
        end if;
      end loop;
    end loop;
  end loop;

  -- The RPCs must still be the only reachable writers, and reachable by the runtime.
  if not has_function_privilege('service_role', 'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.observe_payment_connection(uuid,text,boolean,boolean,boolean,text,timestamptz)', 'execute') then
    raise exception 'PAYMENT_CONNECTION_RPC_UNREACHABLE';
  end if;
  if has_function_privilege('anon', 'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.observe_payment_connection(uuid,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.observe_payment_connection(uuid,text,boolean,boolean,boolean,text,timestamptz)', 'execute') then
    raise exception 'PAYMENT_CONNECTION_RPC_CLIENT_REACHABLE';
  end if;

  if has_column_privilege('authenticated', 'public.payment_connections', 'last_error', 'select')
     or has_column_privilege('authenticated', 'public.payment_connections', 'config', 'select')
     or not has_column_privilege('authenticated', 'public.payment_connections', 'blocked_reason', 'select') then
    raise exception 'PAYMENT_CONNECTION_COLUMN_GRANT_WRONG';
  end if;
  if has_function_privilege('authenticated', 'public.payment_connection_facts(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.payment_connection_facts(uuid,uuid)', 'execute') then
    raise exception 'PAYMENT_CONNECTION_FACTS_CLIENT_REACHABLE';
  end if;
  -- The member read names both checks: a policy that admitted an undeclared label or a
  -- suspended tenant would be a silent widening.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'payment_connections'
                    and policyname = 'member_or_admin_select'
                    and qual like '%payment_connection_readable%') then
    raise exception 'PAYMENT_CONNECTION_READ_POLICY_WRONG';
  end if;
end
$guard$;

commit;
