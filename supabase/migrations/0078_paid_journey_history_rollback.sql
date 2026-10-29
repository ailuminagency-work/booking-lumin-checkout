-- V8 owner history and explicit rollback; publication epochs prevent token revival.
begin;
create table public.paid_journey_publication_generations(
 tenant_id uuid not null,flow_id uuid primary key,generation bigint not null check(generation>0),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
create table public.paid_journey_session_generations(
 token_hash text primary key references public.paid_journey_sessions(token_hash),
 tenant_id uuid not null,flow_id uuid not null,generation bigint not null check(generation>0),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
alter table public.paid_journey_publication_generations enable row level security;
alter table public.paid_journey_publication_generations force row level security;
alter table public.paid_journey_session_generations enable row level security;
alter table public.paid_journey_session_generations force row level security;
revoke all on public.paid_journey_publication_generations,public.paid_journey_session_generations from public,anon,authenticated,service_role;
-- Fence existing inserts and pointer writers while backfilling immutable provenance.
lock table public.flows in share row exclusive mode;
lock table public.paid_journey_sessions in share row exclusive mode;
insert into public.paid_journey_publication_generations select tenant_id,id,1 from public.flows;
insert into public.paid_journey_session_generations select s.token_hash,s.tenant_id,s.flow_id,g.generation from public.paid_journey_sessions s join public.paid_journey_publication_generations g on g.flow_id=s.flow_id and g.tenant_id=s.tenant_id;
create trigger journey_session_generation_immutable before update or delete on public.paid_journey_session_generations for each row execute function lumin.reject_flow_version_mutation();
create function lumin.advance_journey_publication_generation() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='INSERT' then
  insert into public.paid_journey_publication_generations values(new.tenant_id,new.id,1);
 elsif new.published_version_id is distinct from old.published_version_id then
  update public.paid_journey_publication_generations set generation=generation+1 where tenant_id=new.tenant_id and flow_id=new.id;
  if not found then raise exception 'JOURNEY_GENERATION_MISSING' using errcode='55000';end if;
 end if;
 return new;
end$$;
revoke all on function lumin.advance_journey_publication_generation() from public,anon,authenticated,service_role;
create trigger journey_publication_generation after insert or update of published_version_id on public.flows for each row execute function lumin.advance_journey_publication_generation();
create function lumin.bind_journey_session_generation() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- Existing session provenance guard holds the current flow FOR SHARE until commit.
 insert into public.paid_journey_session_generations select new.token_hash,new.tenant_id,new.flow_id,generation from public.paid_journey_publication_generations where tenant_id=new.tenant_id and flow_id=new.flow_id;
 if not found then raise exception 'JOURNEY_GENERATION_MISSING' using errcode='55000';end if;
 return new;
end$$;
revoke all on function lumin.bind_journey_session_generation() from public,anon,authenticated,service_role;
create trigger journey_session_generation after insert on public.paid_journey_sessions for each row execute function lumin.bind_journey_session_generation();
create or replace function public.resolve_paid_journey_session(p_hash text,p_origin text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_sessions;c jsonb;
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or not lumin.flow_origins_storage_valid(jsonb_build_array(p_origin)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into s from public.paid_journey_sessions where token_hash=p_hash;
 if not found or s.origin<>p_origin or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 c:=lumin.paid_journey_session_context(s.installation_id,p_origin);
 if not exists(select 1 from public.paid_journey_session_generations sg join public.paid_journey_publication_generations g on g.tenant_id=sg.tenant_id and g.flow_id=sg.flow_id and g.generation=sg.generation where sg.token_hash=s.token_hash and sg.tenant_id=s.tenant_id and sg.flow_id=s.flow_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if row(s.tenant_id,s.flow_id,s.version_id,s.service_id) is distinct from row((c->>'tenantId')::uuid,(c->>'flowId')::uuid,(c->>'versionId')::uuid,(c->>'serviceId')::uuid) or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('schemaVersion',1,'installationId',s.installation_id,'expiresAt',s.expires_at,'render',c->'render');
end$$;
create function public.owner_paid_journey_version_history(p_actor uuid,p_tenant uuid,p_flow uuid,p_approved_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows;v public.flow_versions;b public.bound_flow_versions;i public.flow_installations;service jsonb;versions jsonb:='[]';publication jsonb;total integer;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or not lumin.flow_origins_storage_valid(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active';
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id and render_schema_version=8;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 -- Catalog before flow, matching publish and customer session lock order.
 perform lumin.paid_journey_service(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid,v.journey_snapshot#>'{form,journey}');
 service:=lumin.paid_simple_service(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid);
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status='active' and published_version_id=f.published_version_id for share;
 if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 select count(*) into total from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow;
 if total=0 or total>50 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 for v in select * from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow order by source_revision desc,id loop
  if v.render_schema_version<>8 or not lumin.paid_journey_snapshot_valid(v.journey_snapshot) or v.config is distinct from jsonb_build_object('key','paid_journey','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',v.journey_snapshot#>>'{service,name}'))) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
  select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
  if not found or b.service_id::text is distinct from v.journey_snapshot#>>'{service,id}' or b.service_snapshot is distinct from v.journey_snapshot->'service' then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
  publication:=null;
  select installation.* into i from public.paid_journey_publications p join public.flow_installations installation on installation.id=p.installation_id and installation.tenant_id=p.tenant_id and installation.flow_id=p.flow_id and installation.version_id=p.version_id where p.tenant_id=p_tenant and p.flow_id=p_flow and p.version_id=v.id;
  if found and (select count(*) from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id)=1 and lumin.flow_origins_storage_valid(i.allowed_origins) and i.allowed_origins<@p_approved_origins and b.service_snapshot=service then
   publication:=jsonb_build_object('versionId',v.id,'installationId',i.id,'renderSchemaVersion',8,'hostedPath','/checkout/flow/'||i.id::text);
  end if;
  versions:=versions||jsonb_build_array(jsonb_build_object('versionId',v.id,'draftRevision',v.source_revision,'name',v.journey_snapshot#>>'{form,name}','journey',v.journey_snapshot#>'{form,journey}','presentation',v.journey_snapshot#>'{form,presentation}','current',v.id=f.published_version_id,'publication',publication));
 end loop;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'flowId',p_flow,'versions',versions);
end$$;
revoke all on function public.owner_paid_journey_version_history(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.owner_paid_journey_version_history(uuid,uuid,uuid,jsonb) to service_role;
create function public.rollback_paid_journey_publication(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected uuid,p_target uuid,p_approved_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows;current_v public.flow_versions;target_v public.flow_versions;b public.bound_flow_versions;i public.flow_installations;service jsonb;v public.flow_versions;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_expected is null or p_target is null or not lumin.flow_origins_storage_valid(p_approved_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_expected=p_target then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active';
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if f.published_version_id is distinct from p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into current_v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_expected and render_schema_version=8;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_journey_service(p_tenant,(current_v.journey_snapshot#>>'{service,id}')::uuid,current_v.journey_snapshot#>'{form,journey}');
 service:=lumin.paid_simple_service(p_tenant,(current_v.journey_snapshot#>>'{service,id}')::uuid);
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for update;
 if not found or f.published_version_id is distinct from p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into target_v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=p_target and render_schema_version=8 for update;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if target_v.source_revision>=current_v.source_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 foreach v in array array[current_v,target_v] loop
  if not lumin.paid_journey_snapshot_valid(v.journey_snapshot) or v.journey_snapshot->'service' is distinct from service or v.config is distinct from jsonb_build_object('key','paid_journey','steps',jsonb_build_array(jsonb_build_object('key','service','kind','info','title',service->>'name'))) then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
  perform lumin.paid_journey_service(p_tenant,(v.journey_snapshot#>>'{service,id}')::uuid,v.journey_snapshot#>'{form,journey}');
  select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
  if not found or b.service_id::text is distinct from service->>'id' or b.service_snapshot is distinct from service then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 end loop;
 if not exists(select 1 from public.bound_flow_services where tenant_id=p_tenant and flow_id=p_flow and service_id=b.service_id) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select installation.* into i from public.paid_journey_publications p join public.flow_installations installation on installation.id=p.installation_id and installation.tenant_id=p.tenant_id and installation.flow_id=p.flow_id and installation.version_id=p.version_id where p.tenant_id=p_tenant and p.flow_id=p_flow and p.version_id=p_target for share of installation;
 if not found or (select count(*) from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=p_target)<>1 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if not lumin.flow_origins_storage_valid(i.allowed_origins) or not(i.allowed_origins<@p_approved_origins) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 update public.flows set name=target_v.journey_snapshot#>>'{form,name}',published_version_id=p_target where tenant_id=p_tenant and id=p_flow and published_version_id=p_expected;
 if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'flowId',p_flow,'draftRevision',target_v.source_revision,'versionId',p_target,'installationId',i.id,'renderSchemaVersion',8,'hostedPath','/checkout/flow/'||i.id::text);
end$$;
revoke all on function public.rollback_paid_journey_publication(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.rollback_paid_journey_publication(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
