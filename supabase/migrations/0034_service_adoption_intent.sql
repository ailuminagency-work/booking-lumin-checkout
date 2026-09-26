-- Durable owner-scoped request intent. The API commits begin_service_draft_intent
-- before it invokes 0033 ingest_service_draft in a second transaction.
begin;
create table public.service_draft_intents (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  template_key text not null check (template_key ~ '^[a-z][a-z0-9-]{0,99}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending','committed')),
  service_id uuid,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  primary key (tenant_id,actor_id,idempotency_key),
  unique (tenant_id,service_id),
  check ((state='pending' and service_id is null and committed_at is null)
    or (state='committed' and service_id is not null and committed_at is not null))
);
create index service_draft_intents_owner_recent on public.service_draft_intents(tenant_id,actor_id,created_at desc,idempotency_key desc);
alter table public.service_draft_intents enable row level security;
alter table public.service_draft_intents force row level security;
revoke all on public.service_draft_intents from public,anon,authenticated,service_role;

-- Existing committed ingestions predate the journal. Keep their original actor
-- and key; no synthetic pending request or replacement service is invented.
-- Block concurrent 0033 inserts until the backfill and trigger are both visible.
lock table public.service_draft_ingestions in share row exclusive mode;
insert into public.service_draft_intents(tenant_id,actor_id,idempotency_key,template_key,payload_sha256,state,service_id,created_at,committed_at)
select tenant_id,actor_id,idempotency_key,template_key,payload_sha256,'committed',service_id,created_at,created_at
from public.service_draft_ingestions;

create function public.begin_service_draft_intent(p_actor uuid,p_tenant uuid,p_key text,p_template text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare old public.service_draft_intents; draft_exists boolean; digest text;
begin
  if p_actor is null or p_tenant is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_template is null or p_template !~ '^[a-z][a-z0-9-]{0,99}$'
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(convert_to(p_payload::text,'UTF8'))>32768
  then raise exception 'INVALID_SERVICE_DRAFT_INTENT' using errcode='22023'; end if;
  -- Same tenant lock order as 0033 before flow_actor's tenant SHARE lock.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,38421));
  perform lumin.flow_actor(p_actor,p_tenant,true);
  digest:=encode(sha256(convert_to(jsonb_build_object('template',p_template,'payload',p_payload)::text,'UTF8')),'hex');
  select * into old from public.service_draft_intents
    where tenant_id=p_tenant and actor_id=p_actor and idempotency_key=p_key for update;
  if found then
    if old.template_key<>p_template or old.payload_sha256<>digest then
      raise exception 'SERVICE_DRAFT_CONFLICT' using errcode='40001'; end if;
    select exists(select 1 from public.services s where s.tenant_id=p_tenant and s.id=old.service_id and not s.active) into draft_exists;
    return jsonb_build_object('state',case when old.state='committed' and not draft_exists then 'changed' else old.state end,
      'serviceId',old.service_id,'templateKey',old.template_key)
      || case when old.state='committed' and not draft_exists then '{}'::jsonb else jsonb_build_object('active',false) end;
  end if;
  insert into public.service_draft_intents(tenant_id,actor_id,idempotency_key,template_key,payload_sha256,state)
    values(p_tenant,p_actor,p_key,p_template,digest,'pending');
  return jsonb_build_object('state','pending','serviceId',null,'templateKey',p_template,'active',false);
end $fn$;

-- Existing 0033 callers remain valid. The trigger atomically reconciles an
-- earlier intent; if no intent exists it records a legacy committed adoption.
create function lumin.record_service_draft_commit() returns trigger
language plpgsql security definer set search_path=pg_catalog as $fn$
declare old public.service_draft_intents;
begin
  select * into old from public.service_draft_intents
    where tenant_id=new.tenant_id and actor_id=new.actor_id and idempotency_key=new.idempotency_key for update;
  if found then
    if old.template_key<>new.template_key or old.payload_sha256<>new.payload_sha256
      or old.state<>'pending' or old.service_id is not null then
      raise exception 'SERVICE_DRAFT_CONFLICT' using errcode='40001'; end if;
    update public.service_draft_intents set state='committed',service_id=new.service_id,committed_at=now()
      where tenant_id=new.tenant_id and actor_id=new.actor_id and idempotency_key=new.idempotency_key;
  else
    insert into public.service_draft_intents(tenant_id,actor_id,idempotency_key,template_key,payload_sha256,state,service_id,created_at,committed_at)
      values(new.tenant_id,new.actor_id,new.idempotency_key,new.template_key,new.payload_sha256,'committed',new.service_id,new.created_at,now());
  end if;
  return new;
end $fn$;
create trigger service_draft_ingestion_intent after insert on public.service_draft_ingestions
for each row execute function lumin.record_service_draft_commit();

-- Exact-key recovery remains owner/tenant bound. A missing row means unknown,
-- never proof that a prior HTTP request cannot still reach the database.
create function public.lookup_service_draft_intent(p_actor uuid,p_tenant uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare i public.service_draft_intents; live boolean;
begin
  if p_actor is null or p_tenant is null or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'INVALID_SERVICE_DRAFT_INTENT' using errcode='22023'; end if;
  perform lumin.flow_actor(p_actor,p_tenant,true);
  select * into i from public.service_draft_intents
    where tenant_id=p_tenant and actor_id=p_actor and idempotency_key=p_key;
  if not found then return null; end if;
  select exists(select 1 from public.services s where s.tenant_id=p_tenant and s.id=i.service_id and not s.active) into live;
  return jsonb_build_object('idempotencyKey',i.idempotency_key,'templateKey',i.template_key,
    'state',case when i.state='committed' and not live then 'changed' else i.state end,
    'serviceId',i.service_id,'createdAt',i.created_at)
    || case when i.state='committed' and not live then '{}'::jsonb else jsonb_build_object('active',false) end;
end $fn$;

create function public.list_service_draft_intents(p_actor uuid,p_tenant uuid,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare result jsonb;
begin
  if p_actor is null or p_tenant is null or p_limit is null or p_limit not between 1 and 50
  then raise exception 'INVALID_SERVICE_DRAFT_INTENT' using errcode='22023'; end if;
  perform lumin.flow_actor(p_actor,p_tenant,true);
  select coalesce(jsonb_agg(jsonb_build_object('idempotencyKey',x.idempotency_key,'templateKey',x.template_key,
    'state',case when x.state='committed' and not x.live then 'changed' else x.state end,
    'serviceId',x.service_id,'createdAt',x.created_at)
    || case when x.state='committed' and not x.live then '{}'::jsonb else jsonb_build_object('active',false) end
    order by x.created_at desc,x.idempotency_key desc),'[]'::jsonb)
    into result from (
      select i.*,exists(select 1 from public.services s where s.tenant_id=p_tenant and s.id=i.service_id and not s.active) as live
      from public.service_draft_intents i where i.tenant_id=p_tenant and i.actor_id=p_actor
      order by i.created_at desc,i.idempotency_key desc limit p_limit
    ) x;
  return result;
end $fn$;

revoke all on function lumin.record_service_draft_commit(),
  public.begin_service_draft_intent(uuid,uuid,text,text,jsonb),
  public.lookup_service_draft_intent(uuid,uuid,text),
  public.list_service_draft_intents(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.begin_service_draft_intent(uuid,uuid,text,text,jsonb),
  public.lookup_service_draft_intent(uuid,uuid,text),
  public.list_service_draft_intents(uuid,uuid,integer) to service_role;
commit;
