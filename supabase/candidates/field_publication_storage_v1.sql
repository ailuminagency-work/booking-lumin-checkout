-- Unregistered storage candidate. Apply only to explicitly disposable test databases.
-- No legacy publication, runtime, installation, session or active pointer is changed.
begin;
create function lumin.field_publication_v1_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare k text; n numeric;
begin
 if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536 then return false; end if;
 if (p-array['fieldPublicationVersion','tenantId','flowId','versionId','parentAuthoringVersion','sourceParentRevision','sourceFieldDraftRevision','definition','submissionMode'])<>'{}'::jsonb
  or p->'fieldPublicationVersion' is distinct from '1'::jsonb
  or p->'parentAuthoringVersion' is distinct from '2'::jsonb
  or p->'submissionMode' is distinct from '"unconfirmed_request"'::jsonb then return false; end if;
 foreach k in array array['tenantId','flowId','versionId'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)<>36
   or (p->>k) collate "C" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
 end loop;
 foreach k in array array['sourceParentRevision','sourceFieldDraftRevision'] loop
  if jsonb_typeof(p->k) is distinct from 'number' then return false; end if;
  n:=(p->>k)::numeric;
  if n<>trunc(n) or n not between 1 and 9007199254740991 then return false; end if;
 end loop;
 return lumin.field_definition_v3_valid(p->'definition') is true;
exception when others then return false;
end $$;

create table public.field_publication_versions_v1 (
 version_id uuid primary key,
 tenant_id uuid not null,
 flow_id uuid not null,
 source_parent_revision bigint not null check(source_parent_revision between 1 and 9007199254740991),
 source_field_draft_revision bigint not null check(source_field_draft_revision between 1 and 9007199254740991),
 envelope jsonb not null check(lumin.field_publication_v1_valid(envelope)),
 unique(tenant_id,flow_id,version_id),
 unique(tenant_id,flow_id,source_parent_revision,source_field_draft_revision),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id),
 -- Rows bind exact canonical PostgreSQL UUID spelling, not a normalized caller envelope.
 check(envelope->>'versionId'=version_id::text and envelope->>'tenantId'=tenant_id::text and envelope->>'flowId'=flow_id::text
  and (envelope->>'sourceParentRevision')::numeric=source_parent_revision
  and (envelope->>'sourceFieldDraftRevision')::numeric=source_field_draft_revision)
);
alter table public.field_publication_versions_v1 enable row level security;
alter table public.field_publication_versions_v1 force row level security;
revoke all on public.field_publication_versions_v1 from public,anon,authenticated,service_role;

create function lumin.reject_field_publication_v1_mutation() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 raise exception 'FIELD_PUBLICATION_V1_IMMUTABLE' using errcode='23514';
end $$;
create trigger field_publication_v1_immutable before update or delete on public.field_publication_versions_v1
for each row execute function lumin.reject_field_publication_v1_mutation();

-- The server must derive p_actor from verified authentication. Supplied actor UUID
-- is not an HTTP authentication mechanism. Snapshot content is never caller supplied.
create function public.publish_field_snapshot_v1(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_parent_revision bigint,p_expected_field_revision bigint,p_version uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare parent public.flow_drafts; sidecar public.field_drafts_v3; family smallint; snapshot jsonb;
begin
 -- Match tenant/member -> flow -> parent/family/sidecar ordering of supported writers.
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_version is null or p_expected_parent_revision is null or p_expected_parent_revision not between 1 and 9007199254740991
  or p_expected_field_revision is null or p_expected_field_revision not between 1 and 9007199254740991 then
  raise exception 'FIELD_PUBLICATION_V1_INVALID' using errcode='22023'; end if;
 perform 1 from public.flows where tenant_id=p_tenant and id=p_flow and status<>'archived' for update;
 if not found then raise exception 'FIELD_PUBLICATION_V1_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into parent from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or parent.authoring_version<>2 then raise exception 'FIELD_PUBLICATION_V1_UNSUPPORTED_PARENT' using errcode='0A000'; end if;
 -- Read-only family check: never create, claim or convert a sidecar family here.
 perform lumin.check_field_family(p_tenant,p_flow,3::smallint,false);
 select f.family into family from public.field_draft_families f where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or family<>3 then raise exception 'FIELD_PUBLICATION_V1_UNSUPPORTED_FAMILY' using errcode='0A000'; end if;
 select * into sidecar from public.field_drafts_v3 where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found then raise exception 'FIELD_PUBLICATION_V1_NOT_AVAILABLE' using errcode='P0002'; end if;
 if parent.revision<>p_expected_parent_revision or sidecar.saved_parent_revision<>parent.revision
  or sidecar.draft_revision<>p_expected_field_revision then
  raise exception 'FIELD_PUBLICATION_V1_SOURCE_CONFLICT' using errcode='40001'; end if;
 snapshot:=jsonb_build_object('fieldPublicationVersion',1,'tenantId',p_tenant,'flowId',p_flow,'versionId',p_version,
  'parentAuthoringVersion',2,'sourceParentRevision',parent.revision,'sourceFieldDraftRevision',sidecar.draft_revision,
  'definition',sidecar.definition,'submissionMode','unconfirmed_request');
 begin
  insert into public.field_publication_versions_v1(version_id,tenant_id,flow_id,source_parent_revision,source_field_draft_revision,envelope)
   values(p_version,p_tenant,p_flow,parent.revision,sidecar.draft_revision,snapshot);
 exception when unique_violation then
  -- Explicit conflict policy; a duplicate artifact/source pair is not an idempotent replay.
  raise exception 'FIELD_PUBLICATION_V1_ARTIFACT_CONFLICT' using errcode='40001';
 end;
 return snapshot;
end $$;
revoke all on function lumin.field_publication_v1_valid(jsonb),lumin.reject_field_publication_v1_mutation(),public.publish_field_snapshot_v1(uuid,uuid,uuid,bigint,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.publish_field_snapshot_v1(uuid,uuid,uuid,bigint,bigint,uuid) to service_role;
commit;
