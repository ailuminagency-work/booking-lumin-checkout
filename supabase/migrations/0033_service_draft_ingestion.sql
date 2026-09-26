-- Server-controlled template materialization. This SQL does not identify or
-- certify a template: the API must select the canonical payload from its
-- registry and must never forward a browser-supplied service body here.
create table public.service_draft_ingestions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  template_key text not null check (template_key ~ '^[a-z][a-z0-9-]{0,99}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id,actor_id,idempotency_key),
  unique (tenant_id,service_id)
);
alter table public.service_draft_ingestions enable row level security;
alter table public.service_draft_ingestions force row level security;
revoke all on public.service_draft_ingestions from public,anon,authenticated,service_role;

-- Bound integer JSON before casts or persistence. All money remains nonnegative
-- integer minor units inside JavaScript's exact integer range.
create function lumin.service_draft_uint(v jsonb, ceiling bigint) returns boolean
language plpgsql immutable set search_path=pg_catalog as $fn$
begin
  if v is null or jsonb_typeof(v)<>'number' or v::text !~ '^(0|[1-9][0-9]{0,15})$' then return false; end if;
  return (v::text)::bigint<=ceiling;
end $fn$;
create function lumin.service_draft_label(v jsonb, max_chars integer) returns boolean
language sql immutable set search_path=pg_catalog as $fn$
  select case when v is null or jsonb_typeof(v)<>'string' then false
    else length(v #>> '{}') between 1 and max_chars end
$fn$;
revoke all on function lumin.service_draft_uint(jsonb,bigint),lumin.service_draft_label(jsonb,integer)
  from public,anon,authenticated,service_role;

create function public.ingest_service_draft(
  p_actor uuid,p_tenant uuid,p_key text,p_template text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare
  t public.tenants; old public.service_draft_ingestions; sid uuid:=gen_random_uuid();
  digest text; item jsonb; choice jsonb; rental jsonb; pos integer; seen text[];
begin
  if p_actor is null or p_tenant is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_template is null or p_template !~ '^[a-z][a-z0-9-]{0,99}$'
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(convert_to(p_payload::text,'UTF8'))>32768
  then raise exception 'INVALID_SERVICE_DRAFT' using errcode='22023'; end if;
  -- No caller-supplied tenant, currency, timezone, service id or active flag.
  if p_payload-array['archetype','name','description','basePrice','durationMinutes','taxRateBp','rental','items','addons','questions']<>'{}'::jsonb
    or p_payload ?& array['archetype','name','basePrice','durationMinutes','taxRateBp','items','addons','questions'] is not true
    or p_payload->>'archetype' not in ('simple','cart','configurable','rental')
    or jsonb_typeof(p_payload->'name')<>'string' or length(p_payload->>'name') not between 1 and 200
    or (p_payload ? 'description' and (jsonb_typeof(p_payload->'description')<>'string' or length(p_payload->>'description')>2000))
    or jsonb_typeof(p_payload->'items')<>'array' or jsonb_typeof(p_payload->'addons')<>'array'
    or jsonb_typeof(p_payload->'questions')<>'array'
    or jsonb_array_length(p_payload->'items')>50 or jsonb_array_length(p_payload->'addons')>50
    or jsonb_array_length(p_payload->'questions')>50
    or not lumin.service_draft_uint(p_payload->'basePrice',9007199254740991)
    or not lumin.service_draft_uint(p_payload->'durationMinutes',1440) or (p_payload->>'durationMinutes')::integer<5
    or not lumin.service_draft_uint(p_payload->'taxRateBp',10000)
  then raise exception 'INVALID_SERVICE_DRAFT' using errcode='22023'; end if;
  rental:=p_payload->'rental';
  if p_payload->>'archetype'='rental' then
    if rental is null or jsonb_typeof(rental)<>'object'
      or rental-array['periodMinutes','pricePerPeriod','minPeriods','maxPeriods','depositAmount']<>'{}'::jsonb
      or rental ?& array['periodMinutes','pricePerPeriod','minPeriods','maxPeriods','depositAmount'] is not true
      or not lumin.service_draft_uint(rental->'periodMinutes',525600) or (rental->>'periodMinutes')::integer<1
      or not lumin.service_draft_uint(rental->'pricePerPeriod',9007199254740991)
      or not lumin.service_draft_uint(rental->'depositAmount',9007199254740991)
      or not lumin.service_draft_uint(rental->'minPeriods',10000) or (rental->>'minPeriods')::integer<1
      or not lumin.service_draft_uint(rental->'maxPeriods',10000)
      or (rental->>'maxPeriods')::integer<(rental->>'minPeriods')::integer
    then raise exception 'INVALID_RENTAL_DRAFT' using errcode='22023'; end if;
  elsif rental is not null then
    raise exception 'UNEXPECTED_RENTAL_CONFIG' using errcode='22023';
  end if;
  -- Serialize adoption by tenant before flow_actor takes its tenant SHARE
  -- lock. A later SHARE-to-UPDATE upgrade can deadlock two concurrent calls.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,38421));
  perform lumin.flow_actor(p_actor,p_tenant,true);
  select * into t from public.tenants where id=p_tenant and status='active' for share;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_object('template',p_template,'payload',p_payload)::text,'UTF8')),'hex');
  select * into old from public.service_draft_ingestions
    where tenant_id=p_tenant and actor_id=p_actor and idempotency_key=p_key;
  if found then
    if old.template_key<>p_template or old.payload_sha256<>digest then
      raise exception 'SERVICE_DRAFT_CONFLICT' using errcode='40001';
    end if;
    -- The receipt is a tombstone if the draft was deleted. Never manufacture a
    -- second service for the same operation, or claim a live service is draft.
    perform 1 from public.services where tenant_id=p_tenant and id=old.service_id and not active for share;
    if not found then raise exception 'SERVICE_DRAFT_STATE_CHANGED' using errcode='40001'; end if;
    return jsonb_build_object('serviceId',old.service_id,'templateKey',old.template_key,'active',false);
  end if;
  insert into public.services(id,tenant_id,archetype,name,description,currency,base_price,duration_minutes,tax_rate_bp,rental,active)
  values(sid,p_tenant,p_payload->>'archetype',p_payload->>'name',coalesce(p_payload->>'description',''),t.currency,
    (p_payload->>'basePrice')::bigint,(p_payload->>'durationMinutes')::integer,(p_payload->>'taxRateBp')::integer,
    p_payload->'rental',false);
  pos:=0;seen:=array[]::text[];
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(item)<>'object' or item-array['id','name','description','unitPrice','minQty','maxQty']<>'{}'::jsonb
      or item ?& array['id','name','unitPrice','minQty','maxQty'] is not true
      or not lumin.service_draft_label(item->'id',100) or (item->>'id')=any(seen)
      or (item->>'id') in ('__proto__','constructor','prototype')
      or not lumin.service_draft_label(item->'name',200)
      or (item ? 'description' and (jsonb_typeof(item->'description')<>'string' or length(item->>'description')>2000))
      or not lumin.service_draft_uint(item->'unitPrice',9007199254740991)
      or not lumin.service_draft_uint(item->'minQty',10000)
      or not lumin.service_draft_uint(item->'maxQty',10000) or (item->>'maxQty')::integer<1
      or (item->>'maxQty')::integer<(item->>'minQty')::integer then
      raise exception 'INVALID_SERVICE_ITEM' using errcode='22023'; end if;
    seen:=array_append(seen,item->>'id');
    insert into public.service_items(tenant_id,service_id,item_key,name,description,unit_price,min_qty,max_qty,sort_order)
      values(p_tenant,sid,item->>'id',item->>'name',item->>'description',(item->>'unitPrice')::bigint,
        (item->>'minQty')::integer,(item->>'maxQty')::integer,pos);
    pos:=pos+1;
  end loop;
  pos:=0;seen:=array[]::text[];
  for item in select value from jsonb_array_elements(p_payload->'addons') loop
    if jsonb_typeof(item)<>'object' or item-array['id','name','description','price']<>'{}'::jsonb
      or item ?& array['id','name','price'] is not true
      or not lumin.service_draft_label(item->'id',100) or (item->>'id')=any(seen)
      or (item->>'id') in ('__proto__','constructor','prototype')
      or not lumin.service_draft_label(item->'name',200)
      or (item ? 'description' and (jsonb_typeof(item->'description')<>'string' or length(item->>'description')>2000))
      or not lumin.service_draft_uint(item->'price',9007199254740991) then
      raise exception 'INVALID_SERVICE_ADDON' using errcode='22023'; end if;
    seen:=array_append(seen,item->>'id');
    insert into public.service_addons(tenant_id,service_id,addon_key,name,description,price,sort_order)
      values(p_tenant,sid,item->>'id',item->>'name',item->>'description',(item->>'price')::bigint,pos);
    pos:=pos+1;
  end loop;
  pos:=0;seen:=array[]::text[];
  for item in select value from jsonb_array_elements(p_payload->'questions') loop
    if jsonb_typeof(item)<>'object' or item-array['id','prompt','kind','required','choices','unitPrice','minQty','maxQty']<>'{}'::jsonb
      or item ?& array['id','prompt','kind','required','choices'] is not true
      or jsonb_typeof(item->'required')<>'boolean' or jsonb_typeof(item->'choices')<>'array'
      or jsonb_array_length(item->'choices')>50
      or not lumin.service_draft_label(item->'id',100) or (item->>'id')=any(seen)
      or (item->>'id') in ('__proto__','constructor','prototype')
      or not lumin.service_draft_label(item->'prompt',500)
      or item->>'kind' not in ('quantity','single_choice','multi_choice')
      or (item ? 'unitPrice' and not lumin.service_draft_uint(item->'unitPrice',9007199254740991))
      or (item ? 'minQty' and not lumin.service_draft_uint(item->'minQty',10000))
      or (item ? 'maxQty' and not lumin.service_draft_uint(item->'maxQty',10000))
      or (item->>'kind'='quantity' and (not item ? 'unitPrice' or jsonb_array_length(item->'choices')<>0))
      or (item->>'kind'<>'quantity' and (item ? 'unitPrice' or item ? 'minQty' or item ? 'maxQty' or jsonb_array_length(item->'choices')=0))
      or (item ? 'maxQty' and item ? 'minQty' and (item->>'maxQty')::integer<(item->>'minQty')::integer) then
      raise exception 'INVALID_SERVICE_QUESTION' using errcode='22023'; end if;
    seen:=array_append(seen,item->>'id');
    declare choice_ids text[]:=array[]::text[];
    begin
      for choice in select value from jsonb_array_elements(item->'choices') loop
        if jsonb_typeof(choice)<>'object'
          or choice-array['id','label','priceDelta','priceMultiplierBp']<>'{}'::jsonb
          or choice ?& array['id','label','priceDelta','priceMultiplierBp'] is not true
          or not lumin.service_draft_label(choice->'id',100) or (choice->>'id')=any(choice_ids)
          or (choice->>'id') in ('__proto__','constructor','prototype')
          or not lumin.service_draft_label(choice->'label',200)
          or not lumin.service_draft_uint(choice->'priceDelta',9007199254740991)
          or not lumin.service_draft_uint(choice->'priceMultiplierBp',9007199254740991)
        then raise exception 'INVALID_SERVICE_CHOICE' using errcode='22023'; end if;
        choice_ids:=array_append(choice_ids,choice->>'id');
      end loop;
    end;
    insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,choices,unit_price,min_qty,max_qty,sort_order)
      values(p_tenant,sid,item->>'id',item->>'prompt',item->>'kind',(item->>'required')::boolean,item->'choices',
        (item->>'unitPrice')::bigint,(item->>'minQty')::integer,(item->>'maxQty')::integer,pos);
    pos:=pos+1;
  end loop;
  insert into public.service_draft_ingestions(tenant_id,actor_id,idempotency_key,template_key,payload_sha256,service_id)
    values(p_tenant,p_actor,p_key,p_template,digest,sid);
  return jsonb_build_object('serviceId',sid,'templateKey',p_template,'active',false);
end $fn$;
revoke all on function public.ingest_service_draft(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ingest_service_draft(uuid,uuid,text,text,jsonb) to service_role;
