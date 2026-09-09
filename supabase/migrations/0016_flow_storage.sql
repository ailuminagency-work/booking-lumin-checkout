-- Flow storage only. No public config access or live publication endpoint.
-- Action API MUST validate/normalize WorkflowConfig, trusted required policy,
-- references and publisher authorization before invoking service-role publication.
-- SQL validates storage shape/budget/binding; it is not the full workflow DSL.
begin;

create function lumin.flow_config_storage_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare s jsonb;
begin
 if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 262144 then return false; end if;
 if (p - array['key','steps']) <> '{}'::jsonb or jsonb_typeof(p->'key') is distinct from 'string'
    or length(p->>'key') not between 1 and 200 or jsonb_typeof(p->'steps') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'steps') not between 1 and 100 then return false; end if;
 for s in select value from jsonb_array_elements(p->'steps') loop
  if jsonb_typeof(s) <> 'object' or (s - array['key','questionKey','kind','title','visibleWhen','required','requiredWhen','disqualify','warn','recommend','pricingEffect']) <> '{}'::jsonb
     or jsonb_typeof(s->'key') is distinct from 'string' or length(s->>'key') not between 1 and 200
     or coalesce(s->>'kind','question') not in ('question','info','warning')
     or (s ? 'kind' and jsonb_typeof(s->'kind') <> 'string')
     or (s ? 'required' and jsonb_typeof(s->'required') <> 'boolean') then return false; end if;
  if coalesce(s->>'kind','question') = 'question' and
     (jsonb_typeof(s->'questionKey') is distinct from 'string' or length(s->>'questionKey') not between 1 and 200) then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function lumin.flow_config_storage_valid(jsonb) from public, anon, authenticated;

create table public.flows (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 name text not null check(length(name) between 1 and 200),
 status text not null default 'draft' check(status in ('draft','active','archived')),
 published_version_id uuid,
 unique(tenant_id,id)
);
create table public.flow_drafts (
 tenant_id uuid not null,
 flow_id uuid not null,
 revision bigint not null check(revision between 1 and 9007199254740991),
 config jsonb not null check(lumin.flow_config_storage_valid(config)),
 primary key(tenant_id,flow_id),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
create table public.flow_versions (
 id uuid primary key,
 tenant_id uuid not null,
 flow_id uuid not null,
 source_revision bigint not null check(source_revision between 1 and 9007199254740991),
 schema_version integer not null default 1 check(schema_version=1),
 submission_mode text not null check(submission_mode='unconfirmed_request'),
 config jsonb not null check(lumin.flow_config_storage_valid(config)),
 unique(tenant_id,flow_id,id),
 unique(tenant_id,flow_id,source_revision),
 foreign key(tenant_id,flow_id) references public.flows(tenant_id,id)
);
alter table public.flows add constraint flows_published_version_fk
 foreign key(tenant_id,id,published_version_id) references public.flow_versions(tenant_id,flow_id,id);
-- Conservative canonical HTTPS DNS origins (no IP literal or default :443).
create function lumin.flow_origins_storage_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare origin jsonb; value text; port text;
begin
 if p is null or jsonb_typeof(p)<>'array' or octet_length(p::text)>8192 then return false; end if;
 if jsonb_array_length(p) not between 1 and 20 then return false; end if;
 for origin in select v from jsonb_array_elements(p) as e(v) loop
  value := origin #>> '{}';
  if jsonb_typeof(origin)<>'string' or value !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[1-9][0-9]{0,4})?$' then return false; end if;
  port := substring(value from ':([0-9]+)$');
  if port is not null and (port::integer > 65535 or port::integer=443) then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function lumin.flow_origins_storage_valid(jsonb) from public,anon,authenticated;
create table public.flow_installations (
 id uuid primary key,
 tenant_id uuid not null,
 flow_id uuid not null,
 version_id uuid not null,
 allowed_origins jsonb not null,
 foreign key(tenant_id,flow_id,version_id) references public.flow_versions(tenant_id,flow_id,id),
 check(lumin.flow_origins_storage_valid(allowed_origins))
);
create index flow_installations_version_idx on public.flow_installations(tenant_id,flow_id,version_id);

create function lumin.reject_flow_version_mutation() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'FLOW_VERSION_IMMUTABLE' using errcode='55000'; end $$;
revoke all on function lumin.reject_flow_version_mutation() from public,anon,authenticated;
create trigger flow_versions_immutable before update or delete on public.flow_versions
for each row execute function lumin.reject_flow_version_mutation();

alter table public.flows enable row level security;
alter table public.flows force row level security;
alter table public.flow_drafts enable row level security;
alter table public.flow_drafts force row level security;
alter table public.flow_versions enable row level security;
alter table public.flow_versions force row level security;
alter table public.flow_installations enable row level security;
alter table public.flow_installations force row level security;
create policy flows_member_read on public.flows for select to authenticated using(lumin.is_tenant_member(tenant_id));
create policy flow_drafts_member_read on public.flow_drafts for select to authenticated using(lumin.is_tenant_member(tenant_id));
create policy flow_versions_member_read on public.flow_versions for select to authenticated using(lumin.is_tenant_member(tenant_id));
create policy flow_installations_member_read on public.flow_installations for select to authenticated using(lumin.is_tenant_member(tenant_id));
-- Revoke even Supabase default table grants: all writes use narrowly scoped RPCs.
revoke all on public.flows,public.flow_drafts,public.flow_versions,public.flow_installations from public,anon,authenticated,service_role;
grant select on public.flows,public.flow_drafts,public.flow_versions,public.flow_installations to authenticated,service_role;

-- expected_revision=0 creates a flow. Existing drafts increment atomically.
create function public.save_flow_draft(p_tenant_id uuid,p_flow_id uuid,p_name text,p_expected_revision bigint,p_config jsonb)
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v_revision bigint;
begin
 if not lumin.tenant_is_active(p_tenant_id) then raise exception 'FLOW_TENANT_INACTIVE' using errcode='42501'; end if;
 if lumin.tenant_role(p_tenant_id) is distinct from 'BUSINESS_OWNER' then raise exception 'FLOW_OWNER_REQUIRED' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991 then raise exception 'FLOW_REVISION_INVALID' using errcode='22023'; end if;
 if p_expected_revision=0 then
  insert into public.flows(id,tenant_id,name) values(p_flow_id,p_tenant_id,p_name);
  insert into public.flow_drafts values(p_tenant_id,p_flow_id,1,p_config);
  return 1;
 end if;
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_NOT_EDITABLE' using errcode='40001'; end if;
 update public.flow_drafts set revision=revision+1,config=p_config
 where tenant_id=p_tenant_id and flow_id=p_flow_id and revision=p_expected_revision returning revision into v_revision;
 if not found then raise exception 'FLOW_REVISION_CONFLICT' using errcode='40001'; end if;
 update public.flows set name=p_name where tenant_id=p_tenant_id and id=p_flow_id;
 return v_revision;
end $$;
revoke all on function public.save_flow_draft(uuid,uuid,text,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_flow_draft(uuid,uuid,text,bigint,jsonb) to authenticated;

-- Trusted Action API only. p_config must be the validated, normalized stored draft.
-- Normalize schema defaults BEFORE save_flow_draft; publication compares exact JSON.
-- Flow lock serializes save and publish. A revision can publish once; retries fail
-- closed and caller may read the pinned version to reconcile, never overwrite it.
create function public.publish_flow_version(p_tenant_id uuid,p_flow_id uuid,p_expected_revision bigint,p_version_id uuid,p_installation_id uuid,p_config jsonb,p_allowed_origins jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare d public.flow_drafts;
begin
 if not lumin.tenant_is_active(p_tenant_id) then raise exception 'FLOW_TENANT_INACTIVE' using errcode='42501'; end if;
 perform 1 from public.flows where tenant_id=p_tenant_id and id=p_flow_id and status<>'archived' for update;
 if not found then raise exception 'FLOW_NOT_PUBLISHABLE' using errcode='40001'; end if;
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
revoke all on function public.publish_flow_version(uuid,uuid,bigint,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_flow_version(uuid,uuid,bigint,uuid,uuid,jsonb,jsonb) to service_role;
commit;
