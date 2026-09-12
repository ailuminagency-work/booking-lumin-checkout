-- Configurable V2 publication; V1 snapshots and request hashes remain unchanged.
begin;
alter table public.flow_drafts add column authoring_version integer not null default 1 check(authoring_version in(1,2)), add column authoring jsonb;
alter table public.flow_drafts add constraint flow_draft_authoring_shape check((authoring_version=1 and authoring is null) or (authoring_version=2 and authoring is not null and jsonb_typeof(authoring)='object' and authoring->'authoringVersion'='2'::jsonb and authoring->'config'=config) is true);
alter table public.flow_versions add column render_schema_version integer not null default 1 check(render_schema_version in(1,2)), add column configurable_snapshot jsonb;
alter table public.flow_versions add constraint flow_version_render_shape check((render_schema_version=1 and configurable_snapshot is null) or (render_schema_version=2 and configurable_snapshot is not null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config) is true);

create function lumin.utf16_length(p text) returns integer language sql immutable strict set search_path=pg_catalog as $$
 select coalesce(sum(case when ascii(substr(p,n,1))>65535 then 2 else 1 end),0)::integer from generate_series(1,length(p)) n
$$;
create function lumin.v2_text(p jsonb,n integer,identifier boolean default false) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p)='string' and lumin.utf16_length(p#>>'{}') between 1 and n and (not identifier or p#>>'{}' not in('__proto__','constructor','prototype')),false)
$$;
create function lumin.v2_quantity(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare n numeric; begin if jsonb_typeof(p) is distinct from 'number' then return false; end if; n:=(p#>>'{}')::numeric; return n=trunc(n) and n between 0 and 10000; end $$;
-- JS traversal parity: values count as nodes; object keys and array index keys
-- count as UTF-16 text. Byte limits separately bound parser/storage work.
create function lumin.v2_budget(p jsonb) returns void language plpgsql immutable set search_path=pg_catalog as $$
declare pending jsonb[]:=array[p]; v jsonb; child record; nodes integer:=0; units integer:=0;
begin
 if p is null then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 if octet_length(p::text)>524288 then raise exception 'CONFIG_BUDGET' using errcode='22023'; end if;
 while cardinality(pending)>0 loop
  v:=pending[cardinality(pending)]; pending:=pending[1:cardinality(pending)-1]; nodes:=nodes+1;
  if nodes>10000 then raise exception 'CONFIG_BUDGET' using errcode='22023'; end if;
  if jsonb_typeof(v)='string' then units:=units+lumin.utf16_length(v#>>'{}');
  elsif jsonb_typeof(v)='object' then
   for child in select key,value from jsonb_each(v) loop units:=units+lumin.utf16_length(child.key); pending:=array_append(pending,child.value); end loop;
  elsif jsonb_typeof(v)='array' then
   for child in select (ordinality-1)::text key,value from jsonb_array_elements(v) with ordinality loop units:=units+lumin.utf16_length(child.key); pending:=array_append(pending,child.value); end loop;
  end if;
  if units>65536 or nodes+cardinality(pending)>10000 then raise exception 'CONFIG_BUDGET' using errcode='22023'; end if;
 end loop;
end $$;
create function lumin.v2_catalog(p jsonb) returns void language plpgsql immutable set search_path=pg_catalog as $$
declare q jsonb;c jsonb;seen text[]:=array[]::text[];choices text[];
begin
 perform lumin.v2_budget(p);
 if jsonb_typeof(p)<>'object' or p-array['id','name','durationMinutes','questions']<>'{}' or jsonb_typeof(p->'id') is distinct from 'string'
 or p->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or not lumin.v2_text(p->'name',200) or not lumin.v2_quantity(p->'durationMinutes') then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 if (p->>'durationMinutes')::numeric::integer not between 5 and 1440 or jsonb_typeof(p->'questions') is distinct from 'array' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 if jsonb_array_length(p->'questions') not between 1 and 50 then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 for q in select value from jsonb_array_elements(p->'questions') loop
  if jsonb_typeof(q)<>'object' or q-array['id','prompt','kind','required','choices','minQty','maxQty']<>'{}'
  or not lumin.v2_text(q->'id',100,true) or not lumin.v2_text(q->'prompt',500) or jsonb_typeof(q->'required') is distinct from 'boolean'
  or q->>'kind' is null or q->>'kind' not in('single_choice','multi_choice','quantity') or jsonb_typeof(q->'choices') is distinct from 'array' or (q->>'id')=any(seen) then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  seen:=array_append(seen,q->>'id'); choices:=array[]::text[];
  if jsonb_array_length(q->'choices')>50 then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  for c in select value from jsonb_array_elements(q->'choices') loop
   if jsonb_typeof(c)<>'object' or c-array['id','label']<>'{}' or not lumin.v2_text(c->'id',100,true) or not lumin.v2_text(c->'label',200) or (c->>'id')=any(choices) then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
   choices:=array_append(choices,c->>'id');
  end loop;
  if q->>'kind'='quantity' then
   if cardinality(choices)<>0 or not lumin.v2_quantity(q->'minQty') or not lumin.v2_quantity(q->'maxQty') then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
   if (q->>'minQty')::numeric::integer>(q->>'maxQty')::numeric::integer then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  elsif cardinality(choices)=0 or q ? 'minQty' or q ? 'maxQty' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 end loop;
end $$;

create function lumin.normalize_configurable_publication(p_catalog jsonb,p_authoring jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare cfg jsonb;s jsonb;q jsonb;c jsonb;o jsonb;cond jsonb;source jsonb;source_q jsonb;k text;entry record;seen text[]:=array[]::text[];stepkeys text[]:=array[]::text[];effective jsonb:='[]';cs jsonb;lo integer;hi integer;
begin
 perform lumin.v2_catalog(p_catalog); perform lumin.v2_budget(p_authoring);
 if jsonb_typeof(p_authoring)<>'object' or p_authoring-array['authoringVersion','config','questionOverrides']<>'{}' or p_authoring->'authoringVersion' is distinct from '2'::jsonb or jsonb_typeof(p_authoring->'questionOverrides') is distinct from 'object' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 cfg:=p_authoring->'config';
 if jsonb_typeof(cfg) is distinct from 'object' or cfg-array['key','steps']<>'{}' or not lumin.v2_text(cfg->'key',200) or jsonb_typeof(cfg->'steps') is distinct from 'array' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 if jsonb_array_length(cfg->'steps') not between 1 and 50 then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 -- Validate all shapes before semantic errors, matching the pure parser.
 for s in select value from jsonb_array_elements(cfg->'steps') loop
  if jsonb_typeof(s)<>'object' or s-array['key','questionKey','kind','required','visibleWhen']<>'{}' or not lumin.v2_text(s->'key',100,true) or not lumin.v2_text(s->'questionKey',100,true) or s->>'kind' is distinct from 'question' or jsonb_typeof(s->'required') is distinct from 'boolean' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  if s ? 'visibleWhen' then
   cond:=s->'visibleWhen';
   if jsonb_typeof(cond)<>'object' or cond-array['field','op','value']<>'{}' or not lumin.v2_text(cond->'field',100,true) or not lumin.v2_text(cond->'value',100,true) or cond->>'op' is null or cond->>'op' not in('eq','includes') then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  end if;
 end loop;
 for entry in select key,value from jsonb_each(p_authoring->'questionOverrides') loop
  o:=entry.value;
  if not lumin.v2_text(to_jsonb(entry.key),100,true) or jsonb_typeof(o)<>'object' or o-array['prompt','choiceLabels','minQty','maxQty']<>'{}' or (o?'prompt' and not lumin.v2_text(o->'prompt',500)) or (o?'minQty' and not lumin.v2_quantity(o->'minQty')) or (o?'maxQty' and not lumin.v2_quantity(o->'maxQty')) then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  if o?'choiceLabels' then
   if jsonb_typeof(o->'choiceLabels')<>'object' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
   for k,c in select key,value from jsonb_each(o->'choiceLabels') loop if not lumin.v2_text(to_jsonb(k),100,true) or not lumin.v2_text(c,200) then raise exception 'INVALID_CONFIG' using errcode='22023'; end if; end loop;
  end if;
 end loop;
 for s in select value from jsonb_array_elements(cfg->'steps') loop
  if (s->>'key')=any(stepkeys) or (s->>'questionKey')=any(seen) or not exists(select 1 from jsonb_array_elements(p_catalog->'questions') e where e->>'id'=s->>'questionKey') then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
  stepkeys:=array_append(stepkeys,s->>'key');seen:=array_append(seen,s->>'questionKey');
 end loop;
 for q in select value from jsonb_array_elements(p_catalog->'questions') where value->'required'='true'::jsonb loop
  select value into s from jsonb_array_elements(cfg->'steps') where value->>'questionKey'=q->>'id';
  if not found or s->'required'<>'true'::jsonb or s?'visibleWhen' then raise exception 'REQUIRED_FLOOR' using errcode='22023'; end if;
 end loop;
 for k in select jsonb_object_keys(p_authoring->'questionOverrides') loop if not k=any(seen) then raise exception 'INVALID_OVERRIDE' using errcode='22023'; end if; end loop;
 seen:=array[]::text[];
 for s in select value from jsonb_array_elements(cfg->'steps') loop
  if s?'visibleWhen' then
   cond:=s->'visibleWhen';
   select value into source from jsonb_array_elements(cfg->'steps') where value->>'questionKey'=cond->>'field';
   select value into source_q from jsonb_array_elements(p_catalog->'questions') where value->>'id'=cond->>'field';
   if not (cond->>'field')=any(seen) or source?'visibleWhen' or source_q->>'kind' is distinct from (case when cond->>'op'='eq' then 'single_choice' else 'multi_choice' end) or not exists(select 1 from jsonb_array_elements(source_q->'choices') e where e->'id'=cond->'value') then raise exception 'INVALID_DEPENDENCY' using errcode='22023'; end if;
  end if;
  seen:=array_append(seen,s->>'questionKey');
 end loop;
 for s in select value from jsonb_array_elements(cfg->'steps') loop
  select value into q from jsonb_array_elements(p_catalog->'questions') where value->>'id'=s->>'questionKey';
  o:=coalesce(p_authoring->'questionOverrides'->(q->>'id'),'{}'::jsonb);
  if o?'choiceLabels' then
   for k in select jsonb_object_keys(o->'choiceLabels') loop if not exists(select 1 from jsonb_array_elements(q->'choices') e where e->>'id'=k) then raise exception 'INVALID_OVERRIDE' using errcode='22023'; end if; end loop;
  end if;
  if (q->>'kind'<>'quantity' and (o?'minQty' or o?'maxQty')) or (q->>'kind'='quantity' and o?'choiceLabels') then raise exception 'INVALID_OVERRIDE' using errcode='22023'; end if;
  if q->>'kind'='quantity' then
   lo:=coalesce((o->>'minQty')::numeric::integer,(q->>'minQty')::numeric::integer);hi:=coalesce((o->>'maxQty')::numeric::integer,(q->>'maxQty')::numeric::integer);
   if lo<(q->>'minQty')::numeric::integer or hi>(q->>'maxQty')::numeric::integer or lo>hi then raise exception 'INVALID_OVERRIDE' using errcode='22023'; end if;
   q:=q||jsonb_build_object('minQty',lo,'maxQty',hi);
  end if;
  cs:='[]';for c in select value from jsonb_array_elements(q->'choices') loop cs:=cs||jsonb_build_array(c||jsonb_build_object('label',coalesce(o->'choiceLabels'->(c->>'id'),c->'label'))); end loop;
  q:=q||jsonb_build_object('prompt',coalesce(o->'prompt',q->'prompt'),'choices',cs);effective:=effective||jsonb_build_array(q);
 end loop;
 return jsonb_build_object('authoring',p_authoring,'snapshot',jsonb_build_object('renderSchemaVersion',2,'config',cfg,'service',p_catalog||jsonb_build_object('questions',effective),'submissionMode','unconfirmed_request'));
end $$;

create function lumin.validate_configurable_answers(p_snapshot jsonb,p_answers jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare snap jsonb;s jsonb;q jsonb;a jsonb;c jsonb;k text;cond jsonb;visible boolean;accepted jsonb:='{}';chosen jsonb;
begin
 perform lumin.v2_budget(p_snapshot);
 if jsonb_typeof(p_snapshot)<>'object' or p_snapshot-array['renderSchemaVersion','config','service','submissionMode']<>'{}' or p_snapshot->'renderSchemaVersion' is distinct from '2'::jsonb or p_snapshot->>'submissionMode' is distinct from 'unconfirmed_request' then raise exception 'INVALID_CONFIG' using errcode='22023'; end if;
 snap:=lumin.normalize_configurable_publication(p_snapshot->'service',jsonb_build_object('authoringVersion',2,'config',p_snapshot->'config','questionOverrides','{}'::jsonb))->'snapshot';
 begin perform lumin.v2_budget(p_answers); exception when others then raise exception 'INVALID_ANSWER' using errcode='22023'; end;
 if jsonb_typeof(p_answers)<>'object' then raise exception 'INVALID_ANSWER' using errcode='22023'; end if;
 for k,a in select key,value from jsonb_each(p_answers) loop
  if not lumin.v2_text(to_jsonb(k),100,true) or jsonb_typeof(a)<>'object' or not exists(select 1 from jsonb_array_elements(snap->'config'->'steps') e where e->>'questionKey'=k) then raise exception 'INVALID_ANSWER' using errcode='22023'; end if;
  if a?'quantity' then
   if a-array['quantity']<>'{}' or not lumin.v2_quantity(a->'quantity') then raise exception 'INVALID_ANSWER' using errcode='22023'; end if;
  else
   if a-array['choiceIds']<>'{}' or jsonb_typeof(a->'choiceIds') is distinct from 'array' then raise exception 'INVALID_ANSWER' using errcode='22023'; end if;
   if jsonb_array_length(a->'choiceIds') not between 1 and 50 then raise exception 'INVALID_ANSWER' using errcode='22023'; end if;
   for c in select value from jsonb_array_elements(a->'choiceIds') loop if not lumin.v2_text(c,100,true) then raise exception 'INVALID_ANSWER' using errcode='22023'; end if; end loop;
  end if;
 end loop;
 for s in select value from jsonb_array_elements(snap->'config'->'steps') loop
  select value into q from jsonb_array_elements(snap->'service'->'questions') where value->>'id'=s->>'questionKey';a:=p_answers->(q->>'id');visible:=true;
  if s?'visibleWhen' then cond:=s->'visibleWhen';visible:=coalesce((accepted->(cond->>'field')->'choiceIds') @> jsonb_build_array(cond->'value'),false);end if;
  if not visible then if a is not null then raise exception 'HIDDEN_ANSWER' using errcode='22023';end if;continue;end if;
  if a is null then if s->'required'='true'::jsonb then raise exception 'MISSING_REQUIRED' using errcode='22023';end if;continue;end if;
  if q->>'kind'='quantity' then
   if not a?'quantity' or (a->>'quantity')::numeric<(q->>'minQty')::numeric or (a->>'quantity')::numeric>(q->>'maxQty')::numeric then raise exception 'INVALID_ANSWER' using errcode='22023';end if;
   accepted:=accepted||jsonb_build_object(q->>'id',a);
  else
   if not a?'choiceIds' then raise exception 'INVALID_ANSWER' using errcode='22023';end if;
   if (q->>'kind'='single_choice' and jsonb_array_length(a->'choiceIds')<>1) or (select count(distinct value) from jsonb_array_elements(a->'choiceIds'))<>jsonb_array_length(a->'choiceIds') then raise exception 'INVALID_ANSWER' using errcode='22023';end if;
   for c in select value from jsonb_array_elements(a->'choiceIds') loop if not exists(select 1 from jsonb_array_elements(q->'choices') e where e->'id'=c) then raise exception 'INVALID_ANSWER' using errcode='22023';end if;end loop;
   select coalesce(jsonb_agg(e.value->'id' order by e.ordinality),'[]') into chosen from jsonb_array_elements(q->'choices') with ordinality e where a->'choiceIds' @> jsonb_build_array(e.value->'id');
   accepted:=accepted||jsonb_build_object(q->>'id',jsonb_build_object('choiceIds',chosen));
  end if;
 end loop;
 return accepted;
end $$;

-- All V1 mutation entries check the marker while holding the shared flow lock.
create function lumin.require_v1_draft(p_tenant uuid,p_flow uuid) returns void language plpgsql set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow and authoring_version<>1) then raise exception 'CONFIGURABLE_NAMESPACE_REQUIRED' using errcode='0A000';end if;
end $$;


create or replace function public.save_flow_draft(p_tenant_id uuid,p_flow_id uuid,p_name text,p_expected_revision bigint,p_config jsonb)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v_revision bigint;
begin
 if not lumin.tenant_is_active(p_tenant_id) then raise exception 'FLOW_TENANT_INACTIVE' using errcode='42501'; end if;
 if lumin.tenant_role(p_tenant_id) is distinct from 'BUSINESS_OWNER' then raise exception 'FLOW_OWNER_REQUIRED' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then raise exception 'FLOW_REVISION_INVALID' using errcode='22023'; end if;
 if p_expected_revision=0 then
  insert into public.flows(id,tenant_id,name) values(p_flow_id,p_tenant_id,p_name);
  insert into public.flow_drafts(tenant_id,flow_id,revision,config) values(p_tenant_id,p_flow_id,1,p_config);
  return 1;
 end if;
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_NOT_EDITABLE' using errcode='40001'; end if;
 perform lumin.require_v1_draft(p_tenant_id,p_flow_id);
 update public.flow_drafts set revision=revision+1,config=p_config
 where tenant_id=p_tenant_id and flow_id=p_flow_id and revision=p_expected_revision returning revision into v_revision;
 if not found then raise exception 'FLOW_REVISION_CONFLICT' using errcode='40001'; end if;
 update public.flows set name=p_name where tenant_id=p_tenant_id and id=p_flow_id;
 return v_revision;
end $$;

create or replace function public.publish_flow_version(p_tenant_id uuid,p_flow_id uuid,p_expected_revision bigint,p_version_id uuid,p_installation_id uuid,p_config jsonb,p_allowed_origins jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare d public.flow_drafts;
begin
 if not lumin.tenant_is_active(p_tenant_id) then raise exception 'FLOW_TENANT_INACTIVE' using errcode='42501'; end if;
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_NOT_PUBLISHABLE' using errcode='40001'; end if;
 perform lumin.require_v1_draft(p_tenant_id,p_flow_id);
 select * into d from public.flow_drafts where tenant_id=p_tenant_id and flow_id=p_flow_id;
 if d.revision is distinct from p_expected_revision or d.config is distinct from p_config then raise exception 'FLOW_REVISION_CONFLICT' using errcode='40001'; end if;
 if not lumin.flow_origins_storage_valid(p_allowed_origins) then raise exception 'FLOW_ORIGIN_INVALID' using errcode='22023'; end if;
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config)
 values(p_version_id,p_tenant_id,p_flow_id,d.revision,'unconfirmed_request',p_config);
 insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins)
 values(p_installation_id,p_tenant_id,p_flow_id,p_version_id,p_allowed_origins);
 update public.flows set published_version_id=p_version_id,status='active' where tenant_id=p_tenant_id and id=p_flow_id;
 return p_version_id;
end $$;

create or replace function public.save_bound_flow_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_service_id uuid,p_expected_revision bigint,p_name text,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare render jsonb; revision bigint;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 if p_expected_revision>0 then
  perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 perform lumin.require_v1_draft(p_tenant_id,p_flow_id);
 end if;
 render:=lumin.flow_service_render(p_tenant_id,p_service_id); perform lumin.bound_flow_config(p_config,render);
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then raise exception 'INVALID_REVISION' using errcode='22023'; end if;
 if p_expected_revision=0 then
  insert into public.flows(id,tenant_id,name) values(p_flow_id,p_tenant_id,p_name);
  insert into public.flow_drafts(tenant_id,flow_id,revision,config) values(p_tenant_id,p_flow_id,1,p_config); revision:=1;
 else
  perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 perform lumin.require_v1_draft(p_tenant_id,p_flow_id);
  update public.flow_drafts set revision=flow_drafts.revision+1,config=p_config where tenant_id=p_tenant_id and flow_id=p_flow_id and flow_drafts.revision=p_expected_revision returning flow_drafts.revision into revision;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 perform lumin.require_v1_draft(p_tenant_id,p_flow_id);
  update public.flows set name=p_name where tenant_id=p_tenant_id and id=p_flow_id;
 end if;
 insert into public.bound_flow_services values(p_tenant_id,p_flow_id,p_service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 return jsonb_build_object('flowId',p_flow_id,'revision',revision);
end $$;

create or replace function public.publish_bound_flow(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_expected_revision bigint,p_version_id uuid,p_installation_id uuid,p_allowed_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare service uuid; render jsonb; d public.flow_drafts;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 -- Serialize with bound/unbound draft edits before reading binding and config.
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_CONFLICT' using errcode='40001'; end if;
 perform lumin.require_v1_draft(p_tenant_id,p_flow_id);
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

create or replace function public.flow_owner_list(p_actor_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 select coalesce(jsonb_agg(x.dto order by x.id),'[]') into result from (
 select f.id,jsonb_build_object('flowId',f.id,'name',f.name,'status',f.status,'revision',d.revision,'serviceId',b.service_id,'publishedVersionId',f.published_version_id) dto
 from public.flows f join public.flow_drafts d on d.tenant_id=f.tenant_id and d.flow_id=f.id
 left join public.bound_flow_services b on b.tenant_id=f.tenant_id and b.flow_id=f.id where f.tenant_id=p_tenant_id and d.authoring_version=1 order by f.id limit 100) x;
 return jsonb_build_object('flows',result);
end $$;

create function public.flow_owner_configurable_list(p_actor_id uuid,p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 select coalesce(jsonb_agg(x.dto order by x.id),'[]') into result from (
 select f.id,jsonb_build_object('flowId',f.id,'name',f.name,'status',f.status,'revision',d.revision,'serviceId',b.service_id,'publishedVersionId',f.published_version_id) dto
 from public.flows f join public.flow_drafts d on d.tenant_id=f.tenant_id and d.flow_id=f.id
 left join public.bound_flow_services b on b.tenant_id=f.tenant_id and b.flow_id=f.id where f.tenant_id=p_tenant_id and d.authoring_version=2 order by f.id limit 100) x;
 return jsonb_build_object('flows',result);
end $$;

create or replace function public.flow_owner_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; service uuid;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,false);
 select jsonb_build_object('flowId',f.id,'name',f.name,'revision',d.revision,'serviceId',b.service_id,'config',d.config),b.service_id into result,service
 from public.flows f join public.flow_drafts d on d.tenant_id=f.tenant_id and d.flow_id=f.id
 join public.bound_flow_services b on b.tenant_id=f.tenant_id and b.flow_id=f.id where f.tenant_id=p_tenant_id and f.id=p_flow_id and d.authoring_version=1;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002'; end if;
 return result||jsonb_build_object('service',lumin.flow_service_render(p_tenant_id,service));
end $$;

create or replace function public.issue_flow_session(p_installation_id uuid,p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.flow_installations; v public.bound_flow_versions; config jsonb; expiry timestamptz; stored_version public.flow_versions; render jsonb;
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
 select fv.* into stored_version from public.flow_versions fv where fv.tenant_id=i.tenant_id and fv.flow_id=i.flow_id and fv.id=i.version_id;
 if stored_version.render_schema_version=2 then
  render:=stored_version.configurable_snapshot||jsonb_build_object('versionId',i.version_id);
 else render:=jsonb_build_object('versionId',i.version_id,'config',stored_version.config,'service',v.service_snapshot);end if;
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into public.flow_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,origin,expires_at)
 values(p_token_hash,i.tenant_id,i.flow_id,i.version_id,i.id,v.service_id,p_origin,expiry);
 return jsonb_build_object('expiresAt',expiry,'render',render);
end $$;

create or replace function public.submit_flow_request(p_token_hash text,p_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare sess public.flow_sessions; snapshot jsonb; old public.flow_requests; hash text; customer uuid; booking uuid; ref text; v_name text; v_email text; result jsonb; stored_version public.flow_versions; accepted_answers jsonb;
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
 select * into stored_version from public.flow_versions where tenant_id=sess.tenant_id and flow_id=sess.flow_id and id=sess.version_id;
 if stored_version.render_schema_version=2 then accepted_answers:=lumin.validate_configurable_answers(stored_version.configurable_snapshot,p_answers);
 else
  if not lumin.flow_answers_valid(p_answers,snapshot) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  accepted_answers:=p_answers;
 end if;
 if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128
 or p_customer is null or jsonb_typeof(p_customer)<>'object' or p_customer-array['name','email']<>'{}'
 or jsonb_typeof(p_customer->'name') is distinct from 'string' or jsonb_typeof(p_customer->'email') is distinct from 'string'
 or p_requested_start is null or not isfinite(p_requested_start) then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 v_name:=btrim(p_customer->>'name'); v_email:=btrim(p_customer->>'email');
 if length(v_name) not between 1 and 200 or length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_CUSTOMER' using errcode='22023'; end if;
 -- UTC-independent timestamp epoch and normalized customer yield stable retry hash.
 hash:=encode(sha256(convert_to(jsonb_build_object('answers',accepted_answers,'customer',jsonb_build_object('name',v_name,'email',v_email),'requestedEpoch',extract(epoch from p_requested_start))::text,'UTF8')),'hex');
 select * into old from public.flow_requests where session_id=sess.id;
 if found then
  if old.idempotency_key<>p_idempotency_key or old.request_hash<>hash then raise exception 'REQUEST_CONFLICT' using errcode='40001'; end if;
  select reference into ref from public.bookings where tenant_id=sess.tenant_id and id=old.booking_id;
  if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('reference',ref,'state','draft','confirmed',false);
 end if;
 if p_requested_start<=clock_timestamp() then raise exception 'INVALID_TIME' using errcode='22023'; end if;
 -- Do not overwrite a known customer's identity from a public request.
 insert into public.customers(tenant_id,name,email) values(sess.tenant_id,v_name,v_email) on conflict(tenant_id,email) do nothing returning id into customer;
 if customer is null then select id into customer from public.customers where tenant_id=sess.tenant_id and customers.email=v_email; end if;
 booking:=gen_random_uuid(); ref:='LMN-'||upper(replace(booking::text,'-',''));
 insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key)
 values(booking,sess.tenant_id,ref,'draft',jsonb_build_object('serviceId',sess.service_id,'answers',accepted_answers),'{}',p_requested_start,p_requested_start+make_interval(mins=>(snapshot->>'durationMinutes')::integer),customer,'flow-session:'||sess.id::text);
 insert into public.flow_requests values(sess.tenant_id,sess.id,booking,p_idempotency_key,hash);
 perform public.outbox_enqueue(sess.tenant_id,booking,'booking.requested',sess.id);
 if sess.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('reference',ref,'state','draft','confirmed',false);
end $$;

create function public.save_configurable_flow_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_service_id uuid,p_expected_revision bigint,p_name text,p_authoring jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare normalized jsonb; rev bigint;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then raise exception 'INVALID_REVISION' using errcode='22023';end if;
 if p_expected_revision>0 then
  perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001';end if;
 end if;
 normalized:=lumin.normalize_configurable_publication(lumin.flow_service_render(p_tenant_id,p_service_id),p_authoring);
 if p_expected_revision=0 then
  insert into public.flows(id,tenant_id,name) values(p_flow_id,p_tenant_id,p_name);
  insert into public.flow_drafts(tenant_id,flow_id,revision,config,authoring_version,authoring) values(p_tenant_id,p_flow_id,1,normalized->'authoring'->'config',2,normalized->'authoring');rev:=1;
 else
  update public.flow_drafts set revision=revision+1,config=normalized->'authoring'->'config',authoring_version=2,authoring=normalized->'authoring' where tenant_id=p_tenant_id and flow_id=p_flow_id and revision=p_expected_revision returning revision into rev;
  if not found then raise exception 'FLOW_CONFLICT' using errcode='40001';end if;
  update public.flows set name=p_name where tenant_id=p_tenant_id and id=p_flow_id;
 end if;
 insert into public.bound_flow_services values(p_tenant_id,p_flow_id,p_service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 return jsonb_build_object('flowId',p_flow_id,'revision',rev,'authoringVersion',2);
end $$;
create function public.get_configurable_flow_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.flow_drafts; s uuid; n text; normalized jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 select name into n from public.flows where tenant_id=p_tenant_id and id=p_flow_id for share;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002';end if;
 select * into d from public.flow_drafts where tenant_id=p_tenant_id and flow_id=p_flow_id and authoring_version=2;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002';end if;
 select service_id into s from public.bound_flow_services where tenant_id=p_tenant_id and flow_id=p_flow_id;
 if not found then raise exception 'FLOW_UNBOUND' using errcode='P0002';end if;
 normalized:=lumin.normalize_configurable_publication(lumin.flow_service_render(p_tenant_id,s),d.authoring);
 return jsonb_build_object('flowId',p_flow_id,'revision',d.revision,'serviceId',s,'name',n,'authoring',d.authoring,'effectiveService',normalized->'snapshot'->'service');
end $$;
create function public.publish_configurable_flow(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_expected_revision bigint,p_version_id uuid,p_installation_id uuid,p_allowed_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.flow_drafts;s uuid;normalized jsonb;snap jsonb;
begin
 perform lumin.flow_actor(p_actor_id,p_tenant_id,true);
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_CONFLICT' using errcode='40001';end if;
 select * into d from public.flow_drafts where tenant_id=p_tenant_id and flow_id=p_flow_id and authoring_version=2;
 if not found then raise exception 'FLOW_UNAVAILABLE' using errcode='P0002';end if;
 if d.revision is distinct from p_expected_revision then raise exception 'FLOW_CONFLICT' using errcode='40001';end if;
 select service_id into s from public.bound_flow_services where tenant_id=p_tenant_id and flow_id=p_flow_id;
 if not found then raise exception 'FLOW_UNBOUND' using errcode='P0002';end if;
 normalized:=lumin.normalize_configurable_publication(lumin.flow_service_render(p_tenant_id,s),d.authoring);snap:=normalized->'snapshot';
 if not lumin.flow_origins_storage_valid(p_allowed_origins) then raise exception 'FLOW_ORIGIN_INVALID' using errcode='22023';end if;
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,configurable_snapshot) values(p_version_id,p_tenant_id,p_flow_id,d.revision,'unconfirmed_request',snap->'config',2,snap);
 insert into public.bound_flow_versions(tenant_id,flow_id,version_id,service_id,service_snapshot) values(p_tenant_id,p_flow_id,p_version_id,s,snap->'service');
 insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation_id,p_tenant_id,p_flow_id,p_version_id,p_allowed_origins);
 update public.flows set published_version_id=p_version_id,status='active' where tenant_id=p_tenant_id and id=p_flow_id;
 return jsonb_build_object('versionId',p_version_id,'installationId',p_installation_id,'renderSchemaVersion',2);
end $$;
revoke all on function lumin.utf16_length(text),lumin.v2_text(jsonb,integer,boolean),lumin.v2_quantity(jsonb),lumin.v2_budget(jsonb),lumin.v2_catalog(jsonb),lumin.normalize_configurable_publication(jsonb,jsonb),lumin.validate_configurable_answers(jsonb,jsonb),lumin.require_v1_draft(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.flow_owner_configurable_list(uuid,uuid),public.save_configurable_flow_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb),public.get_configurable_flow_draft(uuid,uuid,uuid),public.publish_configurable_flow(uuid,uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.flow_owner_configurable_list(uuid,uuid),public.save_configurable_flow_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb),public.get_configurable_flow_draft(uuid,uuid,uuid),public.publish_configurable_flow(uuid,uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;
commit;
