-- Security-advisor regression checks for migration 0100.
-- The assertions are deliberately about exact role boundaries and function
-- configuration, not about advisory count alone.
do $$
declare
  target regprocedure;
  targets regprocedure[] := array[
    'public.create_booking_draft(uuid,text,jsonb,timestamptz,timestamptz,jsonb,jsonb,text)'::regprocedure,
    'public.reserve_capacity(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)'::regprocedure,
    'public.consume_hold(uuid)'::regprocedure,
    'public.release_hold(uuid)'::regprocedure,
    'public.reserve_resource(uuid,uuid,timestamptz,timestamptz,uuid,interval)'::regprocedure,
    'public.consume_resource_holds(uuid)'::regprocedure,
    'public.release_resource_holds(uuid)'::regprocedure,
    'lumin.enforce_booking_transition()'::regprocedure,
    'lumin.guard_booking_client_write()'::regprocedure,
    'lumin.touch_updated_at()'::regprocedure
  ];
  cfg text[];
begin
  foreach target in array targets loop
    select p.proconfig into cfg from pg_proc p where p.oid = target;
    if cfg is null or not ('search_path=pg_catalog' = any(cfg)) then
      raise exception 'SECURITY_ADVISOR_SEARCH_PATH_NOT_PINNED: %', target;
    end if;
  end loop;

  -- The public checkout draft RPC remains intentionally callable by the
  -- customer roles; the reservation/hold wrappers remain service-only.
  if not has_function_privilege(
    'anon',
    'public.create_booking_draft(uuid,text,jsonb,timestamptz,timestamptz,jsonb,jsonb,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.create_booking_draft(uuid,text,jsonb,timestamptz,timestamptz,jsonb,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY_ADVISOR_DRAFT_RPC_GRANT_CHANGED';
  end if;

  foreach target in array array[
    'public.reserve_capacity(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)'::regprocedure,
    'public.consume_hold(uuid)'::regprocedure,
    'public.release_hold(uuid)'::regprocedure,
    'public.reserve_resource(uuid,uuid,timestamptz,timestamptz,uuid,interval)'::regprocedure,
    'public.consume_resource_holds(uuid)'::regprocedure,
    'public.release_resource_holds(uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', target, 'EXECUTE')
       or has_function_privilege('authenticated', target, 'EXECUTE')
       or not has_function_privilege('service_role', target, 'EXECUTE') then
      raise exception 'SECURITY_ADVISOR_SERVICE_RPC_GRANT_CHANGED: %', target;
    end if;
  end loop;

  -- save_flow_draft is an intentional authenticated owner RPC. Its existing
  -- tenant/owner checks and pg_catalog-only path are part of this contract.
  if not has_function_privilege(
    'authenticated',
    'public.save_flow_draft(uuid,uuid,text,bigint,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.save_flow_draft(uuid,uuid,text,bigint,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'SECURITY_ADVISOR_SAVE_DRAFT_GRANT_CHANGED';
  end if;
  select p.proconfig into cfg
  from pg_proc p
  where p.oid = 'public.save_flow_draft(uuid,uuid,text,bigint,jsonb)'::regprocedure;
  if cfg is null or not ('search_path=pg_catalog' = any(cfg)) then
    raise exception 'SECURITY_ADVISOR_SAVE_DRAFT_SEARCH_PATH_CHANGED';
  end if;

  -- Platform aggregate views are intentionally security-definer views: they
  -- expose aggregates only and retain the explicit platform-admin gate.
  if not has_table_privilege('authenticated','public.platform_booking_stats','SELECT')
     or not has_table_privilege('authenticated','public.platform_economics','SELECT') then
    raise exception 'SECURITY_ADVISOR_PLATFORM_VIEW_GRANT_CHANGED';
  end if;
  if position('lumin.is_platform_admin()' in pg_get_viewdef('public.platform_booking_stats'::regclass,true)) = 0
     or position('lumin.is_platform_admin()' in pg_get_viewdef('public.platform_economics'::regclass,true)) = 0 then
    raise exception 'SECURITY_ADVISOR_PLATFORM_VIEW_GATE_MISSING';
  end if;
end
$$;

\echo PASS security-advisor search_path pins, RPC role boundaries, and platform-view gates

