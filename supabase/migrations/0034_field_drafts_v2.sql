-- Additive nonpublishable V2 definitions. No answers, conversion or HTTP activation.
begin;
-- Lock parent before child, matching all supported legacy writers. Backfill and
-- trigger installation are one transaction; no writer can bypass the handoff.
lock table public.flows in share row exclusive mode;
lock table public.flow_drafts in share row exclusive mode;
lock table public.text_field_drafts in share row exclusive mode;
create table public.field_draft_families (
 tenant_id uuid not null, flow_id uuid not null, family smallint not null check(family in(1,2)),
 primary key(tenant_id,flow_id), foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
alter table public.field_draft_families enable row level security;
alter table public.field_draft_families force row level security;
revoke all on public.field_draft_families from public,anon,authenticated,service_role;
insert into public.field_draft_families select tenant_id,flow_id,1 from public.text_field_drafts;
create function lumin.field_definition_v2_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb; k text; seen text[]:=array[]::text[]; lo numeric; hi numeric; question text;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>32768 then return false; end if;
 if (p-array['schemaVersion','fields'])<>'{}'::jsonb or p->'schemaVersion' is distinct from '2'::jsonb or jsonb_typeof(p->'fields') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'fields')>64 then return false; end if;
 for f in select value from jsonb_array_elements(p->'fields') loop
  if jsonb_typeof(f)<>'object' then return false; end if;
  if (f-array['key','kind','required','minLength','maxLength','prompt'])<>'{}'::jsonb
   or jsonb_typeof(f->'key') is distinct from 'string' or (f->'kind' is distinct from '"text"'::jsonb and f->'kind' is distinct from '"textarea"'::jsonb)
   or jsonb_typeof(f->'required') is distinct from 'boolean'
   or jsonb_typeof(f->'minLength') is distinct from 'number' or jsonb_typeof(f->'maxLength') is distinct from 'number' then return false; end if;
  if f ? 'prompt' then
   if jsonb_typeof(f->'prompt') is distinct from 'string' then return false; end if;
   question:=f->>'prompt';
   -- PostgreSQL UTF8 text counts Unicode scalars; JSONB rejects NUL/lone surrogates before this function.
   -- Exact ECMAScript trim set, deliberately excluding U0085 and U200B.
   if char_length(question) not between 1 and 200
    or position(chr(10) in question)>0 or position(chr(13) in question)>0
    or position(chr(8232) in question)>0 or position(chr(8233) in question)>0
    or btrim(question,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))='' then return false; end if;
  end if;
  k:=f->>'key';
  if length(k) not between 1 and 64 or k collate "C" !~ '^[a-zA-Z][a-zA-Z0-9_]*$' or k in ('__proto__','prototype','constructor') or k=any(seen) then return false; end if;
  seen:=array_append(seen,k); lo:=(f->>'minLength')::numeric; hi:=(f->>'maxLength')::numeric;
  if lo<>trunc(lo) or hi<>trunc(hi) or lo<0 or hi>4096 or lo>hi or (f->'required'='true'::jsonb and hi=0) then return false; end if;
 end loop;
 return true;
end $$;

create table public.field_drafts_v2 (
 tenant_id uuid not null, flow_id uuid not null,
 draft_revision bigint not null check(draft_revision between 1 and 9007199254740991),
 saved_parent_revision bigint not null check(saved_parent_revision between 1 and 9007199254740991),
 definition jsonb not null check(lumin.field_definition_v2_valid(definition)),
 primary key(tenant_id,flow_id), foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
alter table public.field_drafts_v2 enable row level security;
alter table public.field_drafts_v2 force row level security;
revoke all on public.field_drafts_v2 from public,anon,authenticated,service_role;
create function lumin.field_family_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'FIELD_DRAFT_FAMILY_IMMUTABLE' using errcode='23514'; end if;
 if new.tenant_id is distinct from old.tenant_id or new.flow_id is distinct from old.flow_id or new.family is distinct from old.family then
  raise exception 'FIELD_DRAFT_FAMILY_IMMUTABLE' using errcode='23514'; end if;
 return new;
end $$;
create trigger field_family_immutable before update or delete on public.field_draft_families for each row execute function lumin.field_family_immutable();
-- Caller holds the parent flow lock. A unique-key upsert, rather than only an
-- opposite-table SELECT, arbitrates concurrent claims even across stale snapshots.
-- A repeatable-read stale claim must serialize-fail; no family conversion exists.
create function lumin.check_field_family(t uuid,f uuid,wanted smallint,claim boolean) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare actual smallint;
begin
 if wanted not in(1,2) or wanted is null then raise exception 'FIELD_DRAFT_FAMILY_INVALID' using errcode='22023'; end if;
 if claim then
  insert into public.field_draft_families(tenant_id,flow_id,family) values(t,f,wanted)
  on conflict(tenant_id,flow_id) do update set family=public.field_draft_families.family
  returning family into actual;
 else
  select family into actual from public.field_draft_families where tenant_id=t and flow_id=f for share;
 end if;
 if (actual is not null and actual<>wanted)
  or (wanted=1 and exists(select 1 from public.field_drafts_v2 where tenant_id=t and flow_id=f))
  or (wanted=2 and exists(select 1 from public.text_field_drafts where tenant_id=t and flow_id=f)) then
  raise exception 'FIELD_DRAFT_FAMILY_CONFLICT' using errcode='23514'; end if;
end $$;
create function lumin.guard_field_sidecar() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare wanted smallint:=tg_argv[0]::smallint;
begin
 if tg_op='UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.flow_id is distinct from old.flow_id) then
  raise exception 'FIELD_DRAFT_IDENTITY_IMMUTABLE' using errcode='23514'; end if;
 -- Supported RPCs already own these locks. Direct application DML stays revoked.
 perform 1 from public.flows where tenant_id=new.tenant_id and id=new.flow_id for update;
 -- Direct sidecar DML preserves the pre-existing composite foreign-key error.
 if not found then raise exception 'FIELD_DRAFT_PARENT_FK' using errcode='23503'; end if;
 perform 1 from public.flow_drafts where tenant_id=new.tenant_id and flow_id=new.flow_id for share;
 perform lumin.check_field_family(new.tenant_id,new.flow_id,wanted,true);
 return new;
end $$;
create trigger text_field_family_guard before insert or update on public.text_field_drafts for each row execute function lumin.guard_field_sidecar('1');
create trigger field_v2_family_guard before insert or update on public.field_drafts_v2 for each row execute function lumin.guard_field_sidecar('2');
create function lumin.field_draft_v2_receipt(d public.field_drafts_v2,current_revision bigint) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('fieldDraftVersion',2,'parentAuthoringVersion',2,
 'draftRevision',d.draft_revision,'savedParentRevision',d.saved_parent_revision,
 'currentParentRevision',current_revision,'definition',d.definition,'runtimePublishable',false)
$$;

create or replace function public.get_text_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.text_field_drafts;
begin
 -- Match existing flow mutation lock order: tenant/member, flow, child rows.
 perform lumin.flow_actor(p_actor,p_tenant,true);
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for share;
 if not found then raise exception 'TEXT_DRAFT_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'TEXT_DRAFT_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 perform lumin.check_field_family(p_tenant,p_flow,1::smallint,false);
 select * into sidecar from public.text_field_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then return jsonb_build_object('status','missing','textDraftVersion',1,'parentAuthoringVersion',2,'currentParentRevision',parent.revision,'runtimePublishable',false); end if;
 if sidecar.saved_parent_revision>parent.revision then raise exception 'TEXT_DRAFT_PARENT_HISTORY' using errcode='23514'; end if;
 return jsonb_build_object('status','present','receipt',lumin.text_field_draft_receipt(sidecar,parent.revision));
end $$;

create or replace function public.save_text_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_expected_flow_revision bigint,p_definition jsonb) returns jsonb
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
 perform lumin.check_field_family(p_tenant,p_flow,1::smallint,true);
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
create function public.get_field_draft_v2(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.field_drafts_v2;
begin
 -- Match existing flow mutation lock order: tenant/member, flow, child rows.
 perform lumin.flow_actor(p_actor,p_tenant,true);
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for share;
 if not found then raise exception 'FIELD_DRAFT_V2_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'FIELD_DRAFT_V2_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 perform lumin.check_field_family(p_tenant,p_flow,2::smallint,false);
 select * into sidecar from public.field_drafts_v2 where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then return jsonb_build_object('status','missing','fieldDraftVersion',2,'parentAuthoringVersion',2,'currentParentRevision',parent.revision,'runtimePublishable',false); end if;
 if sidecar.saved_parent_revision>parent.revision then raise exception 'FIELD_DRAFT_V2_PARENT_HISTORY' using errcode='23514'; end if;
 return jsonb_build_object('status','present','receipt',lumin.field_draft_v2_receipt(sidecar,parent.revision));
end $$;

create function public.save_field_draft_v2(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_expected_flow_revision bigint,p_definition jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.field_drafts_v2;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991
  or p_expected_flow_revision is null or p_expected_flow_revision not between 1 and 9007199254740991
  or not lumin.field_definition_v2_valid(p_definition) then raise exception 'FIELD_DRAFT_V2_INVALID' using errcode='22023'; end if;
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for update;
 if not found then raise exception 'FIELD_DRAFT_V2_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'FIELD_DRAFT_V2_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 perform lumin.check_field_family(p_tenant,p_flow,2::smallint,true);
 if parent.revision<>p_expected_flow_revision then raise exception 'FIELD_DRAFT_V2_PARENT_CONFLICT' using errcode='40001'; end if;
 select * into sidecar from public.field_drafts_v2 where tenant_id=p_tenant and flow_id=p_flow for update;
 if p_expected_revision=0 then
  if found then raise exception 'FIELD_DRAFT_V2_REVISION_CONFLICT' using errcode='40001'; end if;
  insert into public.field_drafts_v2(tenant_id,flow_id,draft_revision,saved_parent_revision,definition)
   values(p_tenant,p_flow,1,parent.revision,p_definition) returning * into sidecar;
 else
  if not found or sidecar.draft_revision<>p_expected_revision then raise exception 'FIELD_DRAFT_V2_REVISION_CONFLICT' using errcode='40001'; end if;
  if sidecar.saved_parent_revision>parent.revision then raise exception 'FIELD_DRAFT_V2_PARENT_HISTORY' using errcode='23514'; end if;
  -- MAX_SAFE_INTEGER is a valid revision token, but it cannot be incremented.
  if sidecar.draft_revision=9007199254740991 then raise exception 'FIELD_DRAFT_V2_REVISION_EXHAUSTED' using errcode='22023'; end if;
  update public.field_drafts_v2 set draft_revision=draft_revision+1,saved_parent_revision=parent.revision,definition=p_definition
   where tenant_id=p_tenant and flow_id=p_flow returning * into sidecar;
 end if;
 return lumin.field_draft_v2_receipt(sidecar,parent.revision);
end $$;

revoke all on function lumin.field_definition_v2_valid(jsonb),lumin.field_family_immutable(),lumin.check_field_family(uuid,uuid,smallint,boolean),lumin.guard_field_sidecar(),lumin.field_draft_v2_receipt(public.field_drafts_v2,bigint),public.get_field_draft_v2(uuid,uuid,uuid),public.save_field_draft_v2(uuid,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_field_draft_v2(uuid,uuid,uuid),public.save_field_draft_v2(uuid,uuid,uuid,bigint,bigint,jsonb) to service_role;
-- CREATE OR REPLACE retained both legacy RPC owners, attributes and ACLs.
commit;
