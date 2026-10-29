-- Create-only profile-bound owner offer authoring. No existing price update.
begin;
create table public.owner_catalog_creations(
 tenant_id uuid not null,
 actor_id uuid not null references auth.users(id),
 idempotency_key text not null check(length(idempotency_key) between 16 and 128 and idempotency_key ~ '^[A-Za-z0-9_-]+$'),
 service_id uuid not null unique,
 creation_name text not null check(length(creation_name) between 1 and 200 and creation_name=btrim(creation_name)),
 creation_description text not null check(length(creation_description)<=2000),
 creation_amount bigint not null check(creation_amount between 1 and 9007199254740991),
 creation_currency text not null check(creation_currency ~ '^[A-Z]{3}$'),
 creation_duration integer not null check(creation_duration between 5 and 1440),
 primary key(tenant_id,actor_id,idempotency_key),
 foreign key(tenant_id,service_id) references public.services(tenant_id,id)
);
alter table public.owner_catalog_creations enable row level security;
alter table public.owner_catalog_creations force row level security;
revoke all on public.owner_catalog_creations from public,anon,authenticated,service_role;
create function lumin.reject_owner_catalog_creation_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$begin raise exception 'OFFER_CREATE_IMMUTABLE' using errcode='55000';end$$;
revoke all on function lumin.reject_owner_catalog_creation_mutation() from public,anon,authenticated,service_role;
create trigger owner_catalog_creations_immutable before update or delete on public.owner_catalog_creations for each row execute function lumin.reject_owner_catalog_creation_mutation();
create function public.create_housekeeping_simple_offer(p_actor uuid,p_tenant uuid,p_service uuid,p_name text,p_description text,p_amount bigint,p_currency text,p_duration integer,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare profile jsonb; c public.owner_catalog_creations; s public.services; snapshot jsonb; tenant_currency text;
begin
 profile:=public.owner_business_profile(p_actor,p_tenant);
 if profile->>'businessType'<>'HOUSEKEEPING' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select currency into tenant_currency from public.tenants where id=p_tenant and status='active' for share;
 if p_service is null or p_name is null or length(p_name) not between 1 and 200 or p_name<>btrim(p_name)
 or p_description is null or length(p_description)>2000 or p_amount is null or p_amount not between 1 and 9007199254740991
 or p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_currency<>tenant_currency
 or p_duration is null or p_duration not between 5 and 1440
 or p_key is null or length(p_key) not between 16 and 128 or p_key !~ '^[A-Za-z0-9_-]+$'
 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owner-catalog:'||p_actor::text||':'||p_tenant::text||':'||p_key,0));
 select * into c from public.owner_catalog_creations where actor_id=p_actor and tenant_id=p_tenant and idempotency_key=p_key;
 if found then
  if c.creation_name<>p_name or c.creation_description<>p_description or c.creation_amount<>p_amount or c.creation_currency<>p_currency or c.creation_duration<>p_duration then raise exception 'CONFLICT' using errcode='40001';end if;
  snapshot:=lumin.paid_simple_service(p_tenant,c.service_id);
  if snapshot is distinct from jsonb_build_object('id',c.service_id,'name',p_name,'durationMinutes',p_duration,'price',jsonb_build_object('amount',p_amount,'currency',p_currency)) then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into s from public.services where tenant_id=p_tenant and id=c.service_id for share;
  if s.description<>p_description then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  -- Eligible by construction: a new UUID cannot yet have committed child rows.
  -- Avoid INSERT-then-SHARE table lock upgrades from paid_simple_service here.
  insert into public.services(id,tenant_id,archetype,name,description,currency,base_price,duration_minutes,tax_rate_bp,rental,active) values(p_service,p_tenant,'simple',p_name,p_description,p_currency,p_amount,p_duration,0,null,true) returning * into s;
  insert into public.owner_catalog_creations values(p_tenant,p_actor,p_key,p_service,p_name,p_description,p_amount,p_currency,p_duration);
 end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'service',jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'archetype',s.archetype,'price',jsonb_build_object('amount',s.base_price,'currency',s.currency),'durationMinutes',s.duration_minutes));
end$$;
revoke all on function public.create_housekeeping_simple_offer(uuid,uuid,uuid,text,text,bigint,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.create_housekeeping_simple_offer(uuid,uuid,uuid,text,text,bigint,text,integer,text) to service_role;
commit;
