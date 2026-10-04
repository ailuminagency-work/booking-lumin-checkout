-- Explicit create-only availability setup over existing authoritative tables.
begin;
create table public.owner_offer_scheduling(
 tenant_id uuid not null,service_id uuid not null,actor_id uuid not null references auth.users(id),idempotency_key text not null check(length(idempotency_key) between 16 and 128 and idempotency_key ~ '^[A-Za-z0-9_-]+$'),
 timezone text not null,windows jsonb not null,lead_time_minutes integer not null,horizon_days integer not null,slot_interval_minutes integer not null,receipt jsonb not null,
 primary key(tenant_id,service_id),unique(tenant_id,actor_id,idempotency_key),foreign key(tenant_id,service_id) references public.services(tenant_id,id)
);
alter table public.owner_offer_scheduling enable row level security;
alter table public.owner_offer_scheduling force row level security;
revoke all on public.owner_offer_scheduling from public,anon,authenticated,service_role;
create trigger owner_offer_scheduling_immutable before update or delete on public.owner_offer_scheduling for each row execute function lumin.reject_owner_catalog_creation_mutation();
create function public.create_housekeeping_offer_scheduling(p_actor uuid,p_tenant uuid,p_service uuid,p_timezone text,p_windows jsonb,p_lead integer,p_horizon integer,p_interval integer,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.tenants;c public.owner_catalog_creations;s public.owner_offer_scheduling;w jsonb;last_day integer:=-1;day integer;start_at integer;end_at integer;snapshot jsonb;current_windows jsonb;current_policy jsonb;rule_id uuid;policy_id uuid;receipt_windows jsonb:='[]';receipt jsonb;
begin
 -- Fast role check, then tenant-first serialization; no SHARE-to-UPDATE upgrade.
 if not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and role='BUSINESS_OWNER') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into t from public.tenants where id=p_tenant and status='active' for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if public.owner_business_profile(p_actor,p_tenant)->>'businessType'<>'HOUSEKEEPING' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into c from public.owner_catalog_creations where tenant_id=p_tenant and service_id=p_service and actor_id=p_actor;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 snapshot:=lumin.paid_simple_service(p_tenant,p_service);
 if snapshot is distinct from jsonb_build_object('id',c.service_id,'name',c.creation_name,'durationMinutes',c.creation_duration,'price',jsonb_build_object('amount',c.creation_amount,'currency',c.creation_currency)) or exists(select 1 from public.services where id=p_service and description<>c.creation_description) then raise exception 'CONFLICT' using errcode='40001';end if;
 if p_timezone is null or p_timezone<>t.timezone or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
 or p_lead is null or p_lead not between 0 and 10080 or p_horizon is null or p_horizon not between 1 and 30 or p_interval is null or p_interval not in(15,30,60)
 or p_key is null or length(p_key) not between 16 and 128 or p_key !~ '^[A-Za-z0-9_-]+$'
 or p_windows is null or jsonb_typeof(p_windows)<>'array' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if jsonb_array_length(p_windows) not between 1 and 7 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 for w in select value from jsonb_array_elements(p_windows) loop
  if jsonb_typeof(w)<>'object' or w-array['weekday','startMinute','endMinute','capacity']<>'{}' or jsonb_typeof(w->'weekday') is distinct from 'number' or (w->>'weekday') !~ '^[0-6]$'
  or jsonb_typeof(w->'startMinute') is distinct from 'number' or length(w->>'startMinute')>4 or (w->>'startMinute') !~ '^[0-9]+$'
  or jsonb_typeof(w->'endMinute') is distinct from 'number' or length(w->>'endMinute')>4 or (w->>'endMinute') !~ '^[0-9]+$' or w->'capacity' is distinct from '1'::jsonb then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  day:=(w->>'weekday')::integer;start_at:=(w->>'startMinute')::integer;end_at:=(w->>'endMinute')::integer;
  if day<=last_day or start_at not between 0 and 1439 or end_at not between 1 and 1440 or end_at-start_at<c.creation_duration then raise exception 'INVALID_REQUEST' using errcode='22023';end if;last_day:=day;
 end loop;
 select * into s from public.owner_offer_scheduling where tenant_id=p_tenant and (service_id=p_service or (actor_id=p_actor and idempotency_key=p_key));
 if found then
  if s.service_id<>p_service or s.actor_id<>p_actor or s.idempotency_key<>p_key or s.timezone<>p_timezone or s.windows<>p_windows or s.lead_time_minutes<>p_lead or s.horizon_days<>p_horizon or s.slot_interval_minutes<>p_interval then raise exception 'CONFLICT' using errcode='40001';end if;
  -- Tenant lock fences all new FK-bound rows; row locks fence existing updates.
  perform 1 from public.availability_rules where tenant_id=p_tenant and (service_id=p_service or service_id is null) for share;
  perform 1 from public.availability_overrides where tenant_id=p_tenant and (service_id=p_service or service_id is null) for share;
  perform 1 from public.scheduling_policies where tenant_id=p_tenant and (service_id=p_service or service_id is null) for share;
  if exists(select 1 from public.availability_rules where tenant_id=p_tenant and service_id is null) or exists(select 1 from public.availability_overrides where tenant_id=p_tenant and (service_id=p_service or service_id is null)) or exists(select 1 from public.scheduling_policies where tenant_id=p_tenant and service_id is null) then raise exception 'CONFLICT' using errcode='40001';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'weekday',weekday,'startMinute',start_minute,'endMinute',end_minute,'capacity',capacity) order by weekday,id),'[]') into current_windows from public.availability_rules where tenant_id=p_tenant and service_id=p_service;
  select jsonb_build_object('id',id,'leadTimeMinutes',lead_time_minutes,'horizonDays',horizon_days,'slotIntervalMinutes',slot_interval_minutes) into current_policy from public.scheduling_policies where tenant_id=p_tenant and service_id=p_service;
  if current_windows is distinct from s.receipt->'windows' or current_policy is distinct from s.receipt->'policy' then raise exception 'CONFLICT' using errcode='40001';end if;
  return s.receipt;
 end if;
 if exists(select 1 from public.availability_rules where tenant_id=p_tenant and (service_id=p_service or service_id is null)) or exists(select 1 from public.availability_overrides where tenant_id=p_tenant and (service_id=p_service or service_id is null)) or exists(select 1 from public.scheduling_policies where tenant_id=p_tenant and (service_id=p_service or service_id is null))
 or exists(select 1 from public.bookings where tenant_id=p_tenant and selection->>'serviceId'=p_service::text) or exists(select 1 from public.capacity_holds where tenant_id=p_tenant and service_id=p_service) then raise exception 'CONFLICT' using errcode='40001';end if;
 for w in select value from jsonb_array_elements(p_windows) loop
  insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) values(p_tenant,p_service,(w->>'weekday')::integer,(w->>'startMinute')::integer,(w->>'endMinute')::integer,1) returning id into rule_id;
  receipt_windows:=receipt_windows||jsonb_build_array(w||jsonb_build_object('id',rule_id));
 end loop;
 insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values(p_tenant,p_service,p_lead,p_horizon,p_interval) returning id into policy_id;
 receipt:=jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'serviceId',p_service,'timezone',t.timezone,'windows',receipt_windows,'policy',jsonb_build_object('id',policy_id,'leadTimeMinutes',p_lead,'horizonDays',p_horizon,'slotIntervalMinutes',p_interval));
 insert into public.owner_offer_scheduling values(p_tenant,p_service,p_actor,p_key,p_timezone,p_windows,p_lead,p_horizon,p_interval,receipt);
 return receipt;
end$$;
revoke all on function public.create_housekeeping_offer_scheduling(uuid,uuid,uuid,text,jsonb,integer,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.create_housekeeping_offer_scheduling(uuid,uuid,uuid,text,jsonb,integer,integer,integer,text) to service_role;
commit;
