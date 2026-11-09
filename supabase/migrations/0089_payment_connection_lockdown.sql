-- 0089 payment connection lockdown.
--
-- 0007_rls.sql:66-70 grants insert/update/delete on public.payment_connections to
-- `authenticated`, and 0007_rls.sql:205-222 adds owner_insert/owner_update/
-- owner_delete policies to it. Together they let a BUSINESS_OWNER write that table
-- directly through PostgREST: choose the provider string, set status='connected',
-- and put anything in the free-form config jsonb.
--
-- Every one of those is a server authority, not an owner authority. A tenant's
-- payment connection decides which connected account a charge is created on and
-- whether this tenant is treated as payment-capable at all; an owner who can
-- declare it has a path to point money at an account the platform never verified.
--
-- STRICTLY CLOSING. No route, no credential, nothing opened. The owner-facing
-- write path returns as service_role RPCs that verify the connection with the
-- provider before recording it; until then nothing is lost, because no
-- application code writes this table (verified: zero references in apps/ and
-- packages/, and no SQL writer outside the RLS attack fixture).
--
-- member_or_admin_select is deliberately kept: the portal must still be able to
-- SHOW a tenant's connection status. Reading is not the hazard.
--
-- Scope is payment_connections alone. calendar/notification/webhook connections
-- carry no money authority and keep their owner-managed write path.
begin;

revoke insert, update, delete on public.payment_connections from authenticated;

drop policy if exists "owner_insert" on public.payment_connections;
drop policy if exists "owner_update" on public.payment_connections;
drop policy if exists "owner_delete" on public.payment_connections;

comment on table public.payment_connections is
 'Per-tenant payment provider connection. SERVER-AUTHORITATIVE: clients may read their own tenant row (member_or_admin_select) and may never write it. provider, status and config decide which connected account money is created on, so they are set only by a service_role path that has verified the connection with the provider. Never grant a write verb or add a write policy here.';

-- Fail closed if a later migration re-opens a client write verb or write policy.
do $guard$
begin
  if exists (
    select 1 from unnest(array['insert','update','delete']) v
     where has_table_privilege('authenticated','public.payment_connections',v)
        or has_table_privilege('anon','public.payment_connections',v)
  ) then
    raise exception 'PAYMENT_CONNECTION_WRITE_VERB_REACHABLE';
  end if;
  if exists (
    select 1 from pg_policy
     where polrelid = 'public.payment_connections'::regclass
       and polcmd <> 'r'
  ) then
    raise exception 'PAYMENT_CONNECTION_WRITE_POLICY_PRESENT';
  end if;
end
$guard$;

commit;
