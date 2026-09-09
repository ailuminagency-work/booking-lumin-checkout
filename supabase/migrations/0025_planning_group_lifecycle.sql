-- Release-only planning groups. No application constructor, allocator or worker projection.
begin;
create table public.allocation_group_heads(
 tenant_id uuid not null references public.tenants(id) on delete restrict,
 id uuid not null,booking_id uuid not null,current_generation bigint not null check(current_generation between 1 and 9007199254740991),
 primary key(tenant_id,booking_id),unique(tenant_id,id),unique(tenant_id,id,booking_id),
 foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id) on delete restrict on update restrict);
create table public.allocation_groups(
 tenant_id uuid not null,id uuid not null,generation bigint not null check(generation between 1 and 9007199254740991),booking_id uuid not null,
 service_id uuid not null,crew_id uuid not null,policy_revision bigint not null check(policy_revision between 1 and 9007199254740991),roster_version bigint not null check(roster_version between 1 and 9007199254740991),
 requested_start timestamptz not null,requested_end timestamptz not null,occupied_start timestamptz not null,occupied_end timestamptz not null,
 setup_minutes integer not null check(setup_minutes between 0 and 1440),cleanup_minutes integer not null check(cleanup_minutes between 0 and 1440),
 created_at timestamptz not null,expires_at timestamptz not null,resource_mode text not null check(resource_mode in('none','linked')),
 intent_hash bytea not null check(octet_length(intent_hash)=32),evidence_hash bytea not null check(octet_length(evidence_hash)=32),manifest_digest bytea not null check(octet_length(manifest_digest)=32),
 worker_count integer not null check(worker_count between 1 and 100),resource_count integer not null check(resource_count between 0 and 100),
 status text not null check(status in('held','released','expired')),sealed boolean not null,
 primary key(tenant_id,id,generation),unique(tenant_id,booking_id,generation),unique(tenant_id,id,generation,booking_id),unique(tenant_id,id,generation,booking_id,service_id),
 foreign key(tenant_id,id,booking_id) references public.allocation_group_heads(tenant_id,id,booking_id) on delete restrict on update restrict,
 foreign key(tenant_id,service_id) references public.services(tenant_id,id) on delete restrict on update restrict,
 foreign key(tenant_id,crew_id) references public.crews(tenant_id,id) on delete restrict on update restrict,
 check(isfinite(requested_start) and isfinite(requested_end) and requested_end>requested_start),
 check(isfinite(occupied_start) and isfinite(occupied_end) and occupied_start=requested_start-make_interval(mins=>setup_minutes) and occupied_end=requested_end+make_interval(mins=>cleanup_minutes)),
 check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at),check((resource_mode='none' and resource_count=0) or(resource_mode='linked' and resource_count>0)));
alter table public.allocation_group_heads add constraint allocation_head_current_generation foreign key(tenant_id,id,current_generation) references public.allocation_groups(tenant_id,id,generation) deferrable initially deferred;
create unique index allocation_one_held on public.allocation_groups(tenant_id,id) where status='held';
create table public.allocation_group_resources(
 tenant_id uuid not null,group_id uuid not null,generation bigint not null,resource_id uuid not null,quantity integer not null check(quantity>0),
 primary key(tenant_id,group_id,generation,resource_id),
 foreign key(tenant_id,group_id,generation) references public.allocation_groups(tenant_id,id,generation) on delete restrict on update restrict,
 foreign key(tenant_id,resource_id) references public.resources(tenant_id,id) on delete restrict on update restrict);
create table public.allocation_group_workers(
 tenant_id uuid not null,group_id uuid not null,generation bigint not null,worker_id uuid not null,
 primary key(tenant_id,group_id,generation,worker_id),
 foreign key(tenant_id,group_id,generation) references public.allocation_groups(tenant_id,id,generation) on delete restrict on update restrict,
 foreign key(tenant_id,worker_id) references public.workers(tenant_id,id) on delete restrict on update restrict);
create table public.worker_interval_holds(
 tenant_id uuid not null,group_id uuid not null,generation bigint not null,worker_id uuid not null,
 slot_start timestamptz not null,slot_end timestamptz not null,expires_at timestamptz not null,status text not null check(status in('held','released')),
 primary key(tenant_id,group_id,generation,worker_id),
 foreign key(tenant_id,group_id,generation,worker_id) references public.allocation_group_workers(tenant_id,group_id,generation,worker_id) on delete restrict on update restrict,
 check(isfinite(slot_start) and isfinite(slot_end) and slot_end>slot_start and isfinite(expires_at)));
alter table public.capacity_holds add column group_id uuid,add column group_generation bigint,
 add constraint capacity_group_marker check((group_id is null)=(group_generation is null)),
 add constraint capacity_group_tuple foreign key(tenant_id,group_id,group_generation,booking_id,service_id) references public.allocation_groups(tenant_id,id,generation,booking_id,service_id) on delete restrict on update restrict;
alter table public.resource_reservations add column group_id uuid,add column group_generation bigint,
 add constraint resource_group_marker check((group_id is null)=(group_generation is null)),
 add constraint resource_group_booking foreign key(tenant_id,group_id,group_generation,booking_id) references public.allocation_groups(tenant_id,id,generation,booking_id) on delete restrict on update restrict,
 add constraint resource_group_manifest foreign key(tenant_id,group_id,group_generation,resource_id) references public.allocation_group_resources(tenant_id,group_id,generation,resource_id) on delete restrict on update restrict;
create function lumin.group_rc() returns void language plpgsql set search_path=pg_catalog as $$begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'GROUP_ISOLATION_UNSUPPORTED' using errcode='0A000';end if;
end $$;
create function lumin.group_prefix(p_strong boolean) returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 perform lumin.group_rc();lock table public.allocation_policies in share mode;
 if p_strong then lock table public.allocation_group_heads in share row exclusive mode;
 else lock table public.allocation_group_heads in share mode;end if;
end $$;
create function lumin.group_require_fence() returns void language plpgsql set search_path=pg_catalog as $$begin
 perform lumin.group_rc();
 if not exists(select 1 from pg_locks where pid=pg_backend_pid() and database=(select oid from pg_database where datname=current_database()) and relation='public.allocation_group_heads'::regclass and granted and mode in('ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')) then
 raise exception 'GROUP_WRITE_PROTOCOL' using errcode='55000';end if;
end $$;
create function lumin.group_statement() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 perform lumin.group_prefix(tg_argv[0]='strong');return null;
end $$;
create function lumin.group_digest(p_tenant uuid,p_group uuid,p_generation bigint) returns bytea language sql stable security definer set search_path=pg_catalog as $$
 select pg_catalog.sha256(convert_to(jsonb_build_array(1,
 coalesce((select jsonb_agg(worker_id order by worker_id) from public.allocation_group_workers where tenant_id=p_tenant and group_id=p_group and generation=p_generation),'[]'::jsonb),
 coalesce((select jsonb_agg(jsonb_build_array(resource_id,quantity) order by resource_id) from public.allocation_group_resources where tenant_id=p_tenant and group_id=p_group and generation=p_generation),'[]'::jsonb))::text,'UTF8'))
$$;
create function lumin.group_validate(p_tenant uuid,p_group uuid,p_generation bigint) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare g public.allocation_groups%rowtype;h public.allocation_group_heads%rowtype;
begin
 perform lumin.group_require_fence();
 select * into h from public.allocation_group_heads where tenant_id=p_tenant and id=p_group for update;
 if not found then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 select * into g from public.allocation_groups where tenant_id=p_tenant and id=p_group and generation=p_generation for update;
 if not found then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 if not g.sealed then raise exception 'GROUP_UNSEALED' using errcode='55000';end if;
 if not exists(select 1 from public.bookings b where b.tenant_id=g.tenant_id and b.id=g.booking_id and b.state='draft' and lumin.planning_service_id(b.selection)=g.service_id and b.slot_start=g.requested_start and b.slot_end=g.requested_end) then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 if exists(select 1 from public.allocation_groups where tenant_id=p_tenant and id=p_group and status='held' and generation<>h.current_generation)
 or not exists(select 1 from public.allocation_groups where tenant_id=p_tenant and id=p_group and generation=h.current_generation)
 or g.worker_count<>(select count(*) from public.allocation_group_workers where tenant_id=p_tenant and group_id=p_group and generation=p_generation)
 or g.resource_count<>(select count(*) from public.allocation_group_resources where tenant_id=p_tenant and group_id=p_group and generation=p_generation)
 or g.manifest_digest is distinct from lumin.group_digest(p_tenant,p_group,p_generation) then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 if exists(select 1 from public.capacity_holds where tenant_id=p_tenant and group_id=p_group and group_generation=p_generation and (slot_start<>g.occupied_start or slot_end<>g.occupied_end or expires_at<>g.expires_at or status not in('active','released')))
 or exists(select 1 from public.resource_reservations r join public.allocation_group_resources m on(m.tenant_id,m.group_id,m.generation,m.resource_id)=(r.tenant_id,r.group_id,r.group_generation,r.resource_id) where r.tenant_id=p_tenant and r.group_id=p_group and r.group_generation=p_generation and (r.quantity<>m.quantity or r.slot_start<>g.occupied_start or r.slot_end<>g.occupied_end or r.expires_at<>g.expires_at or r.status not in('held','released')))
 or exists(select 1 from public.worker_interval_holds where tenant_id=p_tenant and group_id=p_group and generation=p_generation and(slot_start<>g.occupied_start or slot_end<>g.occupied_end or expires_at<>g.expires_at)) then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 if g.status='held' then
  if (select count(*) from public.capacity_holds where tenant_id=p_tenant and group_id=p_group and group_generation=p_generation and status='active')<>1
  or (select count(*) from public.resource_reservations where tenant_id=p_tenant and group_id=p_group and group_generation=p_generation and status='held')<>g.resource_count
  or (select count(*) from public.worker_interval_holds where tenant_id=p_tenant and group_id=p_group and generation=p_generation and status='held')<>g.worker_count then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 else
  if exists(select 1 from public.capacity_holds where tenant_id=p_tenant and group_id=p_group and group_generation=p_generation and status<>'released')
  or exists(select 1 from public.resource_reservations where tenant_id=p_tenant and group_id=p_group and group_generation=p_generation and status<>'released')
  or exists(select 1 from public.worker_interval_holds where tenant_id=p_tenant and group_id=p_group and generation=p_generation and status<>'released') then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 end if;
end $$;
create function lumin.group_identity() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare g public.allocation_groups%rowtype;
begin
 perform lumin.group_require_fence();
 if tg_op='DELETE' then raise exception 'GROUP_HISTORY_RETAINED' using errcode='0A000';end if;
 if tg_table_name='allocation_group_heads' then
  if tg_op='INSERT' and new.current_generation<>1 then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
  if tg_op='UPDATE' then
   if (to_jsonb(new)-'current_generation') is distinct from (to_jsonb(old)-'current_generation') then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
   if new.current_generation<>old.current_generation and (old.current_generation=9007199254740991 or new.current_generation<>old.current_generation+1 or not exists(select 1 from public.allocation_groups where tenant_id=old.tenant_id and id=old.id and generation=old.current_generation and sealed and status in('released','expired'))) then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
  end if;
 else
  if tg_op='INSERT' then
   if new.sealed or new.status<>'held' or not exists(select 1 from public.allocation_group_heads where tenant_id=new.tenant_id and id=new.id and current_generation=new.generation) then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
  else
   if (to_jsonb(new)-array['status','sealed']) is distinct from(to_jsonb(old)-array['status','sealed']) or(old.sealed and not new.sealed) or(old.status<>'held' and new.status<>old.status) or(not old.sealed and new.status<>old.status) then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
  end if;
 end if;return new;
end $$;
create function lumin.group_manifest_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v jsonb;g public.allocation_groups%rowtype;
begin
 perform lumin.group_require_fence();
 for v in select x from unnest(array[case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end])x where x is not null loop
  select * into g from public.allocation_groups where tenant_id=(v->>'tenant_id')::uuid and id=(v->>'group_id')::uuid and generation=(v->>'generation')::bigint;
  if not found or g.sealed then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create function lumin.group_carrier_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare o jsonb;n jsonb;og public.allocation_groups%rowtype;ng public.allocation_groups%rowtype;ngen bigint;ogen bigint;
begin
 perform lumin.group_rc();if tg_op<>'INSERT' then o:=to_jsonb(old);end if;if tg_op<>'DELETE' then n:=to_jsonb(new);end if;
 if o->>'group_id' is null and n->>'group_id' is null then if tg_op='DELETE' then return old;end if;return new;end if;
 perform lumin.group_require_fence();
 if tg_op='DELETE' or n->>'group_id' is null then raise exception 'GROUP_HISTORY_RETAINED' using errcode='0A000';end if;
 ngen:=coalesce(n->>'group_generation',n->>'generation')::bigint;ogen:=coalesce(o->>'group_generation',o->>'generation')::bigint;
 select * into ng from public.allocation_groups where tenant_id=(n->>'tenant_id')::uuid and id=(n->>'group_id')::uuid and generation=ngen;
 if not found then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 if o->>'group_id' is not null then
  select * into og from public.allocation_groups where tenant_id=(o->>'tenant_id')::uuid and id=(o->>'group_id')::uuid and generation=ogen;
  if not found then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
  if (o->>'tenant_id',o->>'group_id') is distinct from(n->>'tenant_id',n->>'group_id') then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
  if ogen<>ngen then
   if og.status='held' or ng.sealed or not exists(select 1 from public.allocation_group_heads where tenant_id=ng.tenant_id and id=ng.id and current_generation=ngen) then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
   if (o-array['group_generation','generation','slot_start','slot_end','expires_at','status','hold_key','quantity']) is distinct from(n-array['group_generation','generation','slot_start','slot_end','expires_at','status','hold_key','quantity']) then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
  else
   if (o-'status') is distinct from(n-'status') or(o->>'status'='released' and n->>'status'<>'released') then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
  end if;
 elsif tg_op<>'INSERT' or ng.sealed then raise exception 'GROUP_IMMUTABLE' using errcode='55000';end if;
 if n->>'status' not in('active','held','released') or (tg_table_name='capacity_holds' and n->>'status'='held') or(tg_table_name<>'capacity_holds' and n->>'status'='active') then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 return new;
end $$;
create function lumin.group_deferred() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r record;
begin
 perform lumin.group_rc();
 -- Exact affected tuples derive only from trusted transition records.
 for r in select distinct (x->>'tenant_id')::uuid t,
 (case when tg_table_name in('allocation_group_heads','allocation_groups') then x->>'id' else x->>'group_id' end)::uuid g,
 (case when tg_table_name='allocation_group_heads' then x->>'current_generation' else coalesce(x->>'group_generation',x->>'generation') end)::bigint gen
 from unnest(array[case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end])x where x is not null order by t,g,gen loop
  if r.g is not null then perform lumin.group_validate(r.t,r.g,r.gen);end if;
 end loop;return null;
end $$;
create function lumin.group_seal_check() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.sealed and not old.sealed then perform lumin.group_validate(new.tenant_id,new.id,new.generation);end if;return null;
end $$;
create function lumin.group_legacy_guard(p_booking uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 perform lumin.group_prefix(false);
 if exists(select 1 from public.allocation_group_heads where booking_id=p_booking)
 or exists(select 1 from public.capacity_holds where booking_id=p_booking and group_id is not null)
 or exists(select 1 from public.resource_reservations where booking_id=p_booking and group_id is not null) then raise exception 'GROUP_MANAGED' using errcode='0A000';end if;
end $$;
create function lumin.group_parent_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare referenced boolean:=false;
begin
 -- Ordinary roster retirement/name/access edits must not acquire a late group fence.
 if tg_op='UPDATE' then
  if tg_table_name='bookings' then
   if (new.id,new.tenant_id,new.selection,new.slot_start,new.slot_end,new.state) is not distinct from(old.id,old.tenant_id,old.selection,old.slot_start,old.slot_end,old.state) then return new;end if;
  elsif (to_jsonb(new)->'id',to_jsonb(new)->'tenant_id') is not distinct from(to_jsonb(old)->'id',to_jsonb(old)->'tenant_id') then return new;end if;
 end if;
 perform lumin.group_prefix(false);
 case tg_table_name
 when 'bookings' then select exists(select 1 from public.allocation_group_heads where booking_id=old.id) into referenced;
 when 'tenants' then select exists(select 1 from public.allocation_group_heads where tenant_id=old.id) into referenced;
 when 'services' then select exists(select 1 from public.allocation_groups where service_id=old.id) into referenced;
 when 'crews' then select exists(select 1 from public.allocation_groups where crew_id=old.id) into referenced;
 when 'workers' then select exists(select 1 from public.allocation_group_workers where worker_id=old.id) into referenced;
 when 'resources' then select exists(select 1 from public.allocation_group_resources where resource_id=old.id) into referenced;
 end case;
 if referenced then raise exception 'GROUP_HISTORY_RETAINED' using errcode='0A000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create function lumin.group_truncate_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare managed boolean;
begin
 perform lumin.group_prefix(false);
 if tg_table_name in('capacity_holds','resource_reservations') then
  execute format('select exists(select 1 from public.%I where group_id is not null)',tg_table_name) into managed;
  if not managed then return null;end if;
 end if;raise exception 'GROUP_HISTORY_RETAINED' using errcode='0A000';
end $$;
do $$declare t text;begin
 foreach t in array array['allocation_group_heads','allocation_groups','allocation_group_resources','allocation_group_workers','worker_interval_holds'] loop
  execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger group_protocol before insert or update or delete on public.%I for each statement execute function lumin.group_statement(''strong'')',t);
  execute format('create constraint trigger group_final after insert or update or delete on public.%I deferrable initially deferred for each row execute function lumin.group_deferred()',t);
  execute format('create trigger group_no_truncate before truncate on public.%I for each statement execute function lumin.group_truncate_guard()',t);
 end loop;
 foreach t in array array['allocation_group_heads','allocation_groups'] loop execute format('create trigger group_identity before insert or update or delete on public.%I for each row execute function lumin.group_identity()',t);end loop;
 foreach t in array array['allocation_group_resources','allocation_group_workers'] loop execute format('create trigger group_manifest before insert or update or delete on public.%I for each row execute function lumin.group_manifest_guard()',t);end loop;
 foreach t in array array['capacity_holds','resource_reservations'] loop
  execute format('create trigger group_protocol before insert or update or delete on public.%I for each statement execute function lumin.group_statement(''weak'')',t);
  execute format('create constraint trigger group_final after insert or update or delete on public.%I deferrable initially deferred for each row execute function lumin.group_deferred()',t);
  execute format('create trigger group_no_truncate before truncate on public.%I for each statement execute function lumin.group_truncate_guard()',t);
 end loop;
 foreach t in array array['capacity_holds','resource_reservations','worker_interval_holds'] loop execute format('create trigger group_carrier before insert or update or delete on public.%I for each row execute function lumin.group_carrier_guard()',t);end loop;
 foreach t in array array['bookings','tenants','services','resources','workers','crews'] loop execute format('create trigger zz_group_parent before update or delete on public.%I for each row execute function lumin.group_parent_guard()',t);end loop;
end $$;
create trigger group_seal after update on public.allocation_groups for each row execute function lumin.group_seal_check();
-- Preserve accepted PL/pgSQL bodies and ACL/OIDs, adding only the shared preamble.
-- Both public wrappers and directly service-granted lumin functions reach it.
do $$declare p record;d text;patched text;expected oid[];begin
 if (select count(*) from pg_proc where pronamespace='lumin'::regnamespace and proname in('reserve_capacity','reserve_capacity_nonplanning','reserve_resource_quantity','consume_hold','release_hold','consume_resource_holds','release_resource_holds'))<>7 then raise exception 'GROUP_LEGACY_INVENTORY_MISMATCH';end if;
 expected:=array['lumin.reserve_capacity(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)'::regprocedure::oid,
 'lumin.reserve_capacity_nonplanning(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)'::regprocedure::oid,
 'lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer)'::regprocedure::oid,
 'lumin.consume_hold(uuid)'::regprocedure::oid,'lumin.release_hold(uuid)'::regprocedure::oid,
 'lumin.consume_resource_holds(uuid)'::regprocedure::oid,'lumin.release_resource_holds(uuid)'::regprocedure::oid];
 if (select count(*) from pg_proc where oid=any(expected) and prolang=(select oid from pg_language where lanname='plpgsql') and prosecdef)<>7 then raise exception 'GROUP_LEGACY_INVENTORY_MISMATCH';end if;
 for p in select oid,proname from pg_proc where pronamespace='lumin'::regnamespace and proname in('reserve_capacity','reserve_capacity_nonplanning','reserve_resource_quantity','consume_hold','release_hold','consume_resource_holds','release_resource_holds') loop
  d:=pg_get_functiondef(p.oid);
  patched:=regexp_replace(d,'(\mBEGIN\M)',E'\\1\n perform lumin.group_legacy_guard(p_booking_id);','i');
  if patched=d then raise exception 'GROUP_LEGACY_PATCH_FAILED';end if;execute patched;
 end loop;
end $$;
create or replace function lumin.reserve_resource(p_tenant_id uuid,p_resource_id uuid,p_slot_start timestamptz,p_slot_end timestamptz,p_booking_id uuid,p_ttl interval)
returns table(result text,reservation_id uuid,reservation_status text,reservation_expires_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$begin
 perform lumin.group_legacy_guard(p_booking_id);
 return query select * from lumin.reserve_resource_quantity(p_tenant_id,p_resource_id,p_slot_start,p_slot_end,p_booking_id,p_ttl,1);
end $$;
create function public.release_planning_group(p_actor uuid,p_tenant uuid,p_group_id uuid,p_expected_generation bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.allocation_group_heads%rowtype;g public.allocation_groups%rowtype;k uuid;terminal text;
begin
 perform lumin.group_prefix(true);
 lock table public.capacity_holds,public.resource_reservations,public.worker_interval_holds in row exclusive mode;
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_group_id is null or p_expected_generation is null or p_expected_generation not between 1 and 9007199254740991 then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
 perform 1 from public.worker_roster_state where tenant_id=p_tenant for share;
 if not found then raise exception 'GROUP_NOT_FOUND' using errcode='P0002';end if;
 select * into h from public.allocation_group_heads where tenant_id=p_tenant and id=p_group_id for update;
 if not found then raise exception 'GROUP_NOT_FOUND' using errcode='P0002';end if;
 if h.current_generation<>p_expected_generation then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
 select * into g from public.allocation_groups where tenant_id=p_tenant and id=p_group_id and generation=p_expected_generation for update;
 if not found or not g.sealed then raise exception 'GROUP_UNSEALED' using errcode='55000';end if;
 perform 1 from public.bookings where tenant_id=p_tenant and id=h.booking_id and state='draft' for share;
 if not found then raise exception 'GROUP_GENERATION_CONFLICT' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||p_tenant::text||':'||g.service_id::text,0));
 for k in select resource_id from public.allocation_group_resources where tenant_id=p_tenant and group_id=p_group_id and generation=p_expected_generation order by resource_id loop perform pg_advisory_xact_lock(hashtextextended('lumin:resource-capacity:'||p_tenant::text||':'||k::text,0));end loop;
 for k in select worker_id from public.allocation_group_workers where tenant_id=p_tenant and group_id=p_group_id and generation=p_expected_generation order by worker_id loop perform pg_advisory_xact_lock(hashtextextended('lumin:worker-capacity:'||p_tenant::text||':'||k::text,0));end loop;
 perform 1 from public.capacity_holds where tenant_id=p_tenant and group_id=p_group_id and group_generation=p_expected_generation order by id for update;
 perform 1 from public.resource_reservations where tenant_id=p_tenant and group_id=p_group_id and group_generation=p_expected_generation order by resource_id for update;
 perform 1 from public.worker_interval_holds where tenant_id=p_tenant and group_id=p_group_id and generation=p_expected_generation order by worker_id for update;
 perform lumin.flow_actor(p_actor,p_tenant,true);
 perform lumin.group_validate(p_tenant,p_group_id,p_expected_generation);
 if g.status='held' then
  terminal:=case when clock_timestamp()>=g.expires_at then 'expired' else 'released' end;
  -- One statement keeps completeness true even if caller selected IMMEDIATE.
  with capacity as(update public.capacity_holds set status='released' where tenant_id=p_tenant and group_id=p_group_id and group_generation=p_expected_generation returning 1),
  resources as(update public.resource_reservations set status='released' where tenant_id=p_tenant and group_id=p_group_id and group_generation=p_expected_generation returning 1),
  workers as(update public.worker_interval_holds set status='released' where tenant_id=p_tenant and group_id=p_group_id and generation=p_expected_generation returning 1)
  update public.allocation_groups set status=terminal where tenant_id=p_tenant and id=p_group_id and generation=p_expected_generation;
 else terminal:=g.status;end if;
 perform lumin.group_validate(p_tenant,p_group_id,p_expected_generation);
 return jsonb_build_object('groupId',p_group_id,'generation',p_expected_generation,'status',terminal,'expiresAt',g.expires_at,'bookingState','draft','confirmed',false);
end $$;
-- Every new helper explicitly private; no application constructor/seal capability.
do $$declare p record;begin
 for p in select oid::regprocedure sig from pg_proc where pronamespace='lumin'::regnamespace and proname in('group_rc','group_prefix','group_require_fence','group_statement','group_digest','group_validate','group_identity','group_manifest_guard','group_carrier_guard','group_deferred','group_seal_check','group_legacy_guard','group_parent_guard','group_truncate_guard') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',p.sig);
 end loop;
end $$;
revoke all on function public.release_planning_group(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.release_planning_group(uuid,uuid,uuid,bigint) to service_role;
commit;
