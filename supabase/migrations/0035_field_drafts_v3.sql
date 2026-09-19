-- Additive nonpublishable V3 definitions; no answers, conversion or public activation.
begin;
-- Match supported parent-before-child writers; freeze the family handoff atomically.
lock table public.flows in share row exclusive mode;
lock table public.flow_drafts in share row exclusive mode;
lock table public.text_field_drafts in share row exclusive mode;
lock table public.field_drafts_v2 in share row exclusive mode;
lock table public.field_draft_families in share row exclusive mode;
alter table public.field_draft_families drop constraint field_draft_families_family_check;
alter table public.field_draft_families add constraint field_draft_families_family_check check(family in(1,2,3));
create function lumin.field_definition_v3_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb; c jsonb; k text; ids text[]; seen text[]:=array[]::text[]; total integer:=0; probe jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>32768 then return false; end if;
 if (p-array['schemaVersion','fields'])<>'{}'::jsonb or p->'schemaVersion' is distinct from '3'::jsonb or jsonb_typeof(p->'fields') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'fields')>64 then return false; end if;
 for f in select value from jsonb_array_elements(p->'fields') loop
  if jsonb_typeof(f)<>'object' or jsonb_typeof(f->'key') is distinct from 'string' then return false; end if;
  k:=f->>'key';
  if k=any(seen) then return false; end if;
  seen:=array_append(seen,k);
  if f->'kind' is distinct from '"dropdown"'::jsonb then
   if not lumin.field_definition_v2_valid(jsonb_build_object('schemaVersion',2,'fields',jsonb_build_array(f))) then return false; end if;
  else
   if (f-array['key','kind','required','prompt','choices'])<>'{}'::jsonb or jsonb_typeof(f->'choices') is distinct from 'array' then return false; end if;
   -- Reuse exact V2 key, boolean and optional prompt policy without changing V2.
   probe:=(f-'choices')||jsonb_build_object('kind','text','minLength',0,'maxLength',1);
   if not lumin.field_definition_v2_valid(jsonb_build_object('schemaVersion',2,'fields',jsonb_build_array(probe))) then return false; end if;
   if jsonb_array_length(f->'choices') not between 1 and 32 then return false; end if;
   total:=total+jsonb_array_length(f->'choices'); if total>256 then return false; end if;
   ids:=array[]::text[];
   for c in select value from jsonb_array_elements(f->'choices') loop
    if jsonb_typeof(c)<>'object' or (c-array['id','label'])<>'{}'::jsonb or jsonb_typeof(c->'id') is distinct from 'string' or jsonb_typeof(c->'label') is distinct from 'string' then return false; end if;
    if c->>'id'=any(ids) then return false; end if;
    ids:=array_append(ids,c->>'id');
    probe:=jsonb_build_object('key',c->'id','kind','text','required',false,'minLength',0,'maxLength',1,'prompt',c->'label');
    if not lumin.field_definition_v2_valid(jsonb_build_object('schemaVersion',2,'fields',jsonb_build_array(probe))) then return false; end if;
   end loop;
  end if;
 end loop;
 return true;
end $$;
create table public.field_drafts_v3 (
 tenant_id uuid not null, flow_id uuid not null,
 draft_revision bigint not null check(draft_revision between 1 and 9007199254740991),
 saved_parent_revision bigint not null check(saved_parent_revision between 1 and 9007199254740991),
 definition jsonb not null check(lumin.field_definition_v3_valid(definition)),
 primary key(tenant_id,flow_id), foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
alter table public.field_drafts_v3 enable row level security;
alter table public.field_drafts_v3 force row level security;
revoke all on public.field_drafts_v3 from public,anon,authenticated,service_role;
create or replace function lumin.check_field_family(t uuid,f uuid,wanted smallint,claim boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare actual smallint;
begin
 if wanted not in(1,2,3) or wanted is null then raise exception 'FIELD_DRAFT_FAMILY_INVALID' using errcode='22023'; end if;
 if claim then
  insert into public.field_draft_families(tenant_id,flow_id,family) values(t,f,wanted)
  on conflict(tenant_id,flow_id) do update set family=public.field_draft_families.family
  returning family into actual;
 else
  select family into actual from public.field_draft_families where tenant_id=t and flow_id=f for share;
 end if;
 if (actual is not null and actual<>wanted)
  or (wanted<>1 and exists(select 1 from public.text_field_drafts where tenant_id=t and flow_id=f))
  or (wanted<>2 and exists(select 1 from public.field_drafts_v2 where tenant_id=t and flow_id=f))
  or (wanted<>3 and exists(select 1 from public.field_drafts_v3 where tenant_id=t and flow_id=f)) then
  raise exception 'FIELD_DRAFT_FAMILY_CONFLICT' using errcode='23514'; end if;
end $$;
create trigger field_v3_family_guard before insert or update on public.field_drafts_v3 for each row execute function lumin.guard_field_sidecar('3');
create function lumin.field_draft_v3_receipt(d public.field_drafts_v3,current_revision bigint) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('fieldDraftVersion',3,'parentAuthoringVersion',2,
 'draftRevision',d.draft_revision,'savedParentRevision',d.saved_parent_revision,
 'currentParentRevision',current_revision,'definition',d.definition,'runtimePublishable',false)
$$;

create function public.get_field_draft_v3(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.field_drafts_v3;
begin
 -- Match existing flow mutation lock order: tenant/member, flow, child rows.
 perform lumin.flow_actor(p_actor,p_tenant,true);
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for share;
 if not found then raise exception 'FIELD_DRAFT_V3_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'FIELD_DRAFT_V3_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 perform lumin.check_field_family(p_tenant,p_flow,3::smallint,false);
 select * into sidecar from public.field_drafts_v3 where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then return jsonb_build_object('status','missing','fieldDraftVersion',3,'parentAuthoringVersion',2,'currentParentRevision',parent.revision,'runtimePublishable',false); end if;
 if sidecar.saved_parent_revision>parent.revision then raise exception 'FIELD_DRAFT_V3_PARENT_HISTORY' using errcode='23514'; end if;
 return jsonb_build_object('status','present','receipt',lumin.field_draft_v3_receipt(sidecar,parent.revision));
end $$;

create function public.save_field_draft_v3(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_expected_flow_revision bigint,p_definition jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.field_drafts_v3;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991
  or p_expected_flow_revision is null or p_expected_flow_revision not between 1 and 9007199254740991
  or not lumin.field_definition_v3_valid(p_definition) then raise exception 'FIELD_DRAFT_V3_INVALID' using errcode='22023'; end if;
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for update;
 if not found then raise exception 'FIELD_DRAFT_V3_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'FIELD_DRAFT_V3_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 perform lumin.check_field_family(p_tenant,p_flow,3::smallint,true);
 if parent.revision<>p_expected_flow_revision then raise exception 'FIELD_DRAFT_V3_PARENT_CONFLICT' using errcode='40001'; end if;
 select * into sidecar from public.field_drafts_v3 where tenant_id=p_tenant and flow_id=p_flow for update;
 if p_expected_revision=0 then
  if found then raise exception 'FIELD_DRAFT_V3_REVISION_CONFLICT' using errcode='40001'; end if;
  insert into public.field_drafts_v3(tenant_id,flow_id,draft_revision,saved_parent_revision,definition)
   values(p_tenant,p_flow,1,parent.revision,p_definition) returning * into sidecar;
 else
  if not found or sidecar.draft_revision<>p_expected_revision then raise exception 'FIELD_DRAFT_V3_REVISION_CONFLICT' using errcode='40001'; end if;
  if sidecar.saved_parent_revision>parent.revision then raise exception 'FIELD_DRAFT_V3_PARENT_HISTORY' using errcode='23514'; end if;
  -- MAX_SAFE_INTEGER is a valid revision token, but it cannot be incremented.
  if sidecar.draft_revision=9007199254740991 then raise exception 'FIELD_DRAFT_V3_REVISION_EXHAUSTED' using errcode='22023'; end if;
  update public.field_drafts_v3 set draft_revision=draft_revision+1,saved_parent_revision=parent.revision,definition=p_definition
   where tenant_id=p_tenant and flow_id=p_flow returning * into sidecar;
 end if;
 return lumin.field_draft_v3_receipt(sidecar,parent.revision);
end $$;

revoke all on function lumin.field_definition_v3_valid(jsonb),lumin.field_draft_v3_receipt(public.field_drafts_v3,bigint),public.get_field_draft_v3(uuid,uuid,uuid),public.save_field_draft_v3(uuid,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_field_draft_v3(uuid,uuid,uuid),public.save_field_draft_v3(uuid,uuid,uuid,bigint,bigint,jsonb) to service_role;
-- Shared helper replacement retains owner, SECURITY DEFINER, search path and ACL.
-- Existing V1/V2 RPC bodies and immutable sticky-family trigger remain untouched.
commit;
