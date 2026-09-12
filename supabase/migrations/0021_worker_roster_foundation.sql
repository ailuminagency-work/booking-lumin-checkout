-- Worker roster only: no tenant role, jobs, assignment access or allocation authority.
begin;
create table public.worker_roster_state(tenant_id uuid primary key references public.tenants(id) on delete cascade,version bigint not null default 1 check(version between 1 and 9007199254740991));
create table public.workers(id uuid primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,display_name text not null check(length(display_name) between 1 and 160 and length(btrim(display_name))>0),active boolean not null default true,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id));
create table public.worker_access(tenant_id uuid not null,user_id uuid not null references auth.users(id),worker_id uuid not null,active boolean not null,revoked_at timestamptz,permission_version bigint not null default 1 check(permission_version between 1 and 9007199254740991),primary key(tenant_id,user_id),unique(tenant_id,user_id,worker_id),foreign key(tenant_id,worker_id) references public.workers(tenant_id,id) on delete cascade,check(not active or revoked_at is null));
create unique index worker_access_one_active_login on public.worker_access(tenant_id,worker_id) where active and revoked_at is null;
create table public.crews(id uuid primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,name text not null check(length(name) between 1 and 160 and length(btrim(name))>0),active boolean not null default true,unique(tenant_id,id));
create table public.crew_members(tenant_id uuid not null,crew_id uuid not null,worker_id uuid not null,primary key(tenant_id,crew_id,worker_id),foreign key(tenant_id,crew_id) references public.crews(tenant_id,id) on delete cascade,foreign key(tenant_id,worker_id) references public.workers(tenant_id,id) on delete cascade);
create table public.service_worker_eligibility(tenant_id uuid not null,service_id uuid not null,worker_id uuid not null,active boolean not null,primary key(tenant_id,service_id,worker_id),foreign key(tenant_id,service_id) references public.services(tenant_id,id),foreign key(tenant_id,worker_id) references public.workers(tenant_id,id) on delete cascade);
create table public.worker_shifts(id uuid primary key,tenant_id uuid not null,worker_id uuid not null,kind text not null check(kind in('available','blocked')),starts_at timestamptz not null,ends_at timestamptz not null,source_time_zone text not null check(length(source_time_zone) between 1 and 100),active boolean not null default true,unique(tenant_id,id),foreign key(tenant_id,worker_id) references public.workers(tenant_id,id) on delete cascade,check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at));
-- Identity rows cannot be rebound even by accidental future privileged updates.
create function lumin.roster_identity_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if new.tenant_id is distinct from old.tenant_id then raise exception 'ROSTER_IDENTITY_IMMUTABLE' using errcode='55000';end if;
 if tg_table_name='worker_access' then
  if new.user_id is distinct from old.user_id or new.worker_id is distinct from old.worker_id then raise exception 'ROSTER_IDENTITY_IMMUTABLE' using errcode='55000';end if;
 elsif new.id is distinct from old.id then raise exception 'ROSTER_IDENTITY_IMMUTABLE' using errcode='55000';
 end if;
 if tg_table_name='worker_shifts' and (to_jsonb(new)->'worker_id') is distinct from (to_jsonb(old)->'worker_id') then raise exception 'ROSTER_IDENTITY_IMMUTABLE' using errcode='55000';end if;
 return new;
end $$;
create trigger workers_identity before update on public.workers for each row execute function lumin.roster_identity_immutable('active');
create trigger crews_identity before update on public.crews for each row execute function lumin.roster_identity_immutable('active');
create trigger worker_access_identity before update on public.worker_access for each row execute function lumin.roster_identity_immutable('active');
create trigger worker_shifts_identity before update on public.worker_shifts for each row execute function lumin.roster_identity_immutable('active');
create function lumin.roster_shift_zone() returns trigger language plpgsql set search_path=pg_catalog as $$
begin if not exists(select 1 from pg_timezone_names where name=new.source_time_zone) then raise exception 'ROSTER_INVALID_ZONE' using errcode='22023';end if;return new;end $$;
create trigger worker_shift_zone before insert or update on public.worker_shifts for each row execute function lumin.roster_shift_zone();
-- Only narrow definer entry points below have write authority. Arbitrary superuser
-- DML is NOT serialized by this protocol; fixtures must use these entry points.
create function lumin.roster_begin(p_actor uuid,p_tenant uuid,p_expected bigint) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare next_version bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_expected is null or p_expected not between 1 and 9007199254740990 then raise exception 'ROSTER_VERSION_INVALID' using errcode='22023';end if;
 update public.worker_roster_state set version=version+1 where tenant_id=p_tenant and version=p_expected returning version into next_version;
 if not found then raise exception 'ROSTER_CONFLICT' using errcode='40001';end if;
 return next_version;
end $$;
create function public.roster_provision(p_actor uuid,p_tenant uuid) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;begin perform lumin.flow_actor(p_actor,p_tenant,true);insert into public.worker_roster_state(tenant_id) values(p_tenant) on conflict do nothing;select version into v from public.worker_roster_state where tenant_id=p_tenant for share;return v;end $$;
create function public.roster_worker_put(p_actor uuid,p_tenant uuid,p_expected bigint,p_id uuid,p_name text,p_active boolean,p_create boolean) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;
begin
 v:=lumin.roster_begin(p_actor,p_tenant,p_expected);
 if p_create is null then raise exception 'ROSTER_INVALID' using errcode='22023';end if;
 if p_create=exists(select 1 from public.workers where tenant_id=p_tenant and id=p_id) then raise exception 'ROSTER_ENTITY_CONFLICT' using errcode='40001';end if;
 if p_create then insert into public.workers(id,tenant_id,display_name,active) values(p_id,p_tenant,p_name,p_active);
 else update public.workers set display_name=p_name,active=p_active where tenant_id=p_tenant and id=p_id;end if;
 return v;
end $$;
create function public.roster_crew_put(p_actor uuid,p_tenant uuid,p_expected bigint,p_id uuid,p_name text,p_active boolean,p_create boolean) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;
begin
 v:=lumin.roster_begin(p_actor,p_tenant,p_expected);
 if p_create is null then raise exception 'ROSTER_INVALID' using errcode='22023';end if;
 if p_create=exists(select 1 from public.crews where tenant_id=p_tenant and id=p_id) then raise exception 'ROSTER_ENTITY_CONFLICT' using errcode='40001';end if;
 if p_create then insert into public.crews(id,tenant_id,name,active) values(p_id,p_tenant,p_name,p_active);
 else update public.crews set name=p_name,active=p_active where tenant_id=p_tenant and id=p_id;end if;
 return v;
end $$;
create function public.roster_access_put(p_actor uuid,p_tenant uuid,p_expected bigint,p_user uuid,p_worker uuid,p_active boolean,p_create boolean) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;
begin
 v:=lumin.roster_begin(p_actor,p_tenant,p_expected);
 if p_create is null then raise exception 'ROSTER_INVALID' using errcode='22023';end if;
 if p_create=exists(select 1 from public.worker_access where tenant_id=p_tenant and user_id=p_user) then raise exception 'ROSTER_ENTITY_CONFLICT' using errcode='40001';end if;
 if p_create then insert into public.worker_access(tenant_id,user_id,worker_id,active,revoked_at) values(p_tenant,p_user,p_worker,p_active,case when p_active then null else clock_timestamp() end);
 else
  if not exists(select 1 from public.worker_access where tenant_id=p_tenant and user_id=p_user and worker_id=p_worker) then raise exception 'ROSTER_IDENTITY_IMMUTABLE' using errcode='55000';end if;
  update public.worker_access set active=p_active,revoked_at=case when p_active then null else clock_timestamp() end,permission_version=permission_version+1 where tenant_id=p_tenant and user_id=p_user and permission_version<9007199254740991;
  if not found then raise exception 'ROSTER_VERSION_INVALID' using errcode='22023';end if;
 end if;
 -- FUTURE JOB MIGRATION MUST atomically revoke affected assignments here AND
 -- on worker deactivation before
 -- exposing any jobs. This foundation has no worker job read/execution surface.
 return v;
end $$;
create function public.roster_crew_member_set(p_actor uuid,p_tenant uuid,p_expected bigint,p_crew uuid,p_worker uuid,p_present boolean) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;
begin
 v:=lumin.roster_begin(p_actor,p_tenant,p_expected);
 if p_present is null then raise exception 'ROSTER_INVALID' using errcode='22023';end if;
 if p_present then insert into public.crew_members values(p_tenant,p_crew,p_worker);
 else delete from public.crew_members where tenant_id=p_tenant and crew_id=p_crew and worker_id=p_worker;if not found then raise exception 'ROSTER_ENTITY_CONFLICT' using errcode='40001';end if;end if;
 return v;
end $$;
create function public.roster_eligibility_put(p_actor uuid,p_tenant uuid,p_expected bigint,p_service uuid,p_worker uuid,p_active boolean,p_create boolean) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;
begin
 v:=lumin.roster_begin(p_actor,p_tenant,p_expected);
 if p_create is null then raise exception 'ROSTER_INVALID' using errcode='22023';end if;
 if p_create=exists(select 1 from public.service_worker_eligibility where tenant_id=p_tenant and service_id=p_service and worker_id=p_worker) then raise exception 'ROSTER_ENTITY_CONFLICT' using errcode='40001';end if;
 if p_create then insert into public.service_worker_eligibility values(p_tenant,p_service,p_worker,p_active);
 else update public.service_worker_eligibility set active=p_active where tenant_id=p_tenant and service_id=p_service and worker_id=p_worker;end if;
 return v;
end $$;
create function public.roster_shift_put(p_actor uuid,p_tenant uuid,p_expected bigint,p_id uuid,p_worker uuid,p_kind text,p_start timestamptz,p_end timestamptz,p_zone text,p_active boolean,p_create boolean) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v bigint;
begin
 v:=lumin.roster_begin(p_actor,p_tenant,p_expected);
 if p_create is null then raise exception 'ROSTER_INVALID' using errcode='22023';end if;
 if p_create=exists(select 1 from public.worker_shifts where tenant_id=p_tenant and id=p_id) then raise exception 'ROSTER_ENTITY_CONFLICT' using errcode='40001';end if;
 if p_create then insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active) values(p_id,p_tenant,p_worker,p_kind,p_start,p_end,p_zone,p_active);
 else
  if not exists(select 1 from public.worker_shifts where tenant_id=p_tenant and id=p_id and worker_id=p_worker) then raise exception 'ROSTER_IDENTITY_IMMUTABLE' using errcode='55000';end if;
  update public.worker_shifts set kind=p_kind,starts_at=p_start,ends_at=p_end,source_time_zone=p_zone,active=p_active where tenant_id=p_tenant and id=p_id;
 end if;
 return v;
end $$;
alter table public.worker_roster_state enable row level security;
alter table public.worker_roster_state force row level security;
revoke all on public.worker_roster_state from public,anon,authenticated,service_role;
alter table public.workers enable row level security;
alter table public.workers force row level security;
revoke all on public.workers from public,anon,authenticated,service_role;
alter table public.worker_access enable row level security;
alter table public.worker_access force row level security;
revoke all on public.worker_access from public,anon,authenticated,service_role;
alter table public.crews enable row level security;
alter table public.crews force row level security;
revoke all on public.crews from public,anon,authenticated,service_role;
alter table public.crew_members enable row level security;
alter table public.crew_members force row level security;
revoke all on public.crew_members from public,anon,authenticated,service_role;
alter table public.service_worker_eligibility enable row level security;
alter table public.service_worker_eligibility force row level security;
revoke all on public.service_worker_eligibility from public,anon,authenticated,service_role;
alter table public.worker_shifts enable row level security;
alter table public.worker_shifts force row level security;
revoke all on public.worker_shifts from public,anon,authenticated,service_role;
revoke all on function public.roster_provision(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.roster_provision(uuid,uuid) to service_role;
revoke all on function public.roster_worker_put(uuid,uuid,bigint,uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.roster_worker_put(uuid,uuid,bigint,uuid,text,boolean,boolean) to service_role;
revoke all on function public.roster_crew_put(uuid,uuid,bigint,uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.roster_crew_put(uuid,uuid,bigint,uuid,text,boolean,boolean) to service_role;
revoke all on function public.roster_access_put(uuid,uuid,bigint,uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.roster_access_put(uuid,uuid,bigint,uuid,uuid,boolean,boolean) to service_role;
revoke all on function public.roster_crew_member_set(uuid,uuid,bigint,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.roster_crew_member_set(uuid,uuid,bigint,uuid,uuid,boolean) to service_role;
revoke all on function public.roster_eligibility_put(uuid,uuid,bigint,uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.roster_eligibility_put(uuid,uuid,bigint,uuid,uuid,boolean,boolean) to service_role;
revoke all on function public.roster_shift_put(uuid,uuid,bigint,uuid,uuid,text,timestamptz,timestamptz,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.roster_shift_put(uuid,uuid,bigint,uuid,uuid,text,timestamptz,timestamptz,text,boolean,boolean) to service_role;
revoke all on function lumin.roster_begin(uuid,uuid,bigint),lumin.roster_identity_immutable(),lumin.roster_shift_zone() from public,anon,authenticated,service_role;
commit;
