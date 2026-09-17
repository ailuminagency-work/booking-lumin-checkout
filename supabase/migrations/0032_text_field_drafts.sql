-- Owner-only, non-publishable text-definition sidecars. No answers or public runtime.
-- Existing flow drafts, publications and sessions remain unchanged.
begin;
create function lumin.text_field_definition_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb; k text; seen text[]:=array[]::text[]; lo numeric; hi numeric;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>32768 then return false; end if;
 if (p-array['schemaVersion','fields'])<>'{}'::jsonb or p->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p->'fields') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'fields')>64 then return false; end if;
 for f in select value from jsonb_array_elements(p->'fields') loop
  if jsonb_typeof(f)<>'object' then return false; end if;
  if (f-array['key','kind','required','minLength','maxLength'])<>'{}'::jsonb
   or jsonb_typeof(f->'key') is distinct from 'string' or f->'kind' is distinct from '"text"'::jsonb
   or jsonb_typeof(f->'required') is distinct from 'boolean'
   or jsonb_typeof(f->'minLength') is distinct from 'number' or jsonb_typeof(f->'maxLength') is distinct from 'number' then return false; end if;
  k:=f->>'key';
  if length(k) not between 1 and 64 or k collate "C" !~ '^[a-zA-Z][a-zA-Z0-9_]*$' or k in ('__proto__','prototype','constructor') or k=any(seen) then return false; end if;
  seen:=array_append(seen,k); lo:=(f->>'minLength')::numeric; hi:=(f->>'maxLength')::numeric;
  if lo<>trunc(lo) or hi<>trunc(hi) or lo<0 or hi>4096 or lo>hi or (f->'required'='true'::jsonb and hi=0) then return false; end if;
 end loop;
 return true;
end $$;

create table public.text_field_drafts (
 tenant_id uuid not null, flow_id uuid not null,
 draft_revision bigint not null check(draft_revision between 1 and 9007199254740991),
 saved_parent_revision bigint not null check(saved_parent_revision between 1 and 9007199254740991),
 definition jsonb not null check(lumin.text_field_definition_valid(definition)),
 primary key(tenant_id,flow_id),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
alter table public.text_field_drafts enable row level security;
alter table public.text_field_drafts force row level security;
-- No permissive policies: all application roles use the narrowly granted RPCs.
revoke all on public.text_field_drafts from public,anon,authenticated,service_role;

-- Raw receipt deliberately omits stale. The strict typed client derives it from
-- savedParentRevision/currentParentRevision and rejects a supplied stale flag.
create function lumin.text_field_draft_receipt(d public.text_field_drafts,current_revision bigint) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('textDraftVersion',1,'parentAuthoringVersion',2,
 'draftRevision',d.draft_revision,'savedParentRevision',d.saved_parent_revision,
 'currentParentRevision',current_revision,'definition',d.definition,'runtimePublishable',false)
$$;

create function public.get_text_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.text_field_drafts;
begin
 -- Match existing flow mutation lock order: tenant/member, flow, child rows.
 perform lumin.flow_actor(p_actor,p_tenant,true);
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for share;
 if not found then raise exception 'TEXT_DRAFT_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'TEXT_DRAFT_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 select * into sidecar from public.text_field_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then return jsonb_build_object('status','missing','textDraftVersion',1,'parentAuthoringVersion',2,'currentParentRevision',parent.revision,'runtimePublishable',false); end if;
 if sidecar.saved_parent_revision>parent.revision then raise exception 'TEXT_DRAFT_PARENT_HISTORY' using errcode='23514'; end if;
 return jsonb_build_object('status','present','receipt',lumin.text_field_draft_receipt(sidecar,parent.revision));
end $$;

create function public.save_text_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_expected_flow_revision bigint,p_definition jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.text_field_drafts;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991
  or p_expected_flow_revision is null or p_expected_flow_revision not between 1 and 9007199254740991
  or not lumin.text_field_definition_valid(p_definition) then raise exception 'TEXT_DRAFT_INVALID' using errcode='22023'; end if;
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for update;
 if not found then raise exception 'TEXT_DRAFT_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'TEXT_DRAFT_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 if parent.revision<>p_expected_flow_revision then raise exception 'TEXT_DRAFT_PARENT_CONFLICT' using errcode='40001'; end if;
 select * into sidecar from public.text_field_drafts where tenant_id=p_tenant and flow_id=p_flow for update;
 if p_expected_revision=0 then
  if found then raise exception 'TEXT_DRAFT_REVISION_CONFLICT' using errcode='40001'; end if;
  insert into public.text_field_drafts(tenant_id,flow_id,draft_revision,saved_parent_revision,definition)
   values(p_tenant,p_flow,1,parent.revision,p_definition) returning * into sidecar;
 else
  if not found or sidecar.draft_revision<>p_expected_revision then raise exception 'TEXT_DRAFT_REVISION_CONFLICT' using errcode='40001'; end if;
  if sidecar.saved_parent_revision>parent.revision then raise exception 'TEXT_DRAFT_PARENT_HISTORY' using errcode='23514'; end if;
  -- MAX_SAFE_INTEGER is a valid revision token, but it cannot be incremented.
  if sidecar.draft_revision=9007199254740991 then raise exception 'TEXT_DRAFT_REVISION_EXHAUSTED' using errcode='22023'; end if;
  update public.text_field_drafts set draft_revision=draft_revision+1,saved_parent_revision=parent.revision,definition=p_definition
   where tenant_id=p_tenant and flow_id=p_flow returning * into sidecar;
 end if;
 return lumin.text_field_draft_receipt(sidecar,parent.revision);
end $$;

revoke all on function lumin.text_field_definition_valid(jsonb),lumin.text_field_draft_receipt(public.text_field_drafts,bigint),public.get_text_field_draft(uuid,uuid,uuid),public.save_text_field_draft(uuid,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_text_field_draft(uuid,uuid,uuid),public.save_text_field_draft(uuid,uuid,uuid,bigint,bigint,jsonb) to service_role;
commit;
