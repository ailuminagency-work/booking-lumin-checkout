-- Explicit first-type initialization for existing active tenants. No inferred type.
begin;
create table public.business_profile_initializations(
 tenant_id uuid primary key references public.business_profiles(tenant_id),
 actor_id uuid not null references auth.users(id),
 idempotency_key text not null check(length(idempotency_key) between 16 and 128 and idempotency_key ~ '^[A-Za-z0-9_-]+$'),
 business_type text not null check(business_type in('HOUSEKEEPING','AUTO_DETAILING','VEHICLE_RENTAL','EQUIPMENT_RENTAL','EVENT_RENTAL','JUNK_REMOVAL')),
 unique(actor_id,idempotency_key)
);
alter table public.business_profile_initializations enable row level security;
alter table public.business_profile_initializations force row level security;
revoke all on public.business_profile_initializations from public,anon,authenticated,service_role;
create trigger business_profile_initializations_immutable before update or delete on public.business_profile_initializations for each row execute function lumin.reject_business_profile_mutation();
create function public.initialize_staging_business_profile(p_actor uuid,p_tenant uuid,p_type text,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.tenants;b public.business_profiles;r public.business_profile_initializations;
begin
 if p_actor is null or p_tenant is null or p_type is null or p_type not in('HOUSEKEEPING','AUTO_DETAILING','VEHICLE_RENTAL','EQUIPMENT_RENTAL','EVENT_RENTAL','JUNK_REMOVAL')
 or p_key is null or length(p_key) not between 16 and 128 or p_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Same prefix as new-business creation prevents cross-operation key races.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text||':'||p_key,0));
 select * into t from public.tenants where id=p_tenant for update;
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into r from public.business_profile_initializations where actor_id=p_actor and idempotency_key=p_key;
 select * into b from public.business_profiles where tenant_id=p_tenant;
 if r.tenant_id is not null then
  if r.tenant_id<>p_tenant or r.business_type<>p_type or b.tenant_id is null or b.creator_id<>p_actor or b.idempotency_key<>p_key or b.business_type<>p_type then raise exception 'CONFLICT' using errcode='40001';end if;
  return public.owner_business_profile(p_actor,p_tenant);
 end if;
 if b.tenant_id is not null or exists(select 1 from public.business_profiles where creator_id=p_actor and idempotency_key=p_key) then raise exception 'CONFLICT' using errcode='40001';end if;
 if t.timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$' or not exists(select 1 from pg_catalog.pg_timezone_names where name=t.timezone) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 insert into public.business_profiles(tenant_id,business_type,creator_id,idempotency_key,creation_name,creation_slug,creation_timezone,creation_currency) values(p_tenant,p_type,p_actor,p_key,t.name,t.slug,t.timezone,t.currency);
 insert into public.business_profile_initializations(tenant_id,actor_id,idempotency_key,business_type) values(p_tenant,p_actor,p_key,p_type);
 return public.owner_business_profile(p_actor,p_tenant);
end$$;
revoke all on function public.initialize_staging_business_profile(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.initialize_staging_business_profile(uuid,uuid,text,text) to service_role;
create or replace function public.create_staging_business(p_actor uuid,p_tenant uuid,p_name text,p_slug text,p_timezone text,p_currency text,p_type text,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.business_profiles;
begin
 -- Identity comes exclusively from the verified server caller, never authoring JSON.
 perform 1 from auth.users where id=p_actor for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_tenant is null or p_name is null or length(p_name) not between 1 and 200 or p_name<>btrim(p_name)
 or p_slug is null or length(p_slug) not between 2 and 100 or p_slug !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'
 or p_currency is null or p_currency !~ '^[A-Z]{3}$'
 or p_type is null or p_type not in('HOUSEKEEPING','AUTO_DETAILING','VEHICLE_RENTAL','EQUIPMENT_RENTAL','EVENT_RENTAL','JUNK_REMOVAL')
 or p_key is null or length(p_key) not between 16 and 128 or p_key !~ '^[A-Za-z0-9_-]+$'
 or p_timezone is null or length(p_timezone)>100 or p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Hash collisions only serialize unrelated attempts; exact columns remain authority.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text||':'||p_key,0));
 select * into b from public.business_profiles where creator_id=p_actor and idempotency_key=p_key;
 if found then
  if exists(select 1 from public.business_profile_initializations where tenant_id=b.tenant_id) then raise exception 'CONFLICT' using errcode='40001';end if;
  if b.creation_name<>p_name or b.creation_slug<>p_slug or b.creation_timezone<>p_timezone or b.creation_currency<>p_currency or b.business_type<>p_type then raise exception 'CONFLICT' using errcode='40001';end if;
  return public.owner_business_profile(p_actor,b.tenant_id);
 end if;
 insert into public.tenants(id,name,slug,timezone,currency) values(p_tenant,p_name,p_slug,p_timezone,p_currency);
 insert into public.tenant_members(tenant_id,user_id,role) values(p_tenant,p_actor,'BUSINESS_OWNER');
 insert into public.business_profiles(tenant_id,business_type,creator_id,idempotency_key,creation_name,creation_slug,creation_timezone,creation_currency) values(p_tenant,p_type,p_actor,p_key,p_name,p_slug,p_timezone,p_currency);
 return public.owner_business_profile(p_actor,p_tenant);
end$$;
commit;
