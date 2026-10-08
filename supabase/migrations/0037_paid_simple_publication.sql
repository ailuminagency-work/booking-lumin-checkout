-- Explicit paid simple V3: create-only publication. Legacy V1/V2 contracts stay unchanged.
begin;
alter table public.flow_versions drop constraint flow_versions_render_schema_version_check;
alter table public.flow_versions add constraint flow_versions_render_schema_version_check check(render_schema_version in(1,2,3));
alter table public.flow_versions add column paid_snapshot jsonb;
alter table public.flow_versions drop constraint flow_version_render_shape;
alter table public.flow_versions add constraint flow_version_render_shape check(
 ((render_schema_version=1 and configurable_snapshot is null and paid_snapshot is null)
 or(render_schema_version=2 and configurable_snapshot is not null and paid_snapshot is null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config)
 or(render_schema_version=3 and configurable_snapshot is null and paid_snapshot is not null and jsonb_typeof(paid_snapshot)='object' and paid_snapshot->'renderSchemaVersion'='3'::jsonb and paid_snapshot->>'submissionMode'='paid_service_request')) is true);

create function lumin.paid_simple_service(p_tenant uuid,p_service uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.services;
begin
 lock table public.allocation_policies,public.service_resources in share mode;
 lock table public.services,public.service_items,public.service_addons,public.service_questions in share mode;
 select * into s from public.services where tenant_id=p_tenant and id=p_service and active for share;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if s.archetype<>'simple' or s.base_price not between 1 and 9007199254740991 or s.tax_rate_bp<>0 or s.rental is not null
 or s.duration_minutes not between 5 and 1440 or length(s.name) not between 1 and 200
 or exists(select 1 from public.service_items where service_id=s.id)
 or exists(select 1 from public.service_addons where service_id=s.id)
 or exists(select 1 from public.service_questions where service_id=s.id)
 or exists(select 1 from public.service_resources where service_id=s.id)
 or exists(select 1 from public.allocation_policies where service_id=s.id)
 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return jsonb_build_object('id',s.id,'name',s.name,'durationMinutes',s.duration_minutes,'price',jsonb_build_object('amount',s.base_price,'currency',s.currency));
end $$;
revoke all on function lumin.paid_simple_service(uuid,uuid) from public,anon,authenticated,service_role;

create function public.publish_paid_simple_flow(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_name text,p_version uuid,p_installation uuid,p_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare service jsonb; cfg jsonb; snapshot jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_name is null or length(btrim(p_name)) not between 1 and 200 or not lumin.flow_origins_storage_valid(p_origins)
 or p_flow is null or p_version is null or p_installation is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 service:=lumin.paid_simple_service(p_tenant,p_service);
 snapshot:=jsonb_build_object('renderSchemaVersion',3,'submissionMode','paid_service_request','paymentMode','staging_mock','simulated',true,'service',service);
 -- Internal information step satisfies existing storage shape, without pretending a question exists.
 cfg:=jsonb_build_object('key','paid_simple','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name')));
 insert into public.flows(id,tenant_id,name,status) values(p_flow,p_tenant,btrim(p_name),'active');
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,paid_snapshot)
 values(p_version,p_tenant,p_flow,1,'unconfirmed_request',cfg,3,snapshot);
 insert into public.bound_flow_services values(p_tenant,p_flow,p_service);
 insert into public.bound_flow_versions values(p_tenant,p_flow,p_version,p_service,service);
 insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values(p_installation,p_tenant,p_flow,p_version,p_origins);
 update public.flows set published_version_id=p_version where tenant_id=p_tenant and id=p_flow;
 return jsonb_build_object('versionId',p_version,'installationId',p_installation,'renderSchemaVersion',3);
end $$;
revoke all on function public.publish_paid_simple_flow(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_paid_simple_flow(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) to service_role;

-- Keep legacy behavior in private delegates; only the explicit dispatcher is exposed.
alter function public.customer_flow_availability_scope(text,text) rename to customer_flow_availability_scope_v12;
revoke all on function public.customer_flow_availability_scope_v12(text,text) from public,anon,authenticated,service_role;
create function public.customer_flow_availability_scope(p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; s public.flow_sessions; v public.flow_versions; pinned jsonb;
begin
 result:=public.customer_flow_availability_scope_v12(p_token_hash,p_origin);
 select * into s from public.flow_sessions where token_hash=p_token_hash;
 select * into v from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 if v.render_schema_version=3 then
  select service_snapshot into pinned from public.bound_flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and version_id=s.version_id and service_id=s.service_id;
  if pinned is distinct from v.paid_snapshot->'service' or pinned is distinct from lumin.paid_simple_service(s.tenant_id,s.service_id) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 elsif v.render_schema_version not in(1,2) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.customer_flow_availability_scope(text,text) from public,anon,authenticated,service_role;
grant execute on function public.customer_flow_availability_scope(text,text) to service_role;

alter function public.issue_flow_session(uuid,text,text) rename to issue_flow_session_v12;
revoke all on function public.issue_flow_session_v12(uuid,text,text) from public,anon,authenticated,service_role;
create function public.issue_flow_session(p_installation_id uuid,p_token_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare i public.flow_installations; v public.flow_versions; b public.bound_flow_versions; expiry timestamptz;
begin
 select * into i from public.flow_installations where id=p_installation_id for share;
 if not found or p_origin is null or not(i.allowed_origins ? p_origin) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from public.flow_versions where tenant_id=i.tenant_id and flow_id=i.flow_id and id=i.version_id;
 if v.render_schema_version in(1,2) then return public.issue_flow_session_v12(p_installation_id,p_token_hash,p_origin);end if;
 if v.render_schema_version is distinct from 3 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform 1 from public.tenants where id=i.tenant_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.flows where tenant_id=i.tenant_id and id=i.flow_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into b from public.bound_flow_versions where tenant_id=i.tenant_id and flow_id=i.flow_id and version_id=i.version_id;
 if not found or b.service_snapshot is distinct from v.paid_snapshot->'service' or b.service_snapshot is distinct from lumin.paid_simple_service(i.tenant_id,b.service_id) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into public.flow_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,origin,expires_at)
 values(p_token_hash,i.tenant_id,i.flow_id,i.version_id,i.id,b.service_id,p_origin,expiry);
 return jsonb_build_object('expiresAt',expiry,'render',v.paid_snapshot||jsonb_build_object('versionId',v.id));
end $$;
revoke all on function public.issue_flow_session(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.issue_flow_session(uuid,text,text) to service_role;

alter function public.submit_flow_request(text,text,text,jsonb,jsonb,timestamptz) rename to submit_flow_request_v12;
revoke all on function public.submit_flow_request_v12(text,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
create function public.submit_flow_request(p_token_hash text,p_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions; v public.flow_versions; old public.flow_requests; hash text; customer uuid; booking uuid; ref text; v_name text; v_email text;
begin
 select * into s from public.flow_sessions where token_hash=p_token_hash for update;
 if not found or s.revoked or s.expires_at<=clock_timestamp() or s.origin is distinct from p_origin then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into v from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 if v.render_schema_version in(1,2) then return public.submit_flow_request_v12(p_token_hash,p_origin,p_idempotency_key,p_answers,p_customer,p_requested_start);end if;
 if v.render_schema_version is distinct from 3 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 perform public.customer_flow_availability_scope(p_token_hash,p_origin);
 if p_answers is distinct from '{}'::jsonb or p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128
 or p_customer is null or jsonb_typeof(p_customer)<>'object' or p_customer-array['name','email']<>'{}'
 or jsonb_typeof(p_customer->'name') is distinct from 'string' or jsonb_typeof(p_customer->'email') is distinct from 'string'
 or p_requested_start is null or not isfinite(p_requested_start) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_name:=btrim(p_customer->>'name');v_email:=btrim(p_customer->>'email');
 if length(v_name) not between 1 and 200 or length(v_email) not between 3 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('customer',jsonb_build_object('name',v_name,'email',v_email),'requestedEpoch',extract(epoch from p_requested_start))::text,'UTF8')),'hex');
 select * into old from public.flow_requests where session_id=s.id;
 if found then
  if old.idempotency_key<>p_idempotency_key or old.request_hash<>hash then raise exception 'CONFLICT' using errcode='40001';end if;
  select reference into ref from public.bookings where tenant_id=s.tenant_id and id=old.booking_id and state='draft';
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 else
  if p_requested_start<=clock_timestamp() then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  insert into public.customers(tenant_id,name,email) values(s.tenant_id,v_name,v_email) on conflict(tenant_id,email) do nothing returning id into customer;
  if customer is null then select id into customer from public.customers where tenant_id=s.tenant_id and customers.email=v_email;end if;
  booking:=gen_random_uuid();ref:='LMN-'||upper(replace(booking::text,'-',''));
  insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key)
  values(booking,s.tenant_id,ref,'draft',jsonb_build_object('serviceId',s.service_id),'{}',p_requested_start,p_requested_start+make_interval(mins=>(v.paid_snapshot#>>'{service,durationMinutes}')::integer),customer,'flow-session:'||s.id::text);
  insert into public.flow_requests values(s.tenant_id,s.id,booking,p_idempotency_key,hash);
  perform public.outbox_enqueue(s.tenant_id,booking,'booking.requested',s.id);
 end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('reference',ref,'state','draft','confirmed',false);
end $$;
revoke all on function public.submit_flow_request(text,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.submit_flow_request(text,text,text,jsonb,jsonb,timestamptz) to service_role;
commit;
