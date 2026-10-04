-- Owner create/read only: configurable detailing catalog uses the shared pricing model.
begin;
create function lumin.detailing_text(p jsonb,n integer,empty boolean default false) returns boolean language sql immutable set search_path=pg_catalog as $$select coalesce(jsonb_typeof(p)='string' and lumin.utf16_length(p#>>'{}') between (case when empty then 0 else 1 end) and n and (p#>>'{}')=(btrim(p#>>'{}')) and (p#>>'{}') !~ U&'[\0001-\001f\007f-\009f]' and (p#>>'{}') !~ U&'^[\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]|[\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]$',false)$$;
create function lumin.detailing_body_valid(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare group_key text; v jsonb; amount numeric; subtotal numeric:=0; multiplier numeric:=0; maximum numeric; ids text[]; k text;
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>9 or not(p ?& array['name','description','currency','durationMinutes','packages','vehicles','addons','locations','idempotencyKey'])
 or not lumin.detailing_text(p->'name',200) or not lumin.detailing_text(p->'description',2000,true)
 or jsonb_typeof(p->'currency') is distinct from 'string' or p->>'currency' !~ '^[A-Z]{3}$'
 or jsonb_typeof(p->'durationMinutes') is distinct from 'number' or p->>'durationMinutes' !~ '^[0-9]+$' or (p->>'durationMinutes')::numeric not between 5 and 1440
 or jsonb_typeof(p->'idempotencyKey') is distinct from 'string' or length(p->>'idempotencyKey') not between 16 and 128 or p->>'idempotencyKey' !~ '^[A-Za-z0-9_-]+$' then return false;end if;
 foreach group_key in array array['packages','vehicles','addons','locations'] loop
  if jsonb_typeof(p->group_key) is distinct from 'array' or jsonb_array_length(p->group_key)>(case when group_key='locations' then 3 else 5 end) or (group_key in('packages','vehicles') and jsonb_array_length(p->group_key)=0) then return false;end if;
  ids:=array[]::text[];maximum:=0;
  for v in select value from jsonb_array_elements(p->group_key) loop
   k:=case when group_key='addons' then 'name' else 'label' end;
   if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>3 or not(v ?& array['id',k,case when group_key='vehicles' then 'multiplierBp' else 'amount' end])
   or jsonb_typeof(v->'id') is distinct from 'string' or v->>'id' !~ '^[a-z][a-z0-9_-]{0,39}$' or v->>'id' in('constructor','prototype','tenant','role','provider','total','price','amount') or v->>'id'=any(ids)
   or not lumin.detailing_text(v->k,100) then return false;end if;
   ids:=array_append(ids,v->>'id');k:=case when group_key='vehicles' then 'multiplierBp' else 'amount' end;
   if jsonb_typeof(v->k) is distinct from 'number' or v->>k !~ '^[0-9]+$' then return false;end if;
   amount:=(v->>k)::numeric;if amount>9007199254740991 then return false;end if;
   maximum:=greatest(maximum,amount);if group_key='addons' then subtotal:=subtotal+amount;end if;
  end loop;
  if group_key='vehicles' then multiplier:=maximum;elsif group_key<>'addons' then subtotal:=subtotal+maximum;end if;
 end loop;
 return subtotal<=9007199254740991 and subtotal*multiplier<=9007199254740991;
exception when others then return false;
end$$;
create function lumin.detailing_service(p_tenant uuid,p_service uuid,p jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare questions jsonb; addons jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'id','name',x->>'name','price',x->'amount') order by n),'[]') into addons from jsonb_array_elements(p->'addons') with ordinality a(x,n);
 select jsonb_build_array(jsonb_build_object('id','package','prompt','Detail package','kind','single_choice','required',true,'choices',(select jsonb_agg(jsonb_build_object('id',x->>'id','label',x->>'label','priceDelta',x->'amount','priceMultiplierBp',10000) order by n) from jsonb_array_elements(p->'packages') with ordinality a(x,n))),jsonb_build_object('id','vehicle','prompt','Vehicle type','kind','single_choice','required',true,'choices',(select jsonb_agg(jsonb_build_object('id',x->>'id','label',x->>'label','priceDelta',0,'priceMultiplierBp',x->'multiplierBp') order by n) from jsonb_array_elements(p->'vehicles') with ordinality a(x,n)))) into questions;
 if jsonb_array_length(p->'locations')>0 then questions:=questions||jsonb_build_array(jsonb_build_object('id','location','prompt','Service location','kind','single_choice','required',true,'choices',(select jsonb_agg(jsonb_build_object('id',x->>'id','label',x->>'label','priceDelta',x->'amount','priceMultiplierBp',10000) order by n) from jsonb_array_elements(p->'locations') with ordinality a(x,n))));end if;
 return jsonb_build_object('id',p_service,'tenantId',p_tenant,'archetype','configurable','name',p->>'name','description',p->>'description','currency',p->>'currency','basePrice',0,'durationMinutes',p->'durationMinutes','taxRateBp',0,'active',true,'items','[]'::jsonb,'addons',addons,'questions',questions);
end$$;
create function lumin.detailing_catalog_snapshot(p_tenant uuid,p_service uuid) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare s public.services; items jsonb; addons jsonb; questions jsonb;
begin
 -- Tuple UPDATE lock fences child FK inserts/reassignments; existing child SHARE locks fence updates/deletes.
 select * into s from public.services where tenant_id=p_tenant and id=p_service for update;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform 1 from public.service_items where tenant_id=p_tenant and service_id=p_service for share;
 perform 1 from public.service_addons where tenant_id=p_tenant and service_id=p_service for share;
 perform 1 from public.service_questions where tenant_id=p_tenant and service_id=p_service for share;
 select coalesce(jsonb_agg(jsonb_build_object('id',item_key,'name',name,'unitPrice',unit_price,'minQty',min_qty,'maxQty',max_qty)||case when description is null then '{}'::jsonb else jsonb_build_object('description',description) end order by sort_order,item_key),'[]') into items from public.service_items where tenant_id=p_tenant and service_id=p_service;
 select coalesce(jsonb_agg(jsonb_build_object('id',addon_key,'name',name,'price',price)||case when description is null then '{}'::jsonb else jsonb_build_object('description',description) end order by sort_order,addon_key),'[]') into addons from public.service_addons where tenant_id=p_tenant and service_id=p_service;
 select coalesce(jsonb_agg(jsonb_build_object('id',question_key,'prompt',prompt,'kind',kind,'required',required,'choices',choices)||case when unit_price is null then '{}'::jsonb else jsonb_build_object('unitPrice',unit_price) end||case when min_qty is null then '{}'::jsonb else jsonb_build_object('minQty',min_qty) end||case when max_qty is null then '{}'::jsonb else jsonb_build_object('maxQty',max_qty) end order by sort_order,question_key),'[]') into questions from public.service_questions where tenant_id=p_tenant and service_id=p_service;
 return jsonb_build_object('id',s.id,'tenantId',s.tenant_id,'archetype',s.archetype,'name',s.name,'description',s.description,'currency',s.currency,'basePrice',s.base_price,'durationMinutes',s.duration_minutes,'taxRateBp',s.tax_rate_bp,'active',s.active,'items',items,'addons',addons,'questions',questions)||case when s.rental is null then '{}'::jsonb else jsonb_build_object('rental',s.rental) end;
end$$;
create table public.owner_detailing_catalog_creations(tenant_id uuid not null,actor_id uuid not null references auth.users(id),idempotency_key text not null,service_id uuid not null unique,creation_body jsonb not null check(lumin.detailing_body_valid(creation_body)),service_snapshot jsonb not null,primary key(tenant_id,actor_id,idempotency_key),foreign key(tenant_id,service_id) references public.services(tenant_id,id),check(idempotency_key=creation_body->>'idempotencyKey'));
alter table public.owner_detailing_catalog_creations enable row level security;alter table public.owner_detailing_catalog_creations force row level security;
revoke all on public.owner_detailing_catalog_creations from public,anon,authenticated,service_role;
create trigger owner_detailing_catalog_creations_immutable before update or delete on public.owner_detailing_catalog_creations for each row execute function lumin.reject_owner_catalog_creation_mutation();
create function public.create_auto_detailing_offer(p_actor uuid,p_tenant uuid,p_service uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare profile jsonb; tenant_currency text; c public.owner_detailing_catalog_creations; snapshot jsonb; q jsonb; a jsonb; n integer;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 profile:=public.owner_business_profile(p_actor,p_tenant);if profile->>'businessType'<>'AUTO_DETAILING' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select currency into tenant_currency from public.tenants where id=p_tenant and status='active' for share;
 if p_service is null or not lumin.detailing_body_valid(p_body) or p_body->>'currency'<>tenant_currency then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('owner-detailing:'||p_actor::text||':'||p_tenant::text||':'||(p_body->>'idempotencyKey'),0));
 select * into c from public.owner_detailing_catalog_creations where tenant_id=p_tenant and actor_id=p_actor and idempotency_key=p_body->>'idempotencyKey';
 if found then
  if c.creation_body is distinct from p_body then raise exception 'CONFLICT' using errcode='40001';end if;
  snapshot:=lumin.detailing_catalog_snapshot(p_tenant,c.service_id);if snapshot is distinct from c.service_snapshot then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  snapshot:=lumin.detailing_service(p_tenant,p_service,p_body);
  insert into public.services(id,tenant_id,name,description,archetype,currency,base_price,duration_minutes,tax_rate_bp) values(p_service,p_tenant,p_body->>'name',p_body->>'description','configurable',tenant_currency,0,(p_body->>'durationMinutes')::integer,0);
  for a,n in select value,(ordinality-1)::integer from jsonb_array_elements(snapshot->'addons') with ordinality loop insert into public.service_addons(tenant_id,service_id,addon_key,name,price,sort_order) values(p_tenant,p_service,a->>'id',a->>'name',(a->>'price')::bigint,n);end loop;
  for q,n in select value,(ordinality-1)::integer from jsonb_array_elements(snapshot->'questions') with ordinality loop insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,choices,sort_order) values(p_tenant,p_service,q->>'id',q->>'prompt','single_choice',true,q->'choices',n);end loop;
  insert into public.owner_detailing_catalog_creations values(p_tenant,p_actor,p_body->>'idempotencyKey',p_service,p_body,snapshot);
 end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'businessType','AUTO_DETAILING','pricingModel','package_subtotal_vehicle_multiplier','service',snapshot);
end$$;
create function public.owner_detailing_offer(p_actor uuid,p_tenant uuid,p_service uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare profile jsonb;c public.owner_detailing_catalog_creations;snapshot jsonb;tenant_currency text;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 profile:=public.owner_business_profile(p_actor,p_tenant);if profile->>'businessType'<>'AUTO_DETAILING' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select currency into tenant_currency from public.tenants where id=p_tenant and status='active' for share;
 select * into c from public.owner_detailing_catalog_creations where tenant_id=p_tenant and service_id=p_service;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 snapshot:=lumin.detailing_catalog_snapshot(p_tenant,p_service);if snapshot is distinct from c.service_snapshot or snapshot->>'currency'<>tenant_currency then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'businessType','AUTO_DETAILING','pricingModel','package_subtotal_vehicle_multiplier','service',snapshot);
end$$;
revoke all on function lumin.detailing_text(jsonb,integer,boolean),lumin.detailing_body_valid(jsonb),lumin.detailing_service(uuid,uuid,jsonb),lumin.detailing_catalog_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_auto_detailing_offer(uuid,uuid,uuid,jsonb),public.owner_detailing_offer(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_auto_detailing_offer(uuid,uuid,uuid,jsonb),public.owner_detailing_offer(uuid,uuid,uuid) to service_role;
commit;
