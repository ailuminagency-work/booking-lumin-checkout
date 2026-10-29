-- Explicit conditional informational drafts and V6 sessions. No new financial authority.
begin;
create function lumin.conditional_customer_fields_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb;source jsonb;earlier jsonb:='{}';plain jsonb:='[]';condition jsonb;value text;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>10 or octet_length(p::text)>32768 then return false;end if;
 for f in select e.value from jsonb_array_elements(p) e loop
  if jsonb_typeof(f)<>'object' or substring(f->>'id' from 8) in('amount','pricing','currency','discount','deposit','payment_id','booking_id','user_id','actor','actor_id','provider_state','payment_state') then return false;end if;
  plain:=plain||jsonb_build_array(f-'when');
  if f ? 'when' then
   condition:=f->'when';
   if jsonb_typeof(condition) is distinct from 'object' or (select count(*) from jsonb_object_keys(condition))<>2 or not(condition ?& array['fieldId','equals'])
    or jsonb_typeof(condition->'fieldId') is distinct from 'string' or jsonb_typeof(condition->'equals') is distinct from 'string' then return false;end if;
   source:=earlier->(condition->>'fieldId');value:=condition->>'equals';
   if source is null or lumin.utf16_length(value)>(source->>'maxLength')::numeric or value ~ U&'[\0001-\001f\007f-\009f]'
    or length(btrim(value,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))=0 then return false;end if;
  end if;
  if not lumin.customer_draft_fields_valid(plain) then return false;end if;
  earlier:=earlier||jsonb_build_object(f->>'id',f);
 end loop;
 return true;
end $$;
create function lumin.conditional_customer_field_answers(p_fields jsonb,p_answers jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb;key text;shown boolean;visible text[]:=array[]::text[];
begin
 if not lumin.conditional_customer_fields_valid(p_fields) or p_answers is null or jsonb_typeof(p_answers)<>'object' or (select count(*) from jsonb_object_keys(p_answers))>10 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_answers) keys(id) where not exists(select 1 from jsonb_array_elements(p_fields) fields(definition) where fields.definition->>'id'=keys.id)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 for f in select value from jsonb_array_elements(p_fields) loop
  key:=f->>'id';shown:=not(f ? 'when') or ((f#>>'{when,fieldId}')=any(visible) and p_answers ? (f#>>'{when,fieldId}') and p_answers->(f#>>'{when,fieldId}')=f#>'{when,equals}');
  if not shown then if p_answers ? key then raise exception 'INVALID_REQUEST' using errcode='22023';end if;continue;end if;
  visible:=array_append(visible,key);
  perform lumin.customer_field_answers(jsonb_build_array(f-'when'),case when p_answers ? key then jsonb_build_object(key,p_answers->key) else '{}'::jsonb end);
 end loop;
 return p_answers;
end $$;
create function lumin.conditional_customer_field_snapshot_valid(p jsonb,p_revision bigint) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare plain jsonb;
begin
 if p is null or p->'renderSchemaVersion' is distinct from '6'::jsonb or p->>'submissionMode' is distinct from 'paid_conditional_customer_field_request' or not lumin.conditional_customer_fields_valid(p->'customerFields') then return false;end if;
 select coalesce(jsonb_agg(e.value-'when' order by e.ordinality),'[]') into plain from jsonb_array_elements(p->'customerFields') with ordinality e;
 return lumin.customer_field_snapshot_valid(p||jsonb_build_object('renderSchemaVersion',5,'submissionMode','paid_customer_field_request','customerFields',plain),p_revision);
end $$;
revoke all on function lumin.conditional_customer_fields_valid(jsonb),lumin.conditional_customer_field_answers(jsonb,jsonb),lumin.conditional_customer_field_snapshot_valid(jsonb,bigint) from public,anon,authenticated,service_role;
alter table public.paid_simple_drafts drop constraint paid_customer_draft_shape;
alter table public.paid_simple_drafts add constraint paid_customer_draft_shape check((draft_schema_version=1 and customer_fields='[]') or(draft_schema_version=2 and lumin.customer_draft_fields_valid(customer_fields)) or(draft_schema_version=3 and lumin.conditional_customer_fields_valid(customer_fields)));
create or replace function lumin.reject_customer_draft_downgrade() returns trigger language plpgsql set search_path=pg_catalog as $$begin if new.draft_schema_version<old.draft_schema_version then raise exception 'DRAFT_DOWNGRADE_FORBIDDEN' using errcode='55000';end if;return new;end$$;

create or replace function public.save_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_accent_color text,p_layout text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare schema integer;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or p_name is null or length(btrim(p_name)) not between 1 and 200
  or p_accent_color is null or p_accent_color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p_layout is null or p_layout not in('stacked','compact') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.paid_simple_service(p_tenant,p_service);
 select draft_schema_version into schema from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for update;
 if schema>=2 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return public.save_paid_simple_draft_v1(p_actor,p_tenant,p_flow,p_service,p_expected_revision,p_name,p_accent_color,p_layout);
end $$;

create or replace function public.publish_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;service uuid;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_version is null or p_installation is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991 or not lumin.flow_origins_storage_valid(p_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select service_id into service from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_simple_service(p_tenant,service);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for update;
 if not found or d.service_id<>service or d.revision is distinct from p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Locked exact saved representation has no customer renderer yet. Fail before
 -- any legacy publication/version/installation writer is invoked, even if empty.
 if d.draft_schema_version>=2 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return public.publish_paid_simple_draft_v1(p_actor,p_tenant,p_flow,p_expected_revision,p_version,p_installation,p_origins);
end $$;

create or replace function public.save_paid_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_accent_color text,p_layout text,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare next_revision bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or p_name is null or length(btrim(p_name)) not between 1 and 200
  or p_accent_color is null or p_accent_color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p_layout is null or p_layout not in('stacked','compact') or not lumin.customer_draft_fields_valid(p_fields) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Existing catalog-before-draft ordering and sole price eligibility authority.
 perform lumin.paid_simple_service(p_tenant,p_service);
 perform 1 from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow and draft_schema_version=3 for update;
 if found then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 if p_expected_revision=0 then
  insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout,draft_schema_version,customer_fields) values(p_flow,p_tenant,p_service,1,btrim(p_name),p_accent_color,p_layout,2,p_fields);next_revision:=1;
 else
  update public.paid_simple_drafts set service_id=p_service,revision=revision+1,name=btrim(p_name),accent_color=p_accent_color,layout=p_layout,draft_schema_version=2,customer_fields=p_fields
   where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',2,'flowId',p_flow,'revision',next_revision);
end $$;

create function public.save_paid_conditional_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_accent_color text,p_layout text,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare next_revision bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or p_name is null or length(btrim(p_name)) not between 1 and 200
  or p_accent_color is null or p_accent_color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p_layout is null or p_layout not in('stacked','compact') or not lumin.conditional_customer_fields_valid(p_fields) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Existing catalog-before-draft ordering and sole price eligibility authority.
 perform lumin.paid_simple_service(p_tenant,p_service);
 if p_expected_revision=0 then
  insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout,draft_schema_version,customer_fields) values(p_flow,p_tenant,p_service,1,btrim(p_name),p_accent_color,p_layout,3,p_fields);next_revision:=1;
 else
  update public.paid_simple_drafts set service_id=p_service,revision=revision+1,name=btrim(p_name),accent_color=p_accent_color,layout=p_layout,draft_schema_version=3,customer_fields=p_fields
   where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',3,'flowId',p_flow,'revision',next_revision);
end $$;

create or replace function public.get_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;service uuid;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select service_id into service from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_simple_service(p_tenant,service);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or d.service_id<>service then raise exception 'CONFLICT' using errcode='40001';end if;
 if d.draft_schema_version=1 then return public.get_paid_simple_draft_v1(p_actor,p_tenant,p_flow);end if;
 return jsonb_build_object('schemaVersion',d.draft_schema_version,'flowId',d.flow_id,'revision',d.revision,'serviceId',d.service_id,'name',d.name,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout),'customerFields',d.customer_fields);
end $$;

create or replace function public.owner_paid_simple_drafts(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;bounded public.paid_simple_drafts[];drafts jsonb:='[]'::jsonb;entry jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select array_agg(entries.row order by (entries.row).flow_id) into bounded from(select row from public.paid_simple_drafts row where tenant_id=p_tenant order by flow_id limit 51)entries;
 if cardinality(bounded)>50 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 foreach d in array coalesce(bounded,array[]::public.paid_simple_drafts[]) loop
  perform lumin.paid_simple_service(p_tenant,d.service_id);
  entry:=jsonb_build_object('flowId',d.flow_id,'name',d.name,'revision',d.revision,'serviceId',d.service_id,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout));
  if d.draft_schema_version in(2,3) then entry:=entry||jsonb_build_object('schemaVersion',d.draft_schema_version,'customerFields',d.customer_fields);end if;
  drafts:=drafts||jsonb_build_array(entry);
 end loop;
 return jsonb_build_object('drafts',drafts);
end $$;

alter table public.flow_versions drop constraint flow_versions_render_schema_version_check;
alter table public.flow_versions add constraint flow_versions_render_schema_version_check check(render_schema_version in(1,2,3,4,5,6));
alter table public.flow_versions drop constraint flow_version_render_shape;
alter table public.flow_versions add constraint flow_version_render_shape check(
 ((render_schema_version=1 and configurable_snapshot is null and paid_snapshot is null)
 or(render_schema_version=2 and configurable_snapshot is not null and paid_snapshot is null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config)
 or(render_schema_version in(3,4) and configurable_snapshot is null and paid_snapshot is not null and jsonb_typeof(paid_snapshot)='object' and paid_snapshot->'renderSchemaVersion'=to_jsonb(render_schema_version) and paid_snapshot->>'submissionMode'=case when render_schema_version=3 then 'paid_service_request' else 'paid_option_request' end)
 or(render_schema_version=5 and configurable_snapshot is null and lumin.customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=6 and configurable_snapshot is null and lumin.conditional_customer_field_snapshot_valid(paid_snapshot,source_revision))) is true);


create function lumin.conditional_customer_field_version_service(p_tenant uuid,p_flow uuid,p_version uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v public.flow_versions;b public.bound_flow_versions;service jsonb;cfg jsonb;
begin
 select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_version;
 if not found or v.render_schema_version<>6 or not lumin.conditional_customer_field_snapshot_valid(v.paid_snapshot,v.source_revision) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=p_version;
 if not found then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 service:=lumin.paid_simple_service(p_tenant,b.service_id);
 cfg:=jsonb_build_object('key','paid_conditional_customer_field','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 if b.service_snapshot is distinct from service or v.paid_snapshot->'service' is distinct from service or v.config is distinct from cfg then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return service;
end $$;

create function public.publish_paid_conditional_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts; service jsonb; snapshot jsonb; cfg jsonb; f public.flows; v public.flow_versions; b public.bound_flow_versions; i public.flow_installations; installation_count integer;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_version is null or p_installation is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
 or not lumin.flow_origins_storage_valid(p_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if d.revision<>p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Keep catalog-before-draft locking aligned with save, then recheck exact revision.
 service:=lumin.paid_simple_service(p_tenant,d.service_id);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision for update;
 if not found or d.service_id::text is distinct from service->>'id' then raise exception 'CONFLICT' using errcode='40001';end if;
 if d.draft_schema_version<>3 or not lumin.conditional_customer_fields_valid(d.customer_fields) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
snapshot:=jsonb_build_object('renderSchemaVersion',6,'submissionMode','paid_conditional_customer_field_request','paymentMode','staging_mock','simulated',true,'service',service,'customerFields',d.customer_fields,
  'publication',jsonb_build_object('name',d.name,'draftRevision',d.revision,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout)));
 if not lumin.conditional_customer_field_snapshot_valid(snapshot,d.revision) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 cfg:=jsonb_build_object('key','paid_conditional_customer_field','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 select * into f from public.flows where id=p_flow for update;
 if found then
  if f.tenant_id<>p_tenant or f.status='archived' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id;
  if not found or v.render_schema_version not in(3,5,6) then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision=p_expected_revision for update;
  if found then
   if f.status<>'active' or f.published_version_id<>v.id or v.render_schema_version<>6 or v.paid_snapshot is distinct from snapshot or v.config is distinct from cfg then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or b.service_id<>d.service_id or b.service_snapshot is distinct from service then raise exception 'CONFLICT' using errcode='40001';end if;
   select count(*) into installation_count from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if installation_count<>1 then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into i from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id for share;
   if i.allowed_origins is distinct from p_origins then raise exception 'CONFLICT' using errcode='40001';end if;
   return jsonb_build_object('flowId',p_flow,'draftRevision',d.revision,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',6,'replayed',true);
  end if;
  if exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision>=p_expected_revision) then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  insert into public.flows(id,tenant_id,name,status) values(p_flow,p_tenant,d.name,'active');
 end if;
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,paid_snapshot)
 values(p_version,p_tenant,p_flow,d.revision,'unconfirmed_request',cfg,6,snapshot);
 insert into public.bound_flow_services values(p_tenant,p_flow,d.service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 insert into public.bound_flow_versions values(p_tenant,p_flow,p_version,d.service_id,service);
 insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation,p_tenant,p_flow,p_version,p_origins);
 update public.flows set name=d.name,status='active',published_version_id=p_version where tenant_id=p_tenant and id=p_flow;
 return jsonb_build_object('flowId',p_flow,'draftRevision',d.revision,'versionId',p_version,'installationId',p_installation,'renderSchemaVersion',6,'replayed',false);
end $$;

alter function public.customer_flow_availability_scope(text,text) rename to customer_flow_availability_scope_v12345;
revoke all on function public.customer_flow_availability_scope_v12345(text,text) from public,anon,authenticated,service_role;

create function public.customer_flow_availability_scope(p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;s public.flow_sessions;v public.flow_versions;r public.flow_requests;b public.bookings;service jsonb;
begin
 -- The accepted primitive proves active tenant/flow, exact origin/installation,
 -- session expiry and absence of planning/resource authority.
 result:=public.customer_flow_availability_scope_v12(p_token_hash,p_origin);
 select * into s from public.flow_sessions where token_hash=p_token_hash;
 select * into v from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 if v.render_schema_version is distinct from 6 then return public.customer_flow_availability_scope_v12345(p_token_hash,p_origin);end if;
 service:=lumin.conditional_customer_field_version_service(s.tenant_id,s.flow_id,s.version_id);
 if service->>'id' is distinct from s.service_id::text then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select * into r from public.flow_requests where tenant_id=s.tenant_id and session_id=s.id for share;
 if found then
  select * into b from public.bookings where tenant_id=r.tenant_id and id=r.booking_id;
  if not found or b.selection is distinct from jsonb_build_object('serviceId',s.service_id)
   or b.idempotency_key is distinct from 'flow-session:'||s.id::text or b.slot_end is distinct from b.slot_start+make_interval(mins=>(service->>'durationMinutes')::integer)
   or r.option_answers is not null or r.customer_payload is null
   or r.request_hash is distinct from lumin.customer_field_request_hash(lumin.conditional_customer_field_answers(v.paid_snapshot->'customerFields',r.customer_answers),r.customer_payload,b.slot_start)
   then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return result;
end $$;

alter function public.issue_flow_session(uuid,text,text) rename to issue_flow_session_v12345;
revoke all on function public.issue_flow_session_v12345(uuid,text,text) from public,anon,authenticated,service_role;

create function public.issue_flow_session(p_installation_id uuid,p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.flow_installations;v public.flow_versions;service jsonb;expiry timestamptz;
begin
 select * into i from public.flow_installations where id=p_installation_id for share;
 if not found or p_origin is null or not(i.allowed_origins ? p_origin) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from public.flow_versions where tenant_id=i.tenant_id and flow_id=i.flow_id and id=i.version_id;
 if v.render_schema_version is distinct from 6 then return public.issue_flow_session_v12345(p_installation_id,p_token_hash,p_origin);end if;
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform 1 from public.tenants where id=i.tenant_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.flows where tenant_id=i.tenant_id and id=i.flow_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 service:=lumin.conditional_customer_field_version_service(i.tenant_id,i.flow_id,i.version_id);
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into public.flow_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,origin,expires_at)
 values(p_token_hash,i.tenant_id,i.flow_id,i.version_id,i.id,(service->>'id')::uuid,p_origin,expiry);
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 return jsonb_build_object('expiresAt',expiry,'render',v.paid_snapshot||jsonb_build_object('versionId',v.id));
end $$;

create function public.submit_conditional_customer_field_request(p_token_hash text,p_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions;v public.flow_versions;old public.flow_requests;hash text;customer uuid;booking uuid;ref text;v_name text;v_email text;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 select * into s from public.flow_sessions where token_hash=p_token_hash for update;
 if not found or s.revoked or s.expires_at<=clock_timestamp() or s.origin is distinct from p_origin then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 if v.render_schema_version is distinct from 6 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 p_answers:=lumin.conditional_customer_field_answers(v.paid_snapshot->'customerFields',p_answers);
 if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128
 or p_customer is null or jsonb_typeof(p_customer)<>'object' or p_customer-array['name','email']<>'{}'
 or jsonb_typeof(p_customer->'name') is distinct from 'string' or jsonb_typeof(p_customer->'email') is distinct from 'string'
 or p_requested_start is null or not isfinite(p_requested_start) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_name:=btrim(p_customer->>'name');v_email:=btrim(p_customer->>'email');
 if length(v_name) not between 1 and 200 or length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 p_customer:=jsonb_build_object('name',v_name,'email',v_email);
 hash:=lumin.customer_field_request_hash(p_answers,p_customer,p_requested_start);
 select * into old from public.flow_requests where session_id=s.id;
 if found then
  if old.idempotency_key<>p_idempotency_key or old.request_hash<>hash or old.customer_answers is distinct from p_answers or old.customer_payload is distinct from p_customer then raise exception 'CONFLICT' using errcode='40001';end if;
  select reference into ref from public.bookings where tenant_id=s.tenant_id and id=old.booking_id and state='draft';
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  if p_requested_start<=clock_timestamp() then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  insert into public.customers(tenant_id,name,email) values(s.tenant_id,v_name,v_email) on conflict(tenant_id,email) do nothing returning id into customer;
  if customer is null then select id into customer from public.customers where tenant_id=s.tenant_id and customers.email=v_email;end if;
  booking:=gen_random_uuid();ref:='LMN-'||upper(replace(booking::text,'-',''));
  insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key)
  values(booking,s.tenant_id,ref,'draft',jsonb_build_object('serviceId',s.service_id),'{}',p_requested_start,p_requested_start+make_interval(mins=>(v.paid_snapshot#>>'{service,durationMinutes}')::integer),customer,'flow-session:'||s.id::text);
  insert into public.flow_requests(tenant_id,session_id,booking_id,idempotency_key,request_hash,customer_answers,customer_payload) values(s.tenant_id,s.id,booking,p_idempotency_key,hash,p_answers,p_customer);
  perform public.outbox_enqueue(s.tenant_id,booking,'booking.requested',s.id);
 end if;
 -- Re-prove exact persisted informational and booking identity before committing.
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 return jsonb_build_object('reference',ref,'state','draft','confirmed',false);
end $$;

revoke all on function lumin.conditional_customer_field_version_service(uuid,uuid,uuid) from public,anon,authenticated,service_role;

revoke all on function public.save_paid_conditional_customer_field_draft(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb),public.publish_paid_conditional_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.submit_conditional_customer_field_request(text,text,text,jsonb,jsonb,timestamptz),public.customer_flow_availability_scope(text,text),public.issue_flow_session(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.save_paid_conditional_customer_field_draft(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb),public.publish_paid_conditional_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.submit_conditional_customer_field_request(text,text,text,jsonb,jsonb,timestamptz),public.customer_flow_availability_scope(text,text),public.issue_flow_session(uuid,text,text) to service_role;
create function public.owner_conditional_customer_field_publication(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows;v public.flow_versions;b public.bound_flow_versions;installations jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id for share;
 if not found or v.render_schema_version<>6 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
 select coalesce(jsonb_agg(i.row order by i.id),'[]') into installations from(select id,jsonb_build_object('installationId',id,'allowedOrigins',allowed_origins) row from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id order by id limit 2)i;
 return jsonb_build_object('tenantId',p_tenant,'flowId',p_flow,'versionId',v.id,'sourceRevision',v.source_revision::text,'renderSchemaVersion',v.render_schema_version,'snapshot',v.paid_snapshot,'config',v.config,'serviceId',b.service_id,'boundSnapshot',b.service_snapshot,'installations',installations);
end $$;
revoke all on function public.owner_conditional_customer_field_publication(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_conditional_customer_field_publication(uuid,uuid,uuid) to service_role;
commit;
