-- 0095 payment connection repair.
--
-- Step 6 of docs/P1_PAYMENT_CONNECTION_DECISION.md. The adversarial review of the
-- step-6 change found four defects in the two RPCs of 0093 that move a connection
-- between states. This migration redefines those two functions, with the same
-- signatures, and adds one helper. It changes no table, no column, no grant on a
-- table, no status derivation and nothing about observation.
--
--   1. THE BIND WINDOW GOVERNS A NEW BIND ONLY. 0093 refused every record once a
--      handoff was more than an hour past its expiry, including a record for the
--      account the connection already holds. So a connection the provider had since
--      disowned could never be recorded as revoked, and a live connection could
--      never be refreshed. A record for the account already bound is a refresh of
--      that account and is allowed. The window still refuses any bind of a NEW
--      account, which is what it was for.
--
--   2. AN ABANDONED ONBOARDING DOES NOT LOCK THE TENANT. A row whose status is
--      not_connected holds no live connection: the derivation cannot make a
--      not_connected row chargeable, because charges_enabled true always derives
--      connected. So binding a different account over it repoints nothing that
--      takes money. Write-once still refuses every connected row, and still refuses
--      a bind over a connection that is live.
--
--   3. THE RECEIPT STATES THE WINDOW THAT IS ENFORCED. begin_payment_connection now
--      returns bindDeadline: the last moment a handoff may bind a new account. It is
--      computed by the same helper record_payment_connection enforces, so the two
--      cannot disagree. expiresAt is still the ledger's link expiry.
--
--   4. replayed MEANS THIS HANDOFF WAS ALREADY RECORDED. 0093 returned whether the
--      CONNECTION held an account, which is not a fact about the handoff and made
--      the writer compute its own flag from a read taken before the provider was
--      called. Two concurrent resolves could both report that they were first. The
--      handoff row is now locked for the duration of the call, and the flag is read
--      under that lock.
--
-- LOCK ORDER. record takes the handoff row, then the connection row. begin takes
-- neither lock across a handoff; observe takes only the connection row. So no two
-- of them ever wait on each other in opposite orders.
--
-- REVERT IS FORWARD-ONLY, as for 0093. Never a DROP: every migration must still
-- replay from zero on an empty database.
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
-- RPC 1 of 4 -- begin a handoff. OWNER action. Redefined only to return bindDeadline.
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
  perform lumin.flow_actor(p_actor, p_tenant, true);

  if not exists (select 1 from public.confirmable_payment_providers where provider = p_provider) then
    raise exception 'PAYMENT_PROVIDER_NOT_CONFIRMABLE'
      using errcode = '22023', detail = format('provider %s is not declared confirmable in this deployment', p_provider);
  end if;

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
  select id into conn_id from public.payment_connections where tenant_id = p_tenant and provider = p_provider;

  begin
    insert into public.payment_connection_handoffs (handoff_id, tenant_id, provider, idempotency_key, expires_at)
    values (p_handoff_id, p_tenant, p_provider, p_idempotency_key, p_expires_at);
  exception when unique_violation then
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
                            'replayed', existing.handoff_id <> p_handoff_id);
end
$fn$;

-- ----------------------------------------------------------------------------
-- RPC 2 of 4 -- record what the provider said about a handoff's account.
-- OWNER action. Redefined for the four repairs in the header.
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
declare h public.payment_connection_handoffs; row_before public.payment_connections; new_status text; was_recorded boolean;
begin
  perform lumin.flow_actor(p_actor, p_tenant, true);

  -- The handoff, LOCKED. Two concurrent records of one handoff serialise here, and
  -- the second one reads what the first committed, so was_recorded is a fact about
  -- this call and not a race with another.
  select * into h from public.payment_connection_handoffs
   where handoff_id = p_handoff_id and tenant_id = p_tenant for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'no handoff of this tenant matches';
  end if;
  was_recorded := h.resolved_at is not null;

  select * into row_before from public.payment_connections
   where tenant_id = p_tenant and provider = h.provider for update;
  if not found then
    raise exception 'CONNECTION_UNVERIFIED' using errcode = '22023', detail = 'no connection row for this handoff';
  end if;

  -- A bind must name an account. Spelled out rather than left to the comparison
  -- below, because `account_id <> NULL` is NULL, not true.
  if p_account_id is null then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'a bind must name a provider account';
  end if;
  -- Shape-checked here as well as by the column constraint, so a malformed
  -- reference is refused as unverifiable rather than surfacing as a 23514.
  if p_account_id !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$' then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'provider account reference is not header-safe';
  end if;

  -- THE WINDOW GOVERNS A NEW BIND ONLY. A record for the account this connection
  -- already holds refreshes that account, or records that the provider has since
  -- disowned it. Refusing that after an hour would leave a revoked merchant shown as
  -- connected for ever, and a live one unable to refresh. The handoff is still
  -- required to belong to this tenant, which is checked above.
  if row_before.account_id is distinct from p_account_id
     and lumin.payment_handoff_bind_deadline(h.expires_at) < clock_timestamp() then
    raise exception 'CONNECTION_UNVERIFIED'
      using errcode = '22023', detail = 'this handoff has expired; begin a new one';
  end if;

  -- WRITE-ONCE WHILE LIVE. Rebinding a connection that is live, or that the provider
  -- has not yet disowned, to a different account would silently move a tenant's
  -- money. A DEAD connection (revoked, error) is the owner's reconnect. A
  -- NOT_CONNECTED one never took money: its owner did not finish, and the next
  -- handoff is the next attempt, not a second merchant.
  if row_before.account_id is not null
     and row_before.account_id <> p_account_id
     and row_before.status not in ('revoked', 'error', 'not_connected') then
    raise exception 'PAYMENT_CONNECTION_ALREADY_BOUND'
      using errcode = '42501', detail = 'this connection is already bound to a different account';
  end if;

  -- An OWNER binding restarts the derivation from 'not_connected' when the connection
  -- was dead, so a reconnect is not stuck on 'revoked'. Automation cannot reach this
  -- function: observe_payment_connection, which has no actor, cannot.
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
                            'replayed', was_recorded);
end
$fn$;

-- The redefined functions keep their grants, which CREATE OR REPLACE preserves. They
-- are restated here so this migration states the reachability it relies on, and so
-- a later change that drops it is visible in this file.
revoke all on function
  public.begin_payment_connection(uuid, uuid, text, text, text, timestamptz),
  public.record_payment_connection(uuid, uuid, text, text, boolean, boolean, boolean, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  public.begin_payment_connection(uuid, uuid, text, text, text, timestamptz),
  public.record_payment_connection(uuid, uuid, text, text, boolean, boolean, boolean, text, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- Guard: prove what the header claims at apply time.
-- ----------------------------------------------------------------------------
do $guard$
begin
  -- The window is one hour past the LEDGER expiry, and the helper is the only place
  -- that says so. Pin both the arithmetic and the reachability.
  if lumin.payment_handoff_bind_deadline(timestamptz '2030-06-01 12:00:00+00')
     <> timestamptz '2030-06-01 13:00:00+00' then
    raise exception 'PAYMENT_HANDOFF_BIND_DEADLINE_WRONG';
  end if;
  if has_function_privilege('anon', 'lumin.payment_handoff_bind_deadline(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'lumin.payment_handoff_bind_deadline(timestamptz)', 'execute')
     or has_function_privilege('service_role', 'lumin.payment_handoff_bind_deadline(timestamptz)', 'execute') then
    raise exception 'PAYMENT_HANDOFF_BIND_DEADLINE_REACHABLE';
  end if;
  -- The two RPCs must still be the only reachable writers, and reachable by the runtime.
  if not has_function_privilege('service_role', 'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or not has_function_privilege('service_role', 'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)', 'execute') then
    raise exception 'PAYMENT_CONNECTION_RPC_UNREACHABLE';
  end if;
  if has_function_privilege('anon', 'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)', 'execute') then
    raise exception 'PAYMENT_CONNECTION_RPC_CLIENT_REACHABLE';
  end if;
end
$guard$;

commit;
