-- Explicit V5 informational answers; existing V1/V3/V4 and sole financial writers remain unchanged.
begin;
create function lumin.customer_field_answers(p_fields jsonb,p_answers jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb;key text;value text;
begin
 if not lumin.customer_draft_fields_valid(p_fields) or p_answers is null or jsonb_typeof(p_answers)<>'object'
  or (select count(*) from jsonb_object_keys(p_answers))>10 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_answers) keys(id) where not exists(select 1 from jsonb_array_elements(p_fields) fields(definition) where fields.definition->>'id'=keys.id)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 for f in select e.value from jsonb_array_elements(p_fields) e loop
  key:=f->>'id';
  if not(p_answers ? key) then if f->'required'='true'::jsonb then raise exception 'INVALID_REQUEST' using errcode='22023';end if;continue;end if;
  if jsonb_typeof(p_answers->key) is distinct from 'string' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  value:=p_answers->>key;
  if lumin.utf16_length(value)>(f->>'maxLength')::integer or value ~ U&'[\0001-\001f\007f-\009f]'
   or (f->'required'='true'::jsonb and length(btrim(value,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'))=0)
   then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 end loop;
 return p_answers;
end $$;

create function lumin.customer_field_snapshot_valid(p jsonb,p_revision bigint) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare service jsonb;price jsonb;duration numeric;amount numeric;
begin
 if p is null or jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>7
  or not(p ?& array['renderSchemaVersion','submissionMode','paymentMode','simulated','service','publication','customerFields']) then return false;end if;
 service:=p->'service';price:=service->'price';
 if jsonb_typeof(service) is distinct from 'object' or (select count(*) from jsonb_object_keys(service))<>4 or not(service ?& array['id','name','durationMinutes','price'])
  or jsonb_typeof(service->'id') is distinct from 'string' or (service->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(service->'name') is distinct from 'string' or lumin.utf16_length(service->>'name') not between 1 and 200
  or jsonb_typeof(service->'durationMinutes') is distinct from 'number' or jsonb_typeof(price) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(price))<>2 or not(price ?& array['amount','currency'])
  or jsonb_typeof(price->'amount') is distinct from 'number' or jsonb_typeof(price->'currency') is distinct from 'string' or (price->>'currency') !~ '^[A-Z]{3}$' then return false;end if;
 duration:=(service->>'durationMinutes')::numeric;amount:=(price->>'amount')::numeric;
 if duration not between 5 and 1440 or duration<>trunc(duration) or amount not between 1 and 9007199254740991 or amount<>trunc(amount) then return false;end if;
 return (p->'renderSchemaVersion'='5'::jsonb and p->>'submissionMode'='paid_customer_field_request'
  and p->>'paymentMode'='staging_mock' and p->'simulated'='true'::jsonb
  and lumin.paid_simple_metadata_valid(p->'publication',p_revision) and lumin.utf16_length(p#>>'{publication,name}') between 1 and 200 and lumin.customer_draft_fields_valid(p->'customerFields')) is true;
end $$;
create function lumin.customer_field_request_hash(p_answers jsonb,p_customer jsonb,p_start timestamptz) returns text
language sql immutable set search_path=pg_catalog as $$select encode(sha256(convert_to(jsonb_build_object('customerAnswers',p_answers,'customer',p_customer,'requestedEpoch',extract(epoch from p_start))::text,'UTF8')),'hex')$$;
revoke all on function lumin.customer_field_answers(jsonb,jsonb),lumin.customer_field_snapshot_valid(jsonb,bigint),lumin.customer_field_request_hash(jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;

alter table public.flow_requests add column customer_answers jsonb,add column customer_payload jsonb;
alter table public.flow_requests add constraint customer_request_information_shape check(
 (customer_answers is null and customer_payload is null) or
 (customer_answers is not null and jsonb_typeof(customer_answers)='object' and customer_payload is not null and jsonb_typeof(customer_payload)='object'));
create function lumin.immutable_customer_field_request() returns trigger language plpgsql set search_path=pg_catalog as $$
begin if old.customer_answers is not null or new.customer_answers is not null then raise exception 'IMMUTABLE_CUSTOMER_REQUEST' using errcode='55000';end if;return new;end $$;
revoke all on function lumin.immutable_customer_field_request() from public,anon,authenticated,service_role;
create trigger immutable_customer_field_request before update on public.flow_requests for each row execute function lumin.immutable_customer_field_request();

alter table public.flow_versions drop constraint flow_versions_render_schema_version_check;
alter table public.flow_versions add constraint flow_versions_render_schema_version_check check(render_schema_version in(1,2,3,4,5));
alter table public.flow_versions drop constraint flow_version_render_shape;
alter table public.flow_versions add constraint flow_version_render_shape check(
 ((render_schema_version=1 and configurable_snapshot is null and paid_snapshot is null)
 or(render_schema_version=2 and configurable_snapshot is not null and paid_snapshot is null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config)
 or(render_schema_version in(3,4) and configurable_snapshot is null and paid_snapshot is not null and jsonb_typeof(paid_snapshot)='object' and paid_snapshot->'renderSchemaVersion'=to_jsonb(render_schema_version) and paid_snapshot->>'submissionMode'=case when render_schema_version=3 then 'paid_service_request' else 'paid_option_request' end)
 or(render_schema_version=5 and configurable_snapshot is null and lumin.customer_field_snapshot_valid(paid_snapshot,source_revision))) is true);

-- Validate private version/service/config provenance independently of current draft changes.
create function lumin.customer_field_version_service(p_tenant uuid,p_flow uuid,p_version uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v public.flow_versions;b public.bound_flow_versions;service jsonb;cfg jsonb;
begin
 select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_version;
 if not found or v.render_schema_version<>5 or not lumin.customer_field_snapshot_valid(v.paid_snapshot,v.source_revision) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=p_version;
 if not found then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 service:=lumin.paid_simple_service(p_tenant,b.service_id);
 cfg:=jsonb_build_object('key','paid_customer_field','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 if b.service_snapshot is distinct from service or v.paid_snapshot->'service' is distinct from service or v.config is distinct from cfg then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return service;
end $$;
revoke all on function lumin.customer_field_version_service(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.publish_paid_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb) returns jsonb
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
 if d.draft_schema_version<>2 or not lumin.customer_draft_fields_valid(d.customer_fields) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
snapshot:=jsonb_build_object('renderSchemaVersion',5,'submissionMode','paid_customer_field_request','paymentMode','staging_mock','simulated',true,'service',service,'customerFields',d.customer_fields,
  'publication',jsonb_build_object('name',d.name,'draftRevision',d.revision,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout)));
 if not lumin.customer_field_snapshot_valid(snapshot,d.revision) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 cfg:=jsonb_build_object('key','paid_customer_field','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 select * into f from public.flows where id=p_flow for update;
 if found then
  if f.tenant_id<>p_tenant or f.status='archived' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id;
  if not found or v.render_schema_version not in(3,5) then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision=p_expected_revision for update;
  if found then
   if f.status<>'active' or f.published_version_id<>v.id or v.render_schema_version<>5 or v.paid_snapshot is distinct from snapshot or v.config is distinct from cfg then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if not found or b.service_id<>d.service_id or b.service_snapshot is distinct from service then raise exception 'CONFLICT' using errcode='40001';end if;
   select count(*) into installation_count from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
   if installation_count<>1 then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into i from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id for share;
   if i.allowed_origins is distinct from p_origins then raise exception 'CONFLICT' using errcode='40001';end if;
   return jsonb_build_object('flowId',p_flow,'draftRevision',d.revision,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',5,'replayed',true);
  end if;
  if exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision>=p_expected_revision) then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  insert into public.flows(id,tenant_id,name,status) values(p_flow,p_tenant,d.name,'active');
 end if;
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,paid_snapshot)
 values(p_version,p_tenant,p_flow,d.revision,'unconfirmed_request',cfg,5,snapshot);
 insert into public.bound_flow_services values(p_tenant,p_flow,d.service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 insert into public.bound_flow_versions values(p_tenant,p_flow,p_version,d.service_id,service);
 insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation,p_tenant,p_flow,p_version,p_origins);
 update public.flows set name=d.name,status='active',published_version_id=p_version where tenant_id=p_tenant and id=p_flow;
 return jsonb_build_object('flowId',p_flow,'draftRevision',d.revision,'versionId',p_version,'installationId',p_installation,'renderSchemaVersion',5,'replayed',false);
end $$;

alter function public.customer_flow_availability_scope(text,text) rename to customer_flow_availability_scope_v1234;
revoke all on function public.customer_flow_availability_scope_v1234(text,text) from public,anon,authenticated,service_role;
create function public.customer_flow_availability_scope(p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;s public.flow_sessions;v public.flow_versions;r public.flow_requests;b public.bookings;service jsonb;
begin
 -- The accepted primitive proves active tenant/flow, exact origin/installation,
 -- session expiry and absence of planning/resource authority.
 result:=public.customer_flow_availability_scope_v12(p_token_hash,p_origin);
 select * into s from public.flow_sessions where token_hash=p_token_hash;
 select * into v from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 if v.render_schema_version is distinct from 5 then return public.customer_flow_availability_scope_v1234(p_token_hash,p_origin);end if;
 service:=lumin.customer_field_version_service(s.tenant_id,s.flow_id,s.version_id);
 if service->>'id' is distinct from s.service_id::text then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select * into r from public.flow_requests where tenant_id=s.tenant_id and session_id=s.id for share;
 if found then
  select * into b from public.bookings where tenant_id=r.tenant_id and id=r.booking_id;
  if not found or b.selection is distinct from jsonb_build_object('serviceId',s.service_id)
   or b.idempotency_key is distinct from 'flow-session:'||s.id::text or b.slot_end is distinct from b.slot_start+make_interval(mins=>(service->>'durationMinutes')::integer)
   or r.option_answers is not null or r.customer_payload is null
   or r.request_hash is distinct from lumin.customer_field_request_hash(lumin.customer_field_answers(v.paid_snapshot->'customerFields',r.customer_answers),r.customer_payload,b.slot_start)
   then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return result;
end $$;

alter function public.issue_flow_session(uuid,text,text) rename to issue_flow_session_v1234;
revoke all on function public.issue_flow_session_v1234(uuid,text,text) from public,anon,authenticated,service_role;
create function public.issue_flow_session(p_installation_id uuid,p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.flow_installations;v public.flow_versions;service jsonb;expiry timestamptz;
begin
 select * into i from public.flow_installations where id=p_installation_id for share;
 if not found or p_origin is null or not(i.allowed_origins ? p_origin) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from public.flow_versions where tenant_id=i.tenant_id and flow_id=i.flow_id and id=i.version_id;
 if v.render_schema_version is distinct from 5 then return public.issue_flow_session_v1234(p_installation_id,p_token_hash,p_origin);end if;
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform 1 from public.tenants where id=i.tenant_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.flows where tenant_id=i.tenant_id and id=i.flow_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 service:=lumin.customer_field_version_service(i.tenant_id,i.flow_id,i.version_id);
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into public.flow_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,origin,expires_at)
 values(p_token_hash,i.tenant_id,i.flow_id,i.version_id,i.id,(service->>'id')::uuid,p_origin,expiry);
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 return jsonb_build_object('expiresAt',expiry,'render',v.paid_snapshot||jsonb_build_object('versionId',v.id));
end $$;

create function public.submit_customer_field_request(p_token_hash text,p_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions;v public.flow_versions;old public.flow_requests;hash text;customer uuid;booking uuid;ref text;v_name text;v_email text;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 select * into s from public.flow_sessions where token_hash=p_token_hash for update;
 if not found or s.revoked or s.expires_at<=clock_timestamp() or s.origin is distinct from p_origin then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 if v.render_schema_version is distinct from 5 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 p_answers:=lumin.customer_field_answers(v.paid_snapshot->'customerFields',p_answers);
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

revoke all on function public.publish_paid_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.submit_customer_field_request(text,text,text,jsonb,jsonb,timestamptz),public.issue_flow_session(uuid,text,text),public.customer_flow_availability_scope(text,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_paid_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.submit_customer_field_request(text,text,text,jsonb,jsonb,timestamptz),public.issue_flow_session(uuid,text,text),public.customer_flow_availability_scope(text,text) to service_role;
commit;
