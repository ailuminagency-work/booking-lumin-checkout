-- Dedicated Detailing publication and quote-only session evidence. No financial writer.
begin;
create table public.detailing_drafts(flow_id uuid primary key,tenant_id uuid not null references public.tenants(id),actor_id uuid not null references auth.users(id),service_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740991),name text not null,accent_color text not null,layout text not null,unique(tenant_id,flow_id),foreign key(tenant_id,service_id) references public.services(tenant_id,id));
alter table public.detailing_drafts enable row level security;alter table public.detailing_drafts force row level security;revoke all on public.detailing_drafts from public,anon,authenticated,service_role;
create table public.detailing_publications(tenant_id uuid not null,flow_id uuid not null,version_id uuid not null,actor_id uuid not null references auth.users(id),catalog_snapshot jsonb not null,scheduling_snapshot jsonb not null,primary key(tenant_id,flow_id,version_id),foreign key(tenant_id,flow_id,version_id) references public.flow_versions(tenant_id,flow_id,id));
alter table public.detailing_publications enable row level security;alter table public.detailing_publications force row level security;revoke all on public.detailing_publications from public,anon,authenticated,service_role;
create trigger detailing_publications_immutable before update or delete on public.detailing_publications for each row execute function lumin.reject_flow_version_mutation();
create function lumin.detailing_context(p_actor uuid,p_tenant uuid,p_service uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.tenants;c public.owner_detailing_catalog_creations;s public.owner_detailing_scheduling;service jsonb;windows jsonb;policy jsonb;
begin
 -- Same tenant-first ordering as0059, then catalog/service before draft/flow.
 select * into t from public.tenants where id=p_tenant and status='active' for update;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if public.owner_business_profile(p_actor,p_tenant)->>'businessType'<>'AUTO_DETAILING' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into c from public.owner_detailing_catalog_creations where tenant_id=p_tenant and service_id=p_service and actor_id=p_actor;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 service:=lumin.detailing_catalog_snapshot(p_tenant,p_service);
 if service is distinct from c.service_snapshot or service->>'currency'<>t.currency then raise exception 'CONFLICT' using errcode='40001';end if;
 perform 1 from public.service_resources where service_id=p_service for share;perform 1 from public.allocation_policies where tenant_id=p_tenant and service_id=p_service for share;
 if exists(select 1 from public.service_resources where service_id=p_service) or exists(select 1 from public.allocation_policies where tenant_id=p_tenant and service_id=p_service) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 perform 1 from public.availability_rules where tenant_id=p_tenant order by id for share;perform 1 from public.availability_overrides where tenant_id=p_tenant order by id for share;perform 1 from public.scheduling_policies where tenant_id=p_tenant order by id for share;
 select * into s from public.owner_detailing_scheduling where tenant_id=p_tenant and service_id=p_service and actor_id=p_actor;
 if not found or s.timezone<>t.timezone or exists(select 1 from public.availability_rules where tenant_id=p_tenant and service_id is null) or exists(select 1 from public.availability_overrides where tenant_id=p_tenant and(service_id=p_service or service_id is null)) or exists(select 1 from public.scheduling_policies where tenant_id=p_tenant and service_id is null) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'weekday',weekday,'startMinute',start_minute,'endMinute',end_minute,'capacity',capacity) order by weekday,id),'[]') into windows from public.availability_rules where tenant_id=p_tenant and service_id=p_service;
 select jsonb_build_object('id',id,'leadTimeMinutes',lead_time_minutes,'horizonDays',horizon_days,'slotIntervalMinutes',slot_interval_minutes) into policy from public.scheduling_policies where tenant_id=p_tenant and service_id=p_service;
 if windows is distinct from s.receipt->'windows' or policy is distinct from s.receipt->'policy' then raise exception 'CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('service',service,'catalog',c.creation_body-'idempotencyKey','scheduling',s.receipt);
end$$;
create function lumin.detailing_snapshot_valid(p jsonb,r bigint) returns boolean language plpgsql immutable set search_path=pg_catalog as $$begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['renderSchemaVersion','businessType','submissionMode','bookingMode','paymentMode','pricingModel','serviceId','catalog','publication']<>'{}' or not(p ?& array['renderSchemaVersion','businessType','submissionMode','bookingMode','paymentMode','pricingModel','serviceId','catalog','publication']) then return false;end if;
 return(p->'renderSchemaVersion'='7'::jsonb and p->>'businessType'='AUTO_DETAILING' and p->>'submissionMode'='detailing_quote' and p->>'bookingMode'='unavailable' and p->>'paymentMode'='unavailable' and p->>'pricingModel'='package_subtotal_vehicle_multiplier' and jsonb_typeof(p->'serviceId')='string' and (p->>'serviceId')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and not(p->'catalog' ? 'idempotencyKey') and lumin.detailing_body_valid((p->'catalog')||jsonb_build_object('idempotencyKey','catalog-validation-0001')) and lumin.paid_simple_metadata_valid(p->'publication',r) and lumin.detailing_text(p#>'{publication,name}',200,false)) is true;
end$$;
alter table public.flow_versions add column detailing_snapshot jsonb;
alter table public.flow_versions drop constraint flow_versions_render_schema_version_check;alter table public.flow_versions add constraint flow_versions_render_schema_version_check check(render_schema_version in(1,2,3,4,5,6,7));
alter table public.flow_versions drop constraint flow_version_render_shape;
alter table public.flow_versions add constraint flow_version_render_shape check(
 ((render_schema_version=1 and configurable_snapshot is null and paid_snapshot is null)
 or(render_schema_version=2 and configurable_snapshot is not null and paid_snapshot is null and jsonb_typeof(configurable_snapshot)='object' and configurable_snapshot->'renderSchemaVersion'='2'::jsonb and configurable_snapshot->>'submissionMode'='unconfirmed_request' and configurable_snapshot->'config'=config)
 or(render_schema_version in(3,4) and configurable_snapshot is null and paid_snapshot is not null and jsonb_typeof(paid_snapshot)='object' and paid_snapshot->'renderSchemaVersion'=to_jsonb(render_schema_version) and paid_snapshot->>'submissionMode'=case when render_schema_version=3 then 'paid_service_request' else 'paid_option_request' end)
 or(render_schema_version=5 and configurable_snapshot is null and lumin.customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=6 and configurable_snapshot is null and lumin.conditional_customer_field_snapshot_valid(paid_snapshot,source_revision))
 or(render_schema_version=7 and configurable_snapshot is null and paid_snapshot is null and lumin.detailing_snapshot_valid(detailing_snapshot,source_revision))) is true);
alter table public.flow_versions add constraint detailing_snapshot_exclusive check((render_schema_version=7)=(detailing_snapshot is not null));
create function public.save_detailing_draft(a uuid,t uuid,f uuid,service uuid,expected bigint,p_name text,color text,p_layout text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.detailing_drafts;revision bigint;
begin
 perform lumin.detailing_context(a,t,service);
 if f is null or expected is null or expected not between 0 and 9007199254740990 or not lumin.detailing_text(to_jsonb(p_name),200,false) or color is null or color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p_layout is null or p_layout not in('stacked','compact') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if expected=0 then
  if exists(select 1 from public.flows where id=f) or exists(select 1 from public.paid_simple_drafts where flow_id=f) then raise exception 'CONFLICT' using errcode='40001';end if;
  insert into public.detailing_drafts values(f,t,a,service,1,p_name,color,p_layout);revision:=1;
 else
  update public.detailing_drafts set revision=detailing_drafts.revision+1,name=p_name,accent_color=color,layout=p_layout where tenant_id=t and flow_id=f and actor_id=a and service_id=service and detailing_drafts.revision=expected returning detailing_drafts.revision into revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',1,'businessType','AUTO_DETAILING','flowId',f,'revision',revision,'serviceId',service,'name',p_name,'presentation',jsonb_build_object('accentColor',color,'layout',p_layout));
end$$;
create function public.get_detailing_draft(a uuid,t uuid,f uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.detailing_drafts;service uuid;
begin
 select service_id into service from public.detailing_drafts where tenant_id=t and flow_id=f and actor_id=a;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.detailing_context(a,t,service);select * into d from public.detailing_drafts where tenant_id=t and flow_id=f and actor_id=a for share;
 return jsonb_build_object('schemaVersion',1,'businessType','AUTO_DETAILING','flowId',f,'revision',d.revision,'serviceId',d.service_id,'name',d.name,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout));
end$$;
create function lumin.detailing_version(t uuid,f uuid,v_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.flow_versions;b public.bound_flow_versions;p public.detailing_publications;c jsonb;cfg jsonb;
begin
 select * into v from public.flow_versions where tenant_id=t and flow_id=f and id=v_id;
 if not found or v.render_schema_version<>7 or not lumin.detailing_snapshot_valid(v.detailing_snapshot,v.source_revision) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select * into p from public.detailing_publications where tenant_id=t and flow_id=f and version_id=v_id;if not found then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 select * into b from public.bound_flow_versions where tenant_id=t and flow_id=f and version_id=v_id;if not found then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 c:=lumin.detailing_context(p.actor_id,t,b.service_id);cfg:=jsonb_build_object('key','detailing_quote','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',c#>>'{service,name}')));
 if b.service_snapshot is distinct from c->'service' or p.catalog_snapshot is distinct from c->'catalog' or p.scheduling_snapshot is distinct from c->'scheduling' or v.detailing_snapshot->'catalog' is distinct from c->'catalog' or v.detailing_snapshot->>'serviceId' is distinct from b.service_id::text or v.config is distinct from cfg then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return c||jsonb_build_object('render',v.detailing_snapshot||jsonb_build_object('versionId',v.id));
end$$;
create function public.publish_detailing_draft(a uuid,t uuid,f_id uuid,expected bigint,v_id uuid,i_id uuid,origins jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.detailing_drafts;ctx jsonb;snapshot jsonb;cfg jsonb;f public.flows;v public.flow_versions;i public.flow_installations;
begin
 if expected is null or expected not between 1 and 9007199254740991 or not lumin.flow_origins_storage_valid(origins) or (select count(distinct value) from jsonb_array_elements(origins))<>jsonb_array_length(origins) or v_id is null or i_id is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into d from public.detailing_drafts where tenant_id=t and flow_id=f_id and actor_id=a;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 ctx:=lumin.detailing_context(a,t,d.service_id);select * into d from public.detailing_drafts where tenant_id=t and flow_id=f_id and actor_id=a and revision=expected for update;if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 snapshot:=jsonb_build_object('renderSchemaVersion',7,'businessType','AUTO_DETAILING','submissionMode','detailing_quote','bookingMode','unavailable','paymentMode','unavailable','pricingModel','package_subtotal_vehicle_multiplier','serviceId',d.service_id,'catalog',ctx->'catalog','publication',jsonb_build_object('name',d.name,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout),'draftRevision',d.revision));
 if not lumin.detailing_snapshot_valid(snapshot,d.revision) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 cfg:=jsonb_build_object('key','detailing_quote','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',ctx#>>'{service,name}')));
 select * into f from public.flows where id=f_id for update;
 if found then
  if f.tenant_id<>t or f.status<>'active' then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=t and flow_id=f_id and id=f.published_version_id;
  if not found or v.render_schema_version<>7 then raise exception 'CONFLICT' using errcode='40001';end if;
  select * into v from public.flow_versions where tenant_id=t and flow_id=f_id and source_revision=expected;
  if found then
   if f.published_version_id<>v.id or v.detailing_snapshot is distinct from snapshot or v.config is distinct from cfg then raise exception 'CONFLICT' using errcode='40001';end if;
   perform lumin.detailing_version(t,f_id,v.id);
   if(select count(*) from public.flow_installations where tenant_id=t and flow_id=f_id and version_id=v.id)<>1 then raise exception 'CONFLICT' using errcode='40001';end if;
   select * into i from public.flow_installations where tenant_id=t and flow_id=f_id and version_id=v.id for share;if i.allowed_origins is distinct from origins then raise exception 'CONFLICT' using errcode='40001';end if;
   return jsonb_build_object('flowId',f_id,'draftRevision',expected,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',7,'replayed',true);
  end if;
  if exists(select 1 from public.flow_versions where tenant_id=t and flow_id=f_id and source_revision>=expected) then raise exception 'CONFLICT' using errcode='40001';end if;
 else insert into public.flows(id,tenant_id,name,status) values(f_id,t,d.name,'active');end if;
 insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,detailing_snapshot) values(v_id,t,f_id,expected,'unconfirmed_request',cfg,7,snapshot);
 insert into public.bound_flow_services values(t,f_id,d.service_id) on conflict(tenant_id,flow_id) do update set service_id=excluded.service_id;
 insert into public.bound_flow_versions values(t,f_id,v_id,d.service_id,ctx->'service');insert into public.detailing_publications values(t,f_id,v_id,a,ctx->'catalog',ctx->'scheduling');
 insert into public.flow_installations values(i_id,t,f_id,v_id,origins);update public.flows set name=d.name,status='active',published_version_id=v_id where tenant_id=t and id=f_id;
 return jsonb_build_object('flowId',f_id,'draftRevision',expected,'versionId',v_id,'installationId',i_id,'renderSchemaVersion',7,'replayed',false);
end$$;
create function public.owner_detailing_publication(a uuid,t uuid,f_id uuid,approved jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.detailing_drafts;f public.flows;v public.flow_versions;i public.flow_installations;
begin
 select * into d from public.detailing_drafts where tenant_id=t and flow_id=f_id and actor_id=a;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.detailing_context(a,t,d.service_id);select * into d from public.detailing_drafts where tenant_id=t and flow_id=f_id and actor_id=a for share;select * into f from public.flows where tenant_id=t and id=f_id and status='active' for share;
 select * into v from public.flow_versions where tenant_id=t and flow_id=f_id and id=f.published_version_id;
 if not found or v.source_revision<>d.revision or v.render_schema_version<>7 or v.detailing_snapshot#>>'{publication,name}'<>d.name or v.detailing_snapshot#>>'{publication,presentation,accentColor}'<>d.accent_color or v.detailing_snapshot#>>'{publication,presentation,layout}'<>d.layout then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.detailing_version(t,f_id,v.id);
 if(select count(*) from public.flow_installations where tenant_id=t and flow_id=f_id and version_id=v.id)<>1 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into i from public.flow_installations where tenant_id=t and flow_id=f_id and version_id=v.id for share;
 if not(i.allowed_origins<@approved) or not lumin.flow_origins_storage_valid(i.allowed_origins) or (select count(distinct value) from jsonb_array_elements(i.allowed_origins))<>jsonb_array_length(i.allowed_origins) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('flowId',f_id,'draftRevision',d.revision,'versionId',v.id,'installationId',i.id,'renderSchemaVersion',7);
end$$;
create function public.resolve_detailing_flow_session(hash text,origin text,approved jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions;i public.flow_installations;ctx jsonb;
begin
 select * into s from public.flow_sessions where token_hash=hash for share;
 if not found or s.revoked or s.expires_at<=clock_timestamp() or s.origin is distinct from origin then raise exception 'FORBIDDEN' using errcode='42501';end if;
 ctx:=lumin.detailing_version(s.tenant_id,s.flow_id,s.version_id);
 perform 1 from public.flows where tenant_id=s.tenant_id and id=s.flow_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into i from public.flow_installations where tenant_id=s.tenant_id and flow_id=s.flow_id and version_id=s.version_id and id=s.installation_id for share;
 if not found or not(i.allowed_origins ? origin) or not(i.allowed_origins<@approved) or not lumin.flow_origins_storage_valid(i.allowed_origins) or (select count(distinct value) from jsonb_array_elements(i.allowed_origins))<>jsonb_array_length(i.allowed_origins) or (select count(*) from public.flow_installations where tenant_id=s.tenant_id and flow_id=s.flow_id and version_id=s.version_id)<>1 or (ctx#>>'{service,id}') is distinct from s.service_id::text or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return ctx||jsonb_build_object('installationId',s.installation_id,'expiresAt',s.expires_at);
end$$;
create function public.issue_detailing_flow_session(i_id uuid,hash text,origin text,approved jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i public.flow_installations;ctx jsonb;expiry timestamptz;
begin
 if hash is null or hash !~ '^[0-9a-f]{64}$' or origin is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into i from public.flow_installations where id=i_id;if not found or not(i.allowed_origins ? origin) or not(i.allowed_origins<@approved) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 ctx:=lumin.detailing_version(i.tenant_id,i.flow_id,i.version_id);perform 1 from public.flows where tenant_id=i.tenant_id and id=i.flow_id and status='active' for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 expiry:=clock_timestamp()+interval '15 minutes';insert into public.flow_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,origin,expires_at) values(hash,i.tenant_id,i.flow_id,i.version_id,i.id,(ctx#>>'{service,id}')::uuid,origin,expiry);
 perform public.resolve_detailing_flow_session(hash,origin,approved);return jsonb_build_object('expiresAt',expiry,'render',ctx->'render');
end$$;
revoke all on function lumin.detailing_context(uuid,uuid,uuid),lumin.detailing_snapshot_valid(jsonb,bigint),lumin.detailing_version(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_detailing_draft(uuid,uuid,uuid,uuid,bigint,text,text,text),public.get_detailing_draft(uuid,uuid,uuid),public.publish_detailing_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.owner_detailing_publication(uuid,uuid,uuid,jsonb),public.resolve_detailing_flow_session(text,text,jsonb),public.issue_detailing_flow_session(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_detailing_draft(uuid,uuid,uuid,uuid,bigint,text,text,text),public.get_detailing_draft(uuid,uuid,uuid),public.publish_detailing_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.owner_detailing_publication(uuid,uuid,uuid,jsonb),public.resolve_detailing_flow_session(text,text,jsonb),public.issue_detailing_flow_session(uuid,text,text,jsonb) to service_role;
commit;
