-- ============================================================================
-- 0007_rls.sql — THE SECURITY CORE (SI-4, SI-5)
--
-- Row Level Security is ENABLED **and FORCED** on every table, deny-by-default:
-- a table with no policy for a role yields zero rows / rejects every write for
-- that role. Application code is a convenience layer; THIS file is the
-- security boundary.
--
-- Roles (Supabase):
--   anon          — the public checkout. Read-only catalog + availability
--                   inputs + checkout branding. Booking drafts ONLY through
--                   the SECURITY DEFINER RPC at the bottom of this file.
--   authenticated — tenant members (portal) and platform admins (command
--                   center). Separate trust levels, separate tables (SI-9).
--   service_role  — trusted server runtime (edge functions). BYPASSRLS.
--   postgres      — migration/dashboard role. On Supabase it holds BYPASSRLS,
--                   which is what FORCE + the SECURITY DEFINER helpers assume.
--
-- Recursion note: policies on tenant_members / platform_admins are written
-- against auth.uid() directly (never via helpers that read the same table),
-- so helper-based policies on every other table always terminate.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enable + FORCE RLS on EVERY table.
-- ----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'tenant_members', 'platform_admins', 'tenant_invitations',
    'services', 'service_items', 'service_addons', 'service_questions',
    'resources', 'locations', 'service_areas',
    'availability_rules', 'availability_overrides', 'scheduling_policies',
    'customers', 'bookings', 'booking_state_history', 'payments', 'refunds',
    'payment_connections', 'calendar_connections',
    'notification_connections', 'webhook_connections',
    'payment_connection_secrets', 'calendar_connection_secrets',
    'notification_connection_secrets', 'webhook_connection_secrets',
    'checkout_settings', 'tenant_settings', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$do$;

-- ----------------------------------------------------------------------------
-- 2. Table privileges. Start from zero for the API roles (this also undoes
--    Supabase's permissive default privileges), then grant the minimum.
--    RLS decides WHICH rows; grants decide WHICH verbs are reachable at all.
-- ----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant all on all tables    in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- Tenant-member managed tables: members read/write (policies scope rows).
grant select, insert, update, delete on
  public.services, public.service_items, public.service_addons,
  public.service_questions, public.resources, public.locations,
  public.service_areas, public.availability_rules,
  public.availability_overrides, public.scheduling_policies,
  public.customers, public.bookings,
  public.tenant_members, public.tenant_invitations,
  public.payment_connections, public.calendar_connections,
  public.notification_connections, public.webhook_connections,
  public.checkout_settings, public.tenant_settings
to authenticated;

-- Read-only for clients (writes are service_role/trigger territory, SI-2):
grant select on
  public.tenants, public.platform_admins, public.booking_state_history,
  public.payments, public.refunds, public.audit_events
to authenticated;

-- Public checkout catalog (anon): read-only, rows scoped by policies below.
grant select on
  public.services, public.service_items, public.service_addons,
  public.service_questions, public.service_areas,
  public.availability_rules, public.availability_overrides,
  public.scheduling_policies, public.checkout_settings
to anon;

-- *_connection_secrets: NO grants to anon/authenticated — combined with zero
-- policies below, credentials are unreachable from any client role (SI-5).

-- audit_events is append-only for EVERYONE, including the server runtime.
-- (Table owner may manage retention via a future migration if ever needed.)
revoke update, delete on public.audit_events from anon, authenticated, service_role;

-- booking_state_history rows are written only by the SECURITY DEFINER trigger.
revoke insert, update, delete on public.booking_state_history
  from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Identity tables — policies written directly against auth.uid()
--    (recursion-safe; see header).
-- ----------------------------------------------------------------------------

-- tenants: members see their tenant; platform admins see all.
-- INSERT/UPDATE/DELETE: service_role only (no policies ⇒ denied for clients).
-- Tenant profile edits go through the trusted server runtime.
create policy "member_or_admin_select" on public.tenants
  for select to authenticated
  using (lumin.is_tenant_member(id) or lumin.is_platform_admin());

-- tenant_members: a user always sees their own memberships; members see their
-- tenant's roster; platform admins see all. ALL writes require BUSINESS_OWNER
-- of that tenant — BUSINESS_STAFF cannot touch membership rows (no
-- escalation path). Bootstrap of the first owner row is service_role's job.
create policy "self_or_member_or_admin_select" on public.tenant_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or lumin.is_tenant_member(tenant_id)
    or lumin.is_platform_admin()
  );

create policy "owner_insert" on public.tenant_members
  for insert to authenticated
  with check (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER');

create policy "owner_update" on public.tenant_members
  for update to authenticated
  using (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
  with check (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER');

create policy "owner_delete" on public.tenant_members
  for delete to authenticated
  using (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER');

-- platform_admins: an admin can read their own row (non-admins simply have no
-- row ⇒ zero rows). Reading auth.uid() directly keeps lumin.is_platform_admin
-- recursion-free under FORCE RLS. Writes: service_role only (SI-9).
create policy "self_select" on public.platform_admins
  for select to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. Standard tenant-owned tables: member SELECT/INSERT/UPDATE, owner DELETE,
--    platform admin SELECT (aggregate oversight — never on secrets).
-- ----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array[
    'services', 'service_items', 'service_addons', 'service_questions',
    'resources', 'locations', 'service_areas',
    'availability_rules', 'availability_overrides', 'scheduling_policies',
    'customers', 'bookings'
  ]
  loop
    execute format($pol$
      create policy "member_or_admin_select" on public.%I
        for select to authenticated
        using (lumin.is_tenant_member(tenant_id) or lumin.is_platform_admin())
    $pol$, t);

    execute format($pol$
      create policy "member_insert" on public.%I
        for insert to authenticated
        with check (lumin.is_tenant_member(tenant_id))
    $pol$, t);

    execute format($pol$
      create policy "member_update" on public.%I
        for update to authenticated
        using (lumin.is_tenant_member(tenant_id))
        with check (lumin.is_tenant_member(tenant_id))
    $pol$, t);

    execute format($pol$
      create policy "owner_delete" on public.%I
        for delete to authenticated
        using (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
    $pol$, t);
  end loop;
end;
$do$;

-- ----------------------------------------------------------------------------
-- 5. Owner-gated tables: integration connections, settings, invitations.
--    Members may read (staff can see connection STATUS — never secrets, which
--    live in policy-less *_connection_secrets tables); every write requires
--    BUSINESS_OWNER.
-- ----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array[
    'payment_connections', 'calendar_connections',
    'notification_connections', 'webhook_connections',
    'checkout_settings', 'tenant_settings', 'tenant_invitations'
  ]
  loop
    execute format($pol$
      create policy "member_or_admin_select" on public.%I
        for select to authenticated
        using (lumin.is_tenant_member(tenant_id) or lumin.is_platform_admin())
    $pol$, t);

    execute format($pol$
      create policy "owner_insert" on public.%I
        for insert to authenticated
        with check (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
    $pol$, t);

    execute format($pol$
      create policy "owner_update" on public.%I
        for update to authenticated
        using (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
        with check (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
    $pol$, t);

    execute format($pol$
      create policy "owner_delete" on public.%I
        for delete to authenticated
        using (lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
    $pol$, t);
  end loop;
end;
$do$;

-- ----------------------------------------------------------------------------
-- 6. Financial + audit tables: client reads only; ALL writes via service_role
--    (payment/booking state is server-authoritative — SI-2).
-- ----------------------------------------------------------------------------
create policy "member_or_admin_select" on public.payments
  for select to authenticated
  using (lumin.is_tenant_member(tenant_id) or lumin.is_platform_admin());

create policy "member_or_admin_select" on public.refunds
  for select to authenticated
  using (lumin.is_tenant_member(tenant_id) or lumin.is_platform_admin());

create policy "member_or_admin_select" on public.booking_state_history
  for select to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      where b.id = booking_id
        and (lumin.is_tenant_member(b.tenant_id) or lumin.is_platform_admin())
    )
  );

-- audit_events: owners read their tenant's events; platform admins read all
-- (including platform-level events with tenant_id NULL).
create policy "owner_or_admin_select" on public.audit_events
  for select to authenticated
  using (
    (tenant_id is not null and lumin.tenant_role(tenant_id) = 'BUSINESS_OWNER')
    or lumin.is_platform_admin()
  );

-- *_connection_secrets: NO POLICIES AT ALL. RLS is forced, so even if a grant
-- ever leaked, anon/authenticated would still see zero rows and write nothing.
-- Only service_role (BYPASSRLS) reaches these tables (SI-5, SI-8).

-- ----------------------------------------------------------------------------
-- 7. PUBLIC CHECKOUT (anon) — read-only catalog + availability inputs of
--    ACTIVE tenants. lumin.tenant_is_active() gates on tenant status without
--    exposing the tenants table to anon. The same policies serve signed-in
--    visitors browsing a public checkout (to anon, authenticated).
--    NO anon policies exist on customers, bookings, payments, refunds,
--    connections, tenant_settings, tenants, members, admins, invitations,
--    history, audit — and no grants either: deny-by-default twice over.
-- ----------------------------------------------------------------------------
create policy "public_catalog_select" on public.services
  for select to anon, authenticated
  using (active and lumin.tenant_is_active(tenant_id));

create policy "public_catalog_select" on public.service_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.services s
      where s.id = service_id and s.active and lumin.tenant_is_active(s.tenant_id)
    )
  );

create policy "public_catalog_select" on public.service_addons
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.services s
      where s.id = service_id and s.active and lumin.tenant_is_active(s.tenant_id)
    )
  );

create policy "public_catalog_select" on public.service_questions
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.services s
      where s.id = service_id and s.active and lumin.tenant_is_active(s.tenant_id)
    )
  );

create policy "public_catalog_select" on public.service_areas
  for select to anon, authenticated
  using (
    lumin.tenant_is_active(tenant_id)
    and (service_id is null or exists (
      select 1 from public.services s where s.id = service_id and s.active
    ))
  );

create policy "public_catalog_select" on public.availability_rules
  for select to anon, authenticated
  using (
    lumin.tenant_is_active(tenant_id)
    and (service_id is null or exists (
      select 1 from public.services s where s.id = service_id and s.active
    ))
  );

create policy "public_catalog_select" on public.availability_overrides
  for select to anon, authenticated
  using (
    lumin.tenant_is_active(tenant_id)
    and (service_id is null or exists (
      select 1 from public.services s where s.id = service_id and s.active
    ))
  );

create policy "public_catalog_select" on public.scheduling_policies
  for select to anon, authenticated
  using (
    lumin.tenant_is_active(tenant_id)
    and (service_id is null or exists (
      select 1 from public.services s where s.id = service_id and s.active
    ))
  );

-- Checkout branding/flow is public by definition (and must contain no secrets).
create policy "public_branding_select" on public.checkout_settings
  for select to anon, authenticated
  using (lumin.tenant_is_active(tenant_id));

-- ----------------------------------------------------------------------------
-- 8. Anonymous booking creation — SECURITY DEFINER RPC.
--
-- The public checkout NEVER inserts into bookings/customers directly (no anon
-- policies or grants exist there). It calls this RPC, which validates the
-- tenant and service, then inserts a customer + a booking in state 'draft'
-- with SERVER-SET values only:
--   * state is hard-coded 'draft'; pricing is '{}' — the client cannot submit
--     prices (SI-1);
--   * reference and ids are generated server-side;
--   * (tenant_id, idempotency_key) makes creation idempotent — a retry (or a
--     lost race) returns the original booking (SI-3).
--
-- Pricing and payment finalization NEVER happen here and NEVER as anon: the
-- trusted server runtime (edge function, service_role) reprices the selection
-- with the PricingEngine, verifies availability (fail closed, SI-7), creates
-- the payment intent, and drives draft → pending_payment → confirmed through
-- the trigger-enforced state machine (SI-2).
-- ----------------------------------------------------------------------------
create or replace function lumin.create_booking_draft(
  p_tenant_id       uuid,
  p_idempotency_key text,
  p_selection       jsonb,
  p_slot_start      timestamptz,
  p_slot_end        timestamptz,
  p_customer        jsonb,
  p_address         jsonb default null,
  p_notes           text default null
)
returns table (booking_id uuid, reference text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_service_id  uuid;
  v_customer_id uuid;
  v_name        text;
  v_email       text;
  v_phone       text;
  v_ref         text;
  v_constraint  text;
  v_attempt     integer;
begin
  -- Tenant must exist and be active.
  if not exists (
    select 1 from public.tenants tn
    where tn.id = p_tenant_id and tn.status = 'active'
  ) then
    raise exception 'TENANT_MISMATCH' using errcode = 'P0001';
  end if;

  -- Idempotency key: same contract rule as CreateBookingRequest (min 16).
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001',
      detail = 'idempotency_key must be at least 16 characters';
  end if;

  -- Retry / replay: return the existing draft for this idempotency key.
  select b.id, b.reference into booking_id, reference
  from public.bookings b
  where b.tenant_id = p_tenant_id
    and b.idempotency_key = p_idempotency_key;
  if found then
    return next;
    return;
  end if;

  -- Selection must reference an ACTIVE service of THIS tenant.
  if p_selection is null or jsonb_typeof(p_selection) <> 'object' then
    raise exception 'INVALID_SELECTION' using errcode = 'P0001';
  end if;
  begin
    v_service_id := (p_selection ->> 'serviceId')::uuid;
  exception when invalid_text_representation then
    v_service_id := null;
  end;
  if v_service_id is null or not exists (
    select 1 from public.services s
    where s.id = v_service_id and s.tenant_id = p_tenant_id and s.active
  ) then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Slot shape only (full availability proof happens fail-closed in the
  -- trusted runtime before pending_payment — SI-7).
  if p_slot_start is null or p_slot_end is null or p_slot_end <= p_slot_start then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001',
      detail = 'slot_end must be after slot_start';
  end if;

  -- Customer details (CustomerDetails contract).
  v_name  := nullif(btrim(coalesce(p_customer ->> 'name',  '')), '');
  v_email := nullif(btrim(coalesce(p_customer ->> 'email', '')), '');
  v_phone := nullif(btrim(coalesce(p_customer ->> 'phone', '')), '');
  if v_name is null or v_email is null or position('@' in v_email) <= 1 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001',
      detail = 'customer name and a valid email are required';
  end if;

  insert into public.customers as c (tenant_id, name, email, phone)
  values (p_tenant_id, v_name, v_email, v_phone)
  on conflict (tenant_id, email) do update
    set name  = excluded.name,
        phone = coalesce(excluded.phone, c.phone)
  returning c.id into v_customer_id;

  -- Insert the draft; regenerate the reference on the rare collision.
  for v_attempt in 1..5 loop
    v_ref := 'LMN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.bookings
        (tenant_id, reference, state, selection, pricing, slot_start, slot_end,
         customer_id, address, idempotency_key, notes)
      values
        (p_tenant_id, v_ref, 'draft', p_selection, '{}'::jsonb, p_slot_start,
         p_slot_end, v_customer_id, p_address, p_idempotency_key, p_notes)
      returning id into booking_id;
      reference := v_ref;
      return next;
      return;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint like '%idempotency%' then
        -- Lost a race on the same idempotency key: return the winner (SI-3).
        select b.id, b.reference into booking_id, reference
        from public.bookings b
        where b.tenant_id = p_tenant_id
          and b.idempotency_key = p_idempotency_key;
        if found then
          return next;
          return;
        end if;
        raise exception 'DUPLICATE_BOOKING' using errcode = 'P0001';
      end if;
      -- else: reference collision — loop and regenerate.
    end;
  end loop;

  raise exception 'DUPLICATE_BOOKING' using errcode = 'P0001',
    detail = 'could not allocate a unique booking reference';
end;
$fn$;

revoke all on function lumin.create_booking_draft(uuid, text, jsonb, timestamptz, timestamptz, jsonb, jsonb, text) from public;
grant execute on function lumin.create_booking_draft(uuid, text, jsonb, timestamptz, timestamptz, jsonb, jsonb, text)
  to anon, authenticated, service_role;

-- Thin wrapper in `public` so PostgREST exposes the RPC without adding the
-- whole `lumin` schema to the API (SECURITY INVOKER: the caller still needs —
-- and anon has — EXECUTE on the lumin function).
create or replace function public.create_booking_draft(
  p_tenant_id       uuid,
  p_idempotency_key text,
  p_selection       jsonb,
  p_slot_start      timestamptz,
  p_slot_end        timestamptz,
  p_customer        jsonb,
  p_address         jsonb default null,
  p_notes           text default null
)
returns table (booking_id uuid, reference text)
language sql
volatile
as $fn$
  select * from lumin.create_booking_draft(
    p_tenant_id, p_idempotency_key, p_selection, p_slot_start, p_slot_end,
    p_customer, p_address, p_notes
  );
$fn$;

revoke all on function public.create_booking_draft(uuid, text, jsonb, timestamptz, timestamptz, jsonb, jsonb, text) from public;
grant execute on function public.create_booking_draft(uuid, text, jsonb, timestamptz, timestamptz, jsonb, jsonb, text)
  to anon, authenticated, service_role;
