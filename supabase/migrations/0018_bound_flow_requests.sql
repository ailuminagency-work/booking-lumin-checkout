-- W3 local runnable request boundary. No holds, quotes, payment or confirmation.
-- All exposed RPCs are service-role only. p_actor_id is supplied by a trusted
-- verifier, never accepted from HTTP caller data; current membership is rechecked.
begin;
create table public.bound_flow_services (
 tenant_id uuid not null, flow_id uuid not null, service_id uuid not null,
 primary key(tenant_id,flow_id),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id),
 foreign key(tenant_id,service_id) references public.services(tenant_id,id)
);
create table public.bound_flow_versions (
 tenant_id uuid not null, flow_id uuid not null, version_id uuid not null, service_id uuid not null,
 service_snapshot jsonb not null check(jsonb_typeof(service_snapshot)='object' and octet_length(service_snapshot::text)<=131072),
 primary key(tenant_id,flow_id,version_id), unique(tenant_id,flow_id,version_id,service_id),
 foreign key(tenant_id,flow_id,version_id) references public.flow_versions(tenant_id,flow_id,id),
 foreign key(tenant_id,service_id) references public.services(tenant_id,id)
);
create trigger bound_flow_versions_immutable before update or delete on public.bound_flow_versions
 for each row execute function lumin.reject_flow_version_mutation();
alter table public.flow_installations add constraint flow_installations_tuple_key unique(tenant_id,flow_id,version_id,id);
create table public.flow_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 tenant_id uuid not null, flow_id uuid not null, version_id uuid not null, installation_id uuid not null, service_id uuid not null,
 origin text not null, expires_at timestamptz not null, revoked boolean not null default false,
 unique(tenant_id,id),
 foreign key(tenant_id,flow_id,version_id,service_id) references public.bound_flow_versions(tenant_id,flow_id,version_id,service_id),
 foreign key(tenant_id,flow_id,version_id,installation_id) references public.flow_installations(tenant_id,flow_id,version_id,id)
);
create table public.flow_requests (
 tenant_id uuid not null, session_id uuid primary key, booking_id uuid not null unique,
 idempotency_key text not null check(length(idempotency_key) between 16 and 128),
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 foreign key(tenant_id,session_id) references public.flow_sessions(tenant_id,id),
 foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id)
);
create index bound_flow_services_service_idx on public.bound_flow_services(tenant_id,service_id);
create index bound_flow_versions_service_idx on public.bound_flow_versions(tenant_id,service_id);
create index flow_sessions_version_idx on public.flow_sessions(tenant_id,flow_id,version_id,service_id);
create index flow_sessions_installation_idx on public.flow_sessions(tenant_id,flow_id,version_id,installation_id);
create index flow_requests_tenant_idx on public.flow_requests(tenant_id,session_id);
alter table public.bound_flow_services enable row level security;
alter table public.bound_flow_services force row level security;
alter table public.bound_flow_versions enable row level security;
alter table public.bound_flow_versions force row level security;
alter table public.flow_sessions enable row level security;
alter table public.flow_sessions force row level security;
alter table public.flow_requests enable row level security;
alter table public.flow_requests force row level security;
revoke all on public.bound_flow_services,public.bound_flow_versions,public.flow_sessions,public.flow_requests from public,anon,authenticated,service_role;

create function lumin.flow_actor(p_actor uuid,p_tenant uuid,p_owner boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r text;
begin
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select role into r from public.tenant_members where tenant_id=p_tenant and user_id=p_actor for share;
 if not found or (p_owner and r<>'BUSINESS_OWNER') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
end $$;

-- Snapshot built from authoritative tables, never caller JSON. Only unconditional
-- question-only zero-price simple services are supported by this bounded journey.
create function lumin.flow_service_render(p_tenant uuid,p_service uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.services; q public.service_questions; c jsonb; questions jsonb:='[]'; choices jsonb; seen text[]; lo integer; hi integer;
begin
 select * into s from public.services where tenant_id=p_tenant and id=p_service and active for share;
 if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode='P0002'; end if;
 if (select count(*) from public.service_questions where service_id=s.id) not between 1 and 50 then raise exception 'UNSUPPORTED_QUESTION_COUNT' using errcode='0A000'; end if;
 if s.archetype<>'simple' or s.base_price<>0 or s.tax_rate_bp<>0 or s.rental is not null or s.duration_minutes not between 5 and 1440
 or length(s.name) not between 1 and 200 or exists(select 1 from public.service_items where service_id=s.id)
 or exists(select 1 from public.service_addons where service_id=s.id)
 or exists(select 1 from public.service_questions where service_id=s.id and tenant_id<>p_tenant)
 then raise exception 'UNSUPPORTED_SERVICE' using errcode='0A000'; end if;
 for q in select * from public.service_questions where service_id=s.id order by sort_order,id for share loop
  if q.tenant_id is distinct from p_tenant or length(q.question_key) not between 1 and 100 or q.question_key in ('__proto__','constructor','prototype') or length(q.prompt) not between 1 and 500
  or q.unit_price is not null and q.unit_price<>0 or jsonb_array_length(q.choices)>50 then raise exception 'UNSUPPORTED_QUESTION' using errcode='0A000'; end if;
  choices:='[]'; seen:=array[]::text[];
  for c in select value from jsonb_array_elements(q.choices) loop
   if jsonb_typeof(c)<>'object' or (c-array['id','label','priceDelta','priceMultiplierBp'])<>'{}'
   or jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100
   or jsonb_typeof(c->'label') is distinct from 'string' or length(c->>'label') not between 1 and 200
   or (c->>'id')=any(seen)
   or (c ? 'priceDelta' and (jsonb_typeof(c->'priceDelta')<>'number' or c->'priceDelta'<>'0'::jsonb))
   or (c ? 'priceMultiplierBp' and (jsonb_typeof(c->'priceMultiplierBp')<>'number' or c->'priceMultiplierBp'<>'10000'::jsonb))
   then raise exception 'UNSUPPORTED_CHOICE' using errcode='0A000'; end if;
   seen:=array_append(seen,c->>'id'); choices:=choices||jsonb_build_array(jsonb_build_object('id',c->>'id','label',c->>'label'));
  end loop;
  if q.kind='quantity' then
   lo:=coalesce(q.min_qty,0); hi:=coalesce(q.max_qty,10000);
   if lo<0 or hi>10000 or lo>hi or jsonb_array_length(choices)<>0 then raise exception 'UNSUPPORTED_QUANTITY' using errcode='0A000'; end if;
   questions:=questions||jsonb_build_array(jsonb_build_object('id',q.question_key,'prompt',q.prompt,'kind',q.kind,'required',q.required,'choices',choices,'minQty',lo,'maxQty',hi));
  else
   if jsonb_array_length(choices)=0 then raise exception 'UNSUPPORTED_CHOICES' using errcode='0A000'; end if;
   questions:=questions||jsonb_build_array(jsonb_build_object('id',q.question_key,'prompt',q.prompt,'kind',q.kind,'required',q.required,'choices',choices));
  end if;
 end loop;
 if jsonb_array_length(questions) not between 1 and 50 or octet_length(questions::text)>126000 then raise exception 'UNSUPPORTED_QUESTION_COUNT' using errcode='0A000'; end if;
 return jsonb_build_object('id',s.id,'name',s.name,'durationMinutes',s.duration_minutes,'questions',questions);
end $$;

create function lumin.bound_flow_config(p_config jsonb,p_service jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare step jsonb; q jsonb; seen text[]:=array[]::text[];
begin
 if not lumin.flow_config_storage_valid(p_config) or jsonb_array_length(p_config->'steps')<>jsonb_array_length(p_service->'questions') then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000'; end if;
 for step in select value from jsonb_array_elements(p_config->'steps') loop
  if step-array['key','questionKey','kind','required']<>'{}' or step->>'kind' is distinct from 'question'
  or jsonb_typeof(step->'required') is distinct from 'boolean' or (step->>'questionKey')=any(seen)
  or (select count(*) from jsonb_array_elements(p_config->'steps') e where e->>'key'=step->>'key')<>1
  then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000'; end if;
  select value into q from jsonb_array_elements(p_service->'questions') where value->>'id'=step->>'questionKey';
  if not found or q->'required'<>step->'required' then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000'; end if;
  seen:=array_append(seen,step->>'questionKey');
 end loop;
end $$;

create function public.flow_owner_services(p_actor_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s record; result jsonb:='[]'; render jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 for s in select id from public.services where tenant_id=p_tenant_id and active order by id limit 100 loop
  begin render:=lumin.flow_service_render(p_tenant_id,s.id); exception when feature_not_supported then continue; end;
  result:=result||jsonb_build_array(render); exit when jsonb_array_length(result)>=100;
 end loop;
 return jsonb_build_object('services',result);
end $$;
create function public.flow_owner_list(p_actor_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 select coalesce(jsonb_agg(x.dto order by x.id),'[]') into result from (
 select f.id,jsonb_build_object('flowId',f.id,'name',f.name,'status',f.status,'revision',d.revision,'serviceId',b.service_id,'publishedVersionId',f.published_version_id) dto
 from public.flows f join public.flow_drafts d on d.tenant_id=f.tenant_id and d.flow_id=f.id
 left join public.bound_flow_services b on b.tenant_id=f.tenant_id and b.flow_id=f.id where f.tenant_id=p_tenant_id order by f.id limit 100) x;
 return jsonb_build_object('flows',result);
end $$;
create function public.flow_owner_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; service uuid;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 select jsonb_build_object('flowId',f.id,'name',f.name,'revision',d.revision,'serviceId',b.service_id,'config',d.config),b.service_id into result,service
 from public.flows f join public.flow_drafts d on d.tenant_id=f.tenant_id and d.flow_id=f.id
 join public.bound_flow_services b on b.tenant_id=f.tenant_id and b.flow_id=f.id where f.tenant_id=p_tenant_id and f.id=p_flow_id;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002'; end if;
 return result||jsonb_build_object('service',lumin.flow_service_render(p_tenant_id,service));
end $$;
create function public.flow_owner_requests(p_actor_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 select coalesce(jsonb_agg(x.dto order by x.created_at desc,x.id desc),'[]') into result from (
 select b.id,b.created_at,jsonb_build_object('id',b.id,'reference',b.reference,'state','draft','slotStart',b.slot_start,'createdAt',b.created_at) dto
 from public.bookings b join public.flow_requests r on r.booking_id=b.id and r.tenant_id=b.tenant_id
 where b.tenant_id=p_tenant_id and b.state='draft' order by b.created_at desc,b.id desc limit 100) x;
 return jsonb_build_object('requests',result);
end $$;

create function public.save_bound_flow_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_service_id uuid,p_expected_revision bigint,p_name text,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare render jsonb; revision bigint;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 if p_expected_revision>0 then
  perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 end if;
 render:=lumin.flow_service_render(p_tenant_id,p_service_id); perform lumin.bound_flow_config(p_config,render);
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then raise exception 'INVALID_REVISION' using errcode='22023'; end if;
 if p_expected_revision=0 then
  insert into public.flows(id,tenant_id,name) values(p_flow_id,p_tenant_id,p_name);
  insert into public.flow_drafts values(p_tenant_id,p_flow_id,1,p_config); revision:=1;
 else
  perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
  update public.flow_drafts set revision=flow_drafts.revision+1,config=p_config where tenant_id=p_tenant_id and flow_id=p_flow_id and flow_drafts.revision=p_expected_revision returning flow_drafts.revision into revision;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
  update public.flows set name=p_name where tenant_id=p_tenant_id and id=p_flow_id;
 end if;
 insert into public.bound_flow_services values(p_tenant_id,p_flow_id,p_service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 return jsonb_build_object('flowId',p_flow_id,'revision',revision);
end $$;
create function public.publish_bound_flow(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_expected_revision bigint,p_version_id uuid,p_installation_id uuid,p_allowed_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare service uuid; render jsonb; d public.flow_drafts;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 -- Serialize with bound/unbound draft edits before reading binding and config.
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 select service_id into service from public.bound_flow_services where tenant_id=p_tenant_id and flow_id=p_flow_id;
 if not found then raise exception 'FLOW_UNBOUND' using errcode='P0002'; end if;
 render:=lumin.flow_service_render(p_tenant_id,service);
 select * into d from public.flow_drafts where tenant_id=p_tenant_id and flow_id=p_flow_id;
 if d.revision is distinct from p_expected_revision then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 perform lumin.bound_flow_config(d.config,render);
 perform public.publish_flow_version(p_tenant_id,p_flow_id,p_expected_revision,p_version_id,p_installation_id,d.config,p_allowed_origins);
 insert into public.bound_flow_versions values(p_tenant_id,p_flow_id,p_version_id,service,render);
 return jsonb_build_object('versionId',p_version_id,'installationId',p_installation_id);
end $$;

create function public.issue_flow_session(p_installation_id uuid,p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.flow_installations; v public.bound_flow_versions; config jsonb; expiry timestamptz;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_TOKEN' using errcode='22023'; end if;
 select * into i from public.flow_installations where id=p_installation_id;
 if not found or p_origin is null or not (i.allowed_origins ? p_origin) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenants where id=i.tenant_id and status='active' for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.flows where tenant_id=i.tenant_id and id=i.flow_id and status='active' for share;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002'; end if;
 select * into v from public.bound_flow_versions where tenant_id=i.tenant_id and flow_id=i.flow_id and version_id=i.version_id;
 if not found then raise exception 'FLOW_UNBOUND' using errcode='P0002'; end if;
 perform 1 from public.services where tenant_id=i.tenant_id and id=v.service_id and active for share;
 if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode='P0002'; end if;
 select fv.config into config from public.flow_versions fv where fv.tenant_id=i.tenant_id and fv.flow_id=i.flow_id and fv.id=i.version_id;
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into public.flow_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,origin,expires_at)
 values(p_token_hash,i.tenant_id,i.flow_id,i.version_id,i.id,v.service_id,p_origin,expiry);
 return jsonb_build_object('expiresAt',expiry,'render',jsonb_build_object('versionId',i.version_id,'config',config,'service',v.service_snapshot));
end $$;

create function lumin.flow_answers_valid(p_answers jsonb,p_service jsonb) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare q jsonb; a jsonb; key text; choices jsonb; chosen jsonb; amount numeric;
begin
 if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>16384 then return false; end if;
 for key in select jsonb_object_keys(p_answers) loop
  if not exists(select 1 from jsonb_array_elements(p_service->'questions') as question_row(value) where question_row.value->>'id'=key) then return false; end if;
 end loop;
 for q in select value from jsonb_array_elements(p_service->'questions') loop
  a:=p_answers->(q->>'id');
  if a is null then if (q->>'required')::boolean then return false; end if; continue; end if;
  if jsonb_typeof(a)<>'object' then return false; end if;
  if q->>'kind'='quantity' then
   if a-array['quantity']<>'{}' or jsonb_typeof(a->'quantity') is distinct from 'number' then return false; end if;
   amount:=(a->>'quantity')::numeric;
   if amount<>trunc(amount) or amount<(q->>'minQty')::integer or amount>(q->>'maxQty')::integer then return false; end if;
  else
   if a-array['choiceIds']<>'{}' or jsonb_typeof(a->'choiceIds') is distinct from 'array' then return false; end if;
   choices:=a->'choiceIds';
   if jsonb_array_length(choices) not between 1 and 50 or (q->>'kind'='single_choice' and jsonb_array_length(choices)<>1)
   or (select count(distinct value) from jsonb_array_elements(choices))<>jsonb_array_length(choices) then return false; end if;
   for chosen in select value from jsonb_array_elements(choices) loop
    if jsonb_typeof(chosen)<>'string' or not exists(select 1 from jsonb_array_elements(q->'choices') c where c->'id'=chosen) then return false; end if;
   end loop;
  end if;
 end loop;
 return true;
end $$;

create function public.submit_flow_request(p_token_hash text,p_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare sess public.flow_sessions; snapshot jsonb; old public.flow_requests; hash text; customer uuid; booking uuid; ref text; v_name text; v_email text; result jsonb;
begin
 select * into sess from public.flow_sessions where token_hash=p_token_hash for update;
 if not found or sess.revoked or sess.expires_at<=clock_timestamp() or p_origin is distinct from sess.origin then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.tenants where id=sess.tenant_id and status='active' for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.flows where tenant_id=sess.tenant_id and id=sess.flow_id and status='active' for share;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002'; end if;
 perform 1 from public.services where tenant_id=sess.tenant_id and id=sess.service_id and active for share;
 if not found then raise exception 'SERVICE_UNAVAILABLE' using errcode='P0002'; end if;
 if not exists(select 1 from public.flow_installations where id=sess.installation_id and tenant_id=sess.tenant_id and flow_id=sess.flow_id and version_id=sess.version_id and allowed_origins ? p_origin) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select service_snapshot into snapshot from public.bound_flow_versions where tenant_id=sess.tenant_id and flow_id=sess.flow_id and version_id=sess.version_id and service_id=sess.service_id;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128 or not lumin.flow_answers_valid(p_answers,snapshot)
 or p_customer is null or jsonb_typeof(p_customer)<>'object' or p_customer-array['name','email']<>'{}'
 or jsonb_typeof(p_customer->'name') is distinct from 'string' or jsonb_typeof(p_customer->'email') is distinct from 'string'
 or p_requested_start is null or not isfinite(p_requested_start) then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 v_name:=btrim(p_customer->>'name'); v_email:=btrim(p_customer->>'email');
 if length(v_name) not between 1 and 200 or length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_CUSTOMER' using errcode='22023'; end if;
 -- UTC-independent timestamp epoch and normalized customer yield stable retry hash.
 hash:=encode(sha256(convert_to(jsonb_build_object('answers',p_answers,'customer',jsonb_build_object('name',v_name,'email',v_email),'requestedEpoch',extract(epoch from p_requested_start))::text,'UTF8')),'hex');
 select * into old from public.flow_requests where session_id=sess.id;
 if found then
  if old.idempotency_key<>p_idempotency_key or old.request_hash<>hash then raise exception 'REQUEST_CONFLICT' using errcode='40001'; end if;
  select reference into ref from public.bookings where tenant_id=sess.tenant_id and id=old.booking_id;
  return jsonb_build_object('reference',ref,'state','draft','confirmed',false);
 end if;
 if p_requested_start<=clock_timestamp() then raise exception 'INVALID_TIME' using errcode='22023'; end if;
 -- Do not overwrite a known customer's identity from a public request.
 insert into public.customers(tenant_id,name,email) values(sess.tenant_id,v_name,v_email) on conflict(tenant_id,email) do nothing returning id into customer;
 if customer is null then select id into customer from public.customers where tenant_id=sess.tenant_id and customers.email=v_email; end if;
 booking:=gen_random_uuid(); ref:='LMN-'||upper(replace(booking::text,'-',''));
 insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key)
 values(booking,sess.tenant_id,ref,'draft',jsonb_build_object('serviceId',sess.service_id,'answers',p_answers),'{}',p_requested_start,p_requested_start+make_interval(mins=>(snapshot->>'durationMinutes')::integer),customer,'flow-session:'||sess.id::text);
 insert into public.flow_requests values(sess.tenant_id,sess.id,booking,p_idempotency_key,hash);
 perform public.outbox_enqueue(sess.tenant_id,booking,'booking.requested',sess.id);
 if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('reference',ref,'state','draft','confirmed',false);
end $$;

revoke all on function lumin.flow_actor(uuid,uuid,boolean),lumin.flow_service_render(uuid,uuid),lumin.bound_flow_config(jsonb,jsonb),lumin.flow_answers_valid(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.flow_owner_services(uuid,uuid),public.flow_owner_list(uuid,uuid),public.flow_owner_draft(uuid,uuid,uuid),public.flow_owner_requests(uuid,uuid),public.save_bound_flow_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb),public.publish_bound_flow(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.issue_flow_session(uuid,text,text),public.submit_flow_request(text,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.flow_owner_services(uuid,uuid),public.flow_owner_list(uuid,uuid),public.flow_owner_draft(uuid,uuid,uuid),public.flow_owner_requests(uuid,uuid),public.save_bound_flow_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb),public.publish_bound_flow(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.issue_flow_session(uuid,text,text),public.submit_flow_request(text,text,text,jsonb,jsonb,timestamptz) to service_role;
commit;
