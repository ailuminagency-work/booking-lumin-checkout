-- Explicit staging onboarding capability. Existing tenants stay uninitialized.
begin;
create table public.business_profiles(
 tenant_id uuid primary key references public.tenants(id),
 business_type text not null check(business_type in('HOUSEKEEPING','AUTO_DETAILING','VEHICLE_RENTAL','EQUIPMENT_RENTAL','EVENT_RENTAL','JUNK_REMOVAL')),
 template_version integer not null default 1 check(template_version=1),
 creator_id uuid not null references auth.users(id),
 idempotency_key text not null check(length(idempotency_key) between 16 and 128 and idempotency_key ~ '^[A-Za-z0-9_-]+$'),
 creation_name text not null check(length(creation_name) between 1 and 200 and creation_name=btrim(creation_name)),
 creation_slug text not null check(length(creation_slug) between 2 and 100 and creation_slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
 creation_timezone text not null,
 creation_currency text not null check(creation_currency ~ '^[A-Z]{3}$'),
 unique(creator_id,idempotency_key)
);
alter table public.business_profiles enable row level security;
alter table public.business_profiles force row level security;
revoke all on public.business_profiles from public,anon,authenticated,service_role;
create function lumin.reject_business_profile_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'BUSINESS_TYPE_IMMUTABLE' using errcode='55000';end$$;
revoke all on function lumin.reject_business_profile_mutation() from public,anon,authenticated,service_role;
create trigger business_profiles_immutable before update or delete on public.business_profiles for each row execute function lumin.reject_business_profile_mutation();
create function public.owner_business_profile(p_actor uuid,p_tenant uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.business_profiles;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into b from public.business_profiles where tenant_id=p_tenant;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',b.tenant_id,'businessType',b.business_type,'templateVersion',b.template_version);
end$$;
create function public.create_staging_business(p_actor uuid,p_tenant uuid,p_name text,p_slug text,p_timezone text,p_currency text,p_type text,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  if b.creation_name<>p_name or b.creation_slug<>p_slug or b.creation_timezone<>p_timezone or b.creation_currency<>p_currency or b.business_type<>p_type then raise exception 'CONFLICT' using errcode='40001';end if;
  return public.owner_business_profile(p_actor,b.tenant_id);
 end if;
 insert into public.tenants(id,name,slug,timezone,currency) values(p_tenant,p_name,p_slug,p_timezone,p_currency);
 insert into public.tenant_members(tenant_id,user_id,role) values(p_tenant,p_actor,'BUSINESS_OWNER');
 insert into public.business_profiles(tenant_id,business_type,creator_id,idempotency_key,creation_name,creation_slug,creation_timezone,creation_currency) values(p_tenant,p_type,p_actor,p_key,p_name,p_slug,p_timezone,p_currency);
 return public.owner_business_profile(p_actor,p_tenant);
end$$;
revoke all on function public.owner_business_profile(uuid,uuid),public.create_staging_business(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.owner_business_profile(uuid,uuid),public.create_staging_business(uuid,uuid,text,text,text,text,text,text) to service_role;
commit;
