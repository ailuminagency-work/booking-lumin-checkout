-- T2-S1 only: no sessions, requests or production deployment profiles.
begin;
create function lumin.mode_origin(p text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare authority text;host text;port text;label text;labels text[];
begin
 if p is null or octet_length(p) not between 1 and 300 or p !~ '^https://' or p ~ '[^\x01-\x7f]' then return false;end if;
 authority:=substring(p from 9);if authority ~ '[^a-z0-9.:-]' or authority ~ '^[^:]*:[^:]*:' then return false;end if;
 host:=split_part(authority,':',1);port:=case when position(':' in authority)>0 then split_part(authority,':',2) end;
 if length(host) not between 1 and 253 then return false;end if;labels:=string_to_array(host,'.');
 foreach label in array labels loop
  if length(label) not between 1 and 63 or label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' or label like 'xn--%' then return false;end if;
 end loop;
 label:=labels[cardinality(labels)];if label !~ '[a-z]' or label ~ '^0x[0-9a-f]*$' then return false;end if;
 if port is not null and (port !~ '^[1-9][0-9]{0,4}$' or port::integer>65535 or port='443') then return false;end if;
 return p='https://'||host||case when port is null then '' else ':'||port end;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
create function lumin.mode_parents(p jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb;
begin
 if p is null or jsonb_typeof(p)<>'array' or octet_length(convert_to(p::text,'UTF8'))>8192 then raise exception 'MODE_INVALID_ORIGINS' using errcode='22023';end if;
 if jsonb_array_length(p)>20 or exists(select 1 from jsonb_array_elements(p) e where jsonb_typeof(e)<>'string' or not lumin.mode_origin(e#>>'{}')) or (select count(distinct e#>>'{}') from jsonb_array_elements(p) e)<>jsonb_array_length(p) then raise exception 'MODE_INVALID_ORIGINS' using errcode='22023';end if;
 select coalesce(jsonb_agg(e order by (e#>>'{}') collate "C"),'[]') into result from jsonb_array_elements(p) e;return result;
end $$;
create function lumin.mode_parents_valid(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$ begin return coalesce(lumin.mode_parents(p)=p,false);exception when sqlstate '22023' then return false;end $$;
create function lumin.mode_keys(p jsonb,k text[]) returns boolean language sql immutable set search_path=pg_catalog as $$ select coalesce(jsonb_typeof(p)='object' and p-k='{}' and p ?& k,false) $$;
create function lumin.mode_uuid(p jsonb) returns boolean language sql immutable set search_path=pg_catalog as $$ select coalesce(jsonb_typeof(p)='string' and (p#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) $$;
create function lumin.mode_revision(p jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$ declare n numeric;begin if jsonb_typeof(p) is distinct from 'number' then return false;end if;n:=(p#>>'{}')::numeric;return n=trunc(n) and n between 1 and 9007199254740991;end $$;
create function lumin.mode_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$ begin raise exception 'MODE_IMMUTABLE' using errcode='55000';end $$;
create table lumin.installation_profiles(
 version text primary key check(version ~ '^[a-z][a-z0-9-]{0,63}$'),renderer_origin text not null check(lumin.mode_origin(renderer_origin)),api_origin text not null check(lumin.mode_origin(api_origin)),portal_origin text not null check(lumin.mode_origin(portal_origin)),loader_sha256 text not null check(loader_sha256 ~ '^[0-9a-f]{64}$'),check(renderer_origin<>api_origin and renderer_origin<>portal_origin and api_origin<>portal_origin));
create trigger mode_profile_immutable before update or delete on lumin.installation_profiles for each row execute function lumin.mode_immutable();
create table public.mode_flow_installations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,flow_id uuid not null,mode text not null check(mode in('hosted','iframe')),profile_version text not null references lumin.installation_profiles(version),current_version_id uuid not null,
 target_revision bigint not null default 1 check(target_revision between 1 and 9007199254740991),policy_revision bigint not null default 1 check(policy_revision between 1 and 9007199254740991),enabled boolean not null default true,
 allowed_parent_origins jsonb not null check(lumin.mode_parents_valid(allowed_parent_origins)),created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),unique(tenant_id,flow_id,id),foreign key(tenant_id,flow_id) references public.flows(tenant_id,id),foreign key(tenant_id,flow_id,current_version_id) references public.bound_flow_versions(tenant_id,flow_id,version_id),check((mode='hosted' and allowed_parent_origins='[]') or (mode='iframe' and jsonb_array_length(allowed_parent_origins) between 1 and 20)));
create table public.mode_flow_installation_history(
 tenant_id uuid not null,flow_id uuid not null,installation_id uuid not null,sequence bigint not null check(sequence between 1 and 9007199254740991),operation text not null check(operation in('install','apply','policy')),target_revision bigint not null check(target_revision between 1 and 9007199254740991),policy_revision bigint not null check(policy_revision between 1 and 9007199254740991),version_id uuid not null,enabled boolean not null,
 allowed_parent_origins jsonb not null check(lumin.mode_parents_valid(allowed_parent_origins)),created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),primary key(tenant_id,installation_id,sequence),foreign key(tenant_id,flow_id,installation_id) references public.mode_flow_installations(tenant_id,flow_id,id),foreign key(tenant_id,flow_id,version_id) references public.bound_flow_versions(tenant_id,flow_id,version_id),check((sequence=1 and operation='install' and target_revision=1 and policy_revision=1 and enabled) or (sequence>1 and operation in('apply','policy'))));
create trigger mode_history_immutable before update or delete on public.mode_flow_installation_history for each row execute function lumin.mode_immutable();
create function lumin.mode_operation_valid(op text,a uuid,f uuid,p jsonb,r jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare pk text[]:=array['schemaVersion','operation','actorId','flowId'];rk text[]:=pk;changed boolean;
begin
 if op='publish' then pk:=pk||array['expectedDraftRevision'];rk:=rk||array['versionId','sourceRevision','renderSchemaVersion'];
 elsif op='install' then pk:=pk||array['versionId','expectedPublishedVersionId','mode','deploymentProfileVersion','allowedParentOrigins'];rk:=rk||array['installationId','mode','deploymentProfileVersion','currentVersionId','targetRevision','policyRevision','enabled','allowedParentOrigins','changed'];
 elsif op='apply' then pk:=pk||array['installationId','expectedTargetRevision','expectedCurrentVersionId','newVersionId'];rk:=rk||array['installationId','previousVersionId','currentVersionId','targetRevision','policyRevision','changed'];
 elsif op='policy' then pk:=pk||array['installationId','expectedPolicyRevision','enabled','allowedParentOrigins'];rk:=rk||array['installationId','currentVersionId','targetRevision','policyRevision','enabled','allowedParentOrigins','changed'];else return false;end if;
 if not lumin.mode_keys(p,pk) or not lumin.mode_keys(r,rk) or p->'schemaVersion'<>'1' or r->'schemaVersion'<>'1' or p->>'operation' is distinct from op or r->>'operation' is distinct from op or p->'actorId' is distinct from to_jsonb(a::text) or r->'actorId' is distinct from to_jsonb(a::text) or p->'flowId' is distinct from to_jsonb(f::text) or r->'flowId' is distinct from to_jsonb(f::text) then return false;end if;
 if op='publish' then return lumin.mode_revision(p->'expectedDraftRevision') and p->'expectedDraftRevision'=r->'sourceRevision' and lumin.mode_uuid(r->'versionId') and r->'renderSchemaVersion' in('1'::jsonb,'2'::jsonb);end if;
 if not lumin.mode_uuid(r->'installationId') or not lumin.mode_uuid(r->'currentVersionId') or not lumin.mode_revision(r->'targetRevision') or not lumin.mode_revision(r->'policyRevision') or jsonb_typeof(r->'changed') is distinct from 'boolean' then return false;end if;changed:=(r->>'changed')::boolean;
 if op='install' then return lumin.mode_uuid(p->'versionId') and p->'versionId'=p->'expectedPublishedVersionId' and p->'versionId'=r->'currentVersionId' and jsonb_typeof(p->'mode')='string' and p->>'mode' in('hosted','iframe') and p->'mode'=r->'mode' and jsonb_typeof(p->'deploymentProfileVersion')='string' and (p->>'deploymentProfileVersion') ~ '^[a-z][a-z0-9-]{0,63}$' and p->'deploymentProfileVersion'=r->'deploymentProfileVersion' and lumin.mode_parents_valid(p->'allowedParentOrigins') and p->'allowedParentOrigins'=r->'allowedParentOrigins' and r->'targetRevision'='1' and r->'policyRevision'='1' and r->'enabled'='true' and changed;end if;
 if p->'installationId' is distinct from r->'installationId' then return false;end if;
 if op='apply' then return lumin.mode_revision(p->'expectedTargetRevision') and lumin.mode_uuid(p->'expectedCurrentVersionId') and lumin.mode_uuid(p->'newVersionId') and p->'expectedCurrentVersionId'=r->'previousVersionId' and p->'newVersionId'=r->'currentVersionId' and changed=(p->'newVersionId'<>p->'expectedCurrentVersionId') and (r->>'targetRevision')::numeric=(p->>'expectedTargetRevision')::numeric+case when changed then 1 else 0 end;end if;
 return lumin.mode_revision(p->'expectedPolicyRevision') and jsonb_typeof(p->'enabled')='boolean' and p->'enabled'=r->'enabled' and lumin.mode_parents_valid(p->'allowedParentOrigins') and p->'allowedParentOrigins'=r->'allowedParentOrigins' and (r->>'policyRevision')::numeric=(p->>'expectedPolicyRevision')::numeric+case when changed then 1 else 0 end;
end $$;
create table public.mode_flow_owner_operations(
 tenant_id uuid not null,actor_id uuid not null,flow_id uuid not null,operation text not null check(operation in('publish','install','apply','policy')),idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),canonical_payload jsonb not null,payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),receipt jsonb not null,created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),primary key(tenant_id,actor_id,flow_id,operation,idempotency_key),foreign key(tenant_id,flow_id) references public.flows(tenant_id,id),check(jsonb_typeof(canonical_payload)='object' and octet_length(convert_to(canonical_payload::text,'UTF8'))<=16384),check(jsonb_typeof(receipt)='object' and octet_length(convert_to(receipt::text,'UTF8'))<=16384),check(payload_sha256=encode(sha256(convert_to(canonical_payload::text,'UTF8')),'hex')),check(lumin.mode_operation_valid(operation,actor_id,flow_id,canonical_payload,receipt) is true));
create trigger mode_operation_immutable before update or delete on public.mode_flow_owner_operations for each row execute function lumin.mode_immutable();
create function lumin.mode_distribution(m text,p jsonb,v text) returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare profile lumin.installation_profiles;
begin
 select * into profile from lumin.installation_profiles where version=v;if not found or not lumin.mode_parents_valid(p) then return false;end if;
 return coalesce(((m='hosted' and p='[]') or (m='iframe' and jsonb_array_length(p) between 1 and 20)) and not(p ? profile.renderer_origin or p ? profile.api_origin or p ? profile.portal_origin),false);
end $$;
create function lumin.mode_installation_change() returns trigger language plpgsql set search_path=pg_catalog as $$
declare history_sequence bigint;
begin
 if tg_op='DELETE' then raise exception 'MODE_IMMUTABLE' using errcode='55000';end if;
 -- BEFORE the row mutation; RPCs already own flow and installation locks.
 select coalesce(max(sequence),0) into history_sequence from public.mode_flow_installation_history where tenant_id=new.tenant_id and installation_id=new.id;
 if history_sequence>=9007199254740991 then raise exception 'MODE_REVISION_EXHAUSTED' using errcode='54000';end if;
 if not lumin.mode_distribution(new.mode,new.allowed_parent_origins,new.profile_version) then raise exception 'MODE_INVALID_DISTRIBUTION' using errcode='22023';end if;
 if tg_op='INSERT' then
  if new.target_revision<>1 or new.policy_revision<>1 or not new.enabled then raise exception 'MODE_INVALID_INITIAL_STATE' using errcode='23514';end if;
 else
  if row(new.id,new.tenant_id,new.flow_id,new.mode,new.profile_version,new.created_at) is distinct from row(old.id,old.tenant_id,old.flow_id,old.mode,old.profile_version,old.created_at) then raise exception 'MODE_IDENTITY_IMMUTABLE' using errcode='55000';end if;
  if new.current_version_id<>old.current_version_id then
   if row(new.enabled,new.allowed_parent_origins,new.policy_revision) is distinct from row(old.enabled,old.allowed_parent_origins,old.policy_revision) or new.target_revision<>old.target_revision+1 then raise exception 'MODE_INVALID_TARGET_CHANGE' using errcode='23514';end if;
  elsif row(new.enabled,new.allowed_parent_origins) is distinct from row(old.enabled,old.allowed_parent_origins) then
   if new.target_revision<>old.target_revision or new.policy_revision<>old.policy_revision+1 then raise exception 'MODE_INVALID_POLICY_CHANGE' using errcode='23514';end if;
  else raise exception 'MODE_EMPTY_UPDATE' using errcode='23514';end if;
 end if;return new;
end $$;
create trigger mode_installation_change before insert or update or delete on public.mode_flow_installations for each row execute function lumin.mode_installation_change();
create function lumin.mode_history_check() returns trigger language plpgsql set search_path=pg_catalog as $$
declare i public.mode_flow_installations;previous public.mode_flow_installation_history;
begin
 select * into i from public.mode_flow_installations where tenant_id=new.tenant_id and flow_id=new.flow_id and id=new.installation_id for update;
 if not found or row(new.version_id,new.target_revision,new.policy_revision,new.enabled,new.allowed_parent_origins) is distinct from row(i.current_version_id,i.target_revision,i.policy_revision,i.enabled,i.allowed_parent_origins) then raise exception 'MODE_HISTORY_BINDING' using errcode='23514';end if;
 select * into previous from public.mode_flow_installation_history where tenant_id=new.tenant_id and installation_id=new.installation_id order by sequence desc limit 1;
 if not found then
  if new.sequence<>1 or new.operation<>'install' then raise exception 'MODE_HISTORY_INITIAL' using errcode='23514';end if;
 elsif new.sequence<>previous.sequence+1 or (new.operation='apply' and (new.version_id=previous.version_id or new.target_revision<>previous.target_revision+1 or row(new.policy_revision,new.enabled,new.allowed_parent_origins) is distinct from row(previous.policy_revision,previous.enabled,previous.allowed_parent_origins))) or (new.operation='policy' and (row(new.version_id,new.target_revision) is distinct from row(previous.version_id,previous.target_revision) or new.policy_revision<>previous.policy_revision+1 or row(new.enabled,new.allowed_parent_origins) is not distinct from row(previous.enabled,previous.allowed_parent_origins))) or new.operation='install' then raise exception 'MODE_HISTORY_TRANSITION' using errcode='23514';end if;
 return new;
end $$;
create trigger mode_history_check before insert on public.mode_flow_installation_history for each row execute function lumin.mode_history_check();
create function lumin.mode_record_history() returns trigger language plpgsql set search_path=pg_catalog as $$
declare n bigint;op text;
begin
 select coalesce(max(sequence),0) into n from public.mode_flow_installation_history where tenant_id=new.tenant_id and installation_id=new.id;
 if n>=9007199254740991 then raise exception 'MODE_REVISION_EXHAUSTED' using errcode='54000';end if;
 op:=case when tg_op='INSERT' then 'install' when new.current_version_id<>old.current_version_id then 'apply' else 'policy' end;
 insert into public.mode_flow_installation_history(tenant_id,flow_id,installation_id,sequence,operation,target_revision,policy_revision,version_id,enabled,allowed_parent_origins) values(new.tenant_id,new.flow_id,new.id,n+1,op,new.target_revision,new.policy_revision,new.current_version_id,new.enabled,new.allowed_parent_origins);return new;
end $$;
create trigger mode_record_history after insert or update on public.mode_flow_installations for each row execute function lumin.mode_record_history();
create function lumin.mode_receipt_binding() returns trigger language plpgsql set search_path=pg_catalog as $$
declare i public.mode_flow_installations;h public.mode_flow_installation_history;r jsonb:=new.receipt;p jsonb:=new.canonical_payload;
begin
 if not coalesce(lumin.mode_operation_valid(new.operation,new.actor_id,new.flow_id,p,r),false) then raise exception 'MODE_RECEIPT_SHAPE' using errcode='23514';end if;
 if new.operation='publish' then
  if not exists(select 1 from public.flow_versions v join public.bound_flow_versions b on (b.tenant_id,b.flow_id,b.version_id)=(v.tenant_id,v.flow_id,v.id) join public.flows f on (f.tenant_id,f.id)=(v.tenant_id,v.flow_id) where v.tenant_id=new.tenant_id and v.flow_id=new.flow_id and v.id=(r->>'versionId')::uuid and v.source_revision=(r->>'sourceRevision')::bigint and v.render_schema_version=(r->>'renderSchemaVersion')::integer and f.published_version_id=v.id) then raise exception 'MODE_RECEIPT_BINDING' using errcode='23514';end if;return new;
 end if;
 select * into i from public.mode_flow_installations where tenant_id=new.tenant_id and flow_id=new.flow_id and id=(r->>'installationId')::uuid;
 if not found or row(i.current_version_id,i.target_revision,i.policy_revision) is distinct from row((r->>'currentVersionId')::uuid,(r->>'targetRevision')::bigint,(r->>'policyRevision')::bigint) then raise exception 'MODE_RECEIPT_BINDING' using errcode='23514';end if;
 select * into h from public.mode_flow_installation_history where tenant_id=i.tenant_id and installation_id=i.id order by sequence desc limit 1;
 if not found or row(h.version_id,h.target_revision,h.policy_revision,h.enabled,h.allowed_parent_origins) is distinct from row(i.current_version_id,i.target_revision,i.policy_revision,i.enabled,i.allowed_parent_origins) then raise exception 'MODE_RECEIPT_HISTORY' using errcode='23514';end if;
 if new.operation in('install','policy') and row(i.enabled,i.allowed_parent_origins) is distinct from row((r->>'enabled')::boolean,r->'allowedParentOrigins') then raise exception 'MODE_RECEIPT_POLICY' using errcode='23514';end if;
 if new.operation='install' and (h.sequence<>1 or i.mode<>r->>'mode' or i.profile_version<>r->>'deploymentProfileVersion') then raise exception 'MODE_RECEIPT_INSTALL' using errcode='23514';end if;
 if (r->>'changed')::boolean and h.operation<>new.operation then raise exception 'MODE_RECEIPT_TRANSITION' using errcode='23514';end if;
 if new.operation='apply' and (r->>'changed')::boolean and not exists(select 1 from public.mode_flow_installation_history prev where prev.tenant_id=i.tenant_id and prev.installation_id=i.id and prev.sequence=h.sequence-1 and prev.version_id=(p->>'expectedCurrentVersionId')::uuid and prev.target_revision=(p->>'expectedTargetRevision')::bigint) then raise exception 'MODE_RECEIPT_PREVIOUS' using errcode='23514';end if;
 if new.operation='policy' and not (r->>'changed')::boolean and h.policy_revision<>(p->>'expectedPolicyRevision')::bigint then raise exception 'MODE_RECEIPT_NOOP' using errcode='23514';end if;return new;
end $$;
create trigger mode_receipt_binding before insert on public.mode_flow_owner_operations for each row execute function lumin.mode_receipt_binding();
-- These helpers receive no application EXECUTE privilege.
create function lumin.mode_begin(a uuid,t uuid,f uuid,k text) returns void language plpgsql set search_path=pg_catalog as $$
begin
 if a is null or t is null or f is null or k is null or k !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.flow_actor(a,t,true);perform 1 from public.flows where tenant_id=t and id=f and status<>'archived' for update;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;
end $$;
create function lumin.mode_retry(a uuid,t uuid,f uuid,op text,k text,p jsonb) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare old public.mode_flow_owner_operations;
begin
 select * into old from public.mode_flow_owner_operations where tenant_id=t and actor_id=a and flow_id=f and operation=op and idempotency_key=k;if not found then return null;end if;
 if old.canonical_payload is distinct from p or old.payload_sha256<>encode(sha256(convert_to(p::text,'UTF8')),'hex') then raise exception 'MODE_CONFLICT' using errcode='40001';end if;return old.receipt;
end $$;
create function lumin.mode_finish(a uuid,t uuid,f uuid,op text,k text,p jsonb,r jsonb) returns jsonb language plpgsql set search_path=pg_catalog as $$ begin insert into public.mode_flow_owner_operations(tenant_id,actor_id,flow_id,operation,idempotency_key,canonical_payload,payload_sha256,receipt) values(t,a,f,op,k,p,encode(sha256(convert_to(p::text,'UTF8')),'hex'),r);return r;end $$;
create function lumin.mode_target(t uuid,f uuid,v uuid) returns void language plpgsql set search_path=pg_catalog as $$
declare s uuid;schema integer;
begin
 select b.service_id,fv.render_schema_version into s,schema from public.bound_flow_versions b join public.flow_versions fv on (fv.tenant_id,fv.flow_id,fv.id)=(b.tenant_id,b.flow_id,b.version_id) where b.tenant_id=t and b.flow_id=f and b.version_id=v;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;
 if schema not in(1,2) then raise exception 'MODE_UNSUPPORTED' using errcode='0A000';end if;
 perform 1 from public.services where tenant_id=t and id=s and active for share;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;
end $$;
create function public.mode_publish_flow(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_draft_revision bigint,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p jsonb;r jsonb;d public.flow_drafts;s uuid;snap jsonb;render jsonb;v uuid:=gen_random_uuid();
begin
 if p_expected_draft_revision is null or p_expected_draft_revision not between 1 and 9007199254740991 then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;perform lumin.mode_begin(p_actor,p_tenant,p_flow,p_key);
 p:=jsonb_build_object('schemaVersion',1,'operation','publish','actorId',p_actor,'flowId',p_flow,'expectedDraftRevision',p_expected_draft_revision);r:=lumin.mode_retry(p_actor,p_tenant,p_flow,'publish',p_key,p);if r is not null then return r;end if;
 select * into d from public.flow_drafts where tenant_id=p_tenant and flow_id=p_flow;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;
 if d.revision<>p_expected_draft_revision or exists(select 1 from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and source_revision=d.revision) then raise exception 'MODE_CONFLICT' using errcode='40001';end if;
 select service_id into s from public.bound_flow_services where tenant_id=p_tenant and flow_id=p_flow;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;render:=lumin.flow_service_render(p_tenant,s);
 if d.authoring_version=1 then
  perform lumin.require_v1_draft(p_tenant,p_flow);perform lumin.bound_flow_config(d.config,render);insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config) values(v,p_tenant,p_flow,d.revision,'unconfirmed_request',d.config);
 elsif d.authoring_version=2 then
  snap:=lumin.normalize_configurable_publication(render,d.authoring)->'snapshot';render:=snap->'service';insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config,render_schema_version,configurable_snapshot) values(v,p_tenant,p_flow,d.revision,'unconfirmed_request',snap->'config',2,snap);
 else raise exception 'MODE_UNSUPPORTED' using errcode='0A000';end if;
 insert into public.bound_flow_versions values(p_tenant,p_flow,v,s,render);update public.flows set published_version_id=v,status='active' where tenant_id=p_tenant and id=p_flow;
 r:=jsonb_build_object('schemaVersion',1,'operation','publish','actorId',p_actor,'flowId',p_flow,'versionId',v,'sourceRevision',d.revision,'renderSchemaVersion',d.authoring_version);return lumin.mode_finish(p_actor,p_tenant,p_flow,'publish',p_key,p,r);
end $$;
create function public.mode_install_flow(p_actor uuid,p_tenant uuid,p_flow uuid,p_version uuid,p_expected_published_version uuid,p_mode text,p_profile text,p_parent_origins jsonb,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p jsonb;r jsonb;parents jsonb;i public.mode_flow_installations;
begin
 if p_version is null or p_expected_published_version is null or p_mode is null or p_mode not in('hosted','iframe') or p_profile is null or p_profile !~ '^[a-z][a-z0-9-]{0,63}$' then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;
 parents:=lumin.mode_parents(p_parent_origins);perform lumin.mode_begin(p_actor,p_tenant,p_flow,p_key);
 if not exists(select 1 from lumin.installation_profiles where version=p_profile) then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;if not lumin.mode_distribution(p_mode,parents,p_profile) then raise exception 'MODE_INVALID_DISTRIBUTION' using errcode='22023';end if;
 p:=jsonb_build_object('schemaVersion',1,'operation','install','actorId',p_actor,'flowId',p_flow,'versionId',p_version,'expectedPublishedVersionId',p_expected_published_version,'mode',p_mode,'deploymentProfileVersion',p_profile,'allowedParentOrigins',parents);r:=lumin.mode_retry(p_actor,p_tenant,p_flow,'install',p_key,p);if r is not null then return r;end if;
 if p_version<>p_expected_published_version or not exists(select 1 from public.flows where tenant_id=p_tenant and id=p_flow and status='active' and published_version_id=p_expected_published_version) then raise exception 'MODE_CONFLICT' using errcode='40001';end if;perform lumin.mode_target(p_tenant,p_flow,p_version);
 insert into public.mode_flow_installations(tenant_id,flow_id,mode,profile_version,current_version_id,allowed_parent_origins) values(p_tenant,p_flow,p_mode,p_profile,p_version,parents) returning * into i;
 r:=jsonb_build_object('schemaVersion',1,'operation','install','actorId',p_actor,'flowId',p_flow,'installationId',i.id,'mode',i.mode,'deploymentProfileVersion',i.profile_version,'currentVersionId',i.current_version_id,'targetRevision',1,'policyRevision',1,'enabled',true,'allowedParentOrigins',parents,'changed',true);return lumin.mode_finish(p_actor,p_tenant,p_flow,'install',p_key,p,r);
end $$;
create function public.mode_apply_flow_version(p_actor uuid,p_tenant uuid,p_flow uuid,p_installation uuid,p_expected_target_revision bigint,p_expected_version uuid,p_new_version uuid,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p jsonb;r jsonb;i public.mode_flow_installations;changed boolean;
begin
 if p_installation is null or p_expected_version is null or p_new_version is null or p_expected_target_revision is null or p_expected_target_revision not between 1 and 9007199254740991 then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;perform lumin.mode_begin(p_actor,p_tenant,p_flow,p_key);
 p:=jsonb_build_object('schemaVersion',1,'operation','apply','actorId',p_actor,'flowId',p_flow,'installationId',p_installation,'expectedTargetRevision',p_expected_target_revision,'expectedCurrentVersionId',p_expected_version,'newVersionId',p_new_version);r:=lumin.mode_retry(p_actor,p_tenant,p_flow,'apply',p_key,p);if r is not null then return r;end if;
 select * into i from public.mode_flow_installations where tenant_id=p_tenant and flow_id=p_flow and id=p_installation for update;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;if i.target_revision<>p_expected_target_revision or i.current_version_id<>p_expected_version then raise exception 'MODE_CONFLICT' using errcode='40001';end if;
 if not exists(select 1 from public.flows where tenant_id=p_tenant and id=p_flow and status='active') then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;perform lumin.mode_target(p_tenant,p_flow,p_new_version);changed:=p_new_version<>p_expected_version;
 if changed then if i.target_revision>=9007199254740991 then raise exception 'MODE_REVISION_EXHAUSTED' using errcode='54000';end if;update public.mode_flow_installations set current_version_id=p_new_version,target_revision=target_revision+1 where id=i.id returning * into i;end if;
 r:=jsonb_build_object('schemaVersion',1,'operation','apply','actorId',p_actor,'flowId',p_flow,'installationId',i.id,'previousVersionId',p_expected_version,'currentVersionId',i.current_version_id,'targetRevision',i.target_revision,'policyRevision',i.policy_revision,'changed',changed);return lumin.mode_finish(p_actor,p_tenant,p_flow,'apply',p_key,p,r);
end $$;
create function public.mode_update_flow_policy(p_actor uuid,p_tenant uuid,p_flow uuid,p_installation uuid,p_expected_policy_revision bigint,p_enabled boolean,p_parent_origins jsonb,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p jsonb;r jsonb;i public.mode_flow_installations;parents jsonb;changed boolean;
begin
 if p_installation is null or p_expected_policy_revision is null or p_expected_policy_revision not between 1 and 9007199254740991 or p_enabled is null then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;parents:=lumin.mode_parents(p_parent_origins);perform lumin.mode_begin(p_actor,p_tenant,p_flow,p_key);
 p:=jsonb_build_object('schemaVersion',1,'operation','policy','actorId',p_actor,'flowId',p_flow,'installationId',p_installation,'expectedPolicyRevision',p_expected_policy_revision,'enabled',p_enabled,'allowedParentOrigins',parents);r:=lumin.mode_retry(p_actor,p_tenant,p_flow,'policy',p_key,p);if r is not null then return r;end if;
 select * into i from public.mode_flow_installations where tenant_id=p_tenant and flow_id=p_flow and id=p_installation for update;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;if i.policy_revision<>p_expected_policy_revision then raise exception 'MODE_CONFLICT' using errcode='40001';end if;if not lumin.mode_distribution(i.mode,parents,i.profile_version) then raise exception 'MODE_INVALID_DISTRIBUTION' using errcode='22023';end if;
 if p_enabled then if not exists(select 1 from public.flows where tenant_id=p_tenant and id=p_flow and status='active') then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;perform lumin.mode_target(p_tenant,p_flow,i.current_version_id);end if;
 changed:=row(i.enabled,i.allowed_parent_origins) is distinct from row(p_enabled,parents);
 if changed then if i.policy_revision>=9007199254740991 then raise exception 'MODE_REVISION_EXHAUSTED' using errcode='54000';end if;update public.mode_flow_installations set enabled=p_enabled,allowed_parent_origins=parents,policy_revision=policy_revision+1 where id=i.id returning * into i;end if;
 r:=jsonb_build_object('schemaVersion',1,'operation','policy','actorId',p_actor,'flowId',p_flow,'installationId',i.id,'currentVersionId',i.current_version_id,'targetRevision',i.target_revision,'policyRevision',i.policy_revision,'enabled',i.enabled,'allowedParentOrigins',i.allowed_parent_origins,'changed',changed);return lumin.mode_finish(p_actor,p_tenant,p_flow,'policy',p_key,p,r);
end $$;
create function public.mode_public_installation_policy(p_installation uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;
begin
 if p_installation is null then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;
 select jsonb_build_object('schemaVersion',1,'installationId',i.id,'mode',i.mode,'deploymentProfileVersion',p.version,'rendererOrigin',p.renderer_origin,'apiOrigin',p.api_origin,'loaderUrl',p.renderer_origin||'/assets/booking-lumin-loader.'||p.loader_sha256||'.js','currentVersionId',i.current_version_id,'targetRevision',i.target_revision,'policyRevision',i.policy_revision,'allowedParentOrigins',i.allowed_parent_origins,'enabled',i.enabled) into r
 from public.mode_flow_installations i join lumin.installation_profiles p on p.version=i.profile_version join public.tenants t on t.id=i.tenant_id join public.flows f on (f.tenant_id,f.id)=(i.tenant_id,i.flow_id) join public.bound_flow_versions b on (b.tenant_id,b.flow_id,b.version_id)=(i.tenant_id,i.flow_id,i.current_version_id) join public.services s on (s.tenant_id,s.id)=(b.tenant_id,b.service_id)
 where i.id=p_installation and i.enabled and t.status='active' and f.status='active' and s.active;
 if r is null then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;if octet_length(convert_to(r::text,'UTF8'))>16384 then raise exception 'MODE_RESPONSE_TOO_LARGE' using errcode='54000';end if;return r;
end $$;
create function lumin.mode_read_begin(a uuid,t uuid,f uuid) returns void language plpgsql set search_path=pg_catalog as $$
begin
 if a is null or t is null or f is null then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;perform lumin.flow_actor(a,t,true);perform 1 from public.flows where tenant_id=t and id=f and status<>'archived' for share;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;
end $$;
create function public.mode_owner_operation(p_actor uuid,p_tenant uuid,p_flow uuid,p_operation text,p_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;
begin
 if p_operation is null or p_operation not in('publish','install','apply','policy') or p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;perform lumin.mode_read_begin(p_actor,p_tenant,p_flow);
 select receipt into r from public.mode_flow_owner_operations where tenant_id=p_tenant and actor_id=p_actor and flow_id=p_flow and operation=p_operation and idempotency_key=p_key;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;return r;
end $$;
create function lumin.mode_owner_page(r jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
begin
 if r is null or jsonb_typeof(r)<>'object' or octet_length(convert_to(r::text,'UTF8'))>1048576 then raise exception 'MODE_RESPONSE_TOO_LARGE' using errcode='54000';end if;return r;
end $$;
create function public.mode_owner_installations(p_actor uuid,p_tenant uuid,p_flow uuid,p_after_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;items jsonb:='[]';i public.mode_flow_installations;last_id uuid;n integer:=0;more boolean:=false;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;perform lumin.mode_read_begin(p_actor,p_tenant,p_flow);
 for i in select * from public.mode_flow_installations where tenant_id=p_tenant and flow_id=p_flow and (p_after_id is null or id>p_after_id) order by id limit p_limit+1 loop
  n:=n+1;if n>p_limit then more:=true;exit;end if;last_id:=i.id;items:=items||jsonb_build_array(jsonb_build_object('installationId',i.id,'flowId',i.flow_id,'mode',i.mode,'deploymentProfileVersion',i.profile_version,'currentVersionId',i.current_version_id,'targetRevision',i.target_revision,'policyRevision',i.policy_revision,'enabled',i.enabled,'allowedParentOrigins',i.allowed_parent_origins));
 end loop;
 r:=jsonb_build_object('installations',items,'nextCursor',case when more then last_id else null end);return lumin.mode_owner_page(r);
end $$;
create function public.mode_owner_installation_history(p_actor uuid,p_tenant uuid,p_flow uuid,p_installation uuid,p_before_sequence bigint,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;items jsonb:='[]';h public.mode_flow_installation_history;last_seq bigint;n integer:=0;more boolean:=false;
begin
 if p_installation is null or p_limit is null or p_limit not between 1 and 100 or (p_before_sequence is not null and p_before_sequence not between 1 and 9007199254740991) then raise exception 'MODE_INVALID_REQUEST' using errcode='22023';end if;perform lumin.mode_read_begin(p_actor,p_tenant,p_flow);
 perform 1 from public.mode_flow_installations where tenant_id=p_tenant and flow_id=p_flow and id=p_installation;if not found then raise exception 'MODE_UNAVAILABLE' using errcode='P0002';end if;
 for h in select * from public.mode_flow_installation_history where tenant_id=p_tenant and flow_id=p_flow and installation_id=p_installation and (p_before_sequence is null or sequence<p_before_sequence) order by sequence desc limit p_limit+1 loop
  n:=n+1;if n>p_limit then more:=true;exit;end if;last_seq:=h.sequence;items:=items||jsonb_build_array(jsonb_build_object('sequence',h.sequence,'operation',h.operation,'currentVersionId',h.version_id,'targetRevision',h.target_revision,'policyRevision',h.policy_revision,'enabled',h.enabled,'allowedParentOrigins',h.allowed_parent_origins));
 end loop;
 r:=jsonb_build_object('history',items,'nextCursor',case when more then last_seq else null end);return lumin.mode_owner_page(r);
end $$;
-- Explicit ACL manifest: service_role bypass does not grant raw table access.
alter table lumin.installation_profiles enable row level security;alter table lumin.installation_profiles force row level security;
alter table public.mode_flow_installations enable row level security;alter table public.mode_flow_installations force row level security;
alter table public.mode_flow_owner_operations enable row level security;alter table public.mode_flow_owner_operations force row level security;
alter table public.mode_flow_installation_history enable row level security;alter table public.mode_flow_installation_history force row level security;
revoke all on lumin.installation_profiles,public.mode_flow_installations,public.mode_flow_owner_operations,public.mode_flow_installation_history from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('lumin','public') and p.proname like 'mode\_%' escape '\' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
grant execute on function public.mode_publish_flow(uuid,uuid,uuid,bigint,text),public.mode_install_flow(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text),public.mode_apply_flow_version(uuid,uuid,uuid,uuid,bigint,uuid,uuid,text),public.mode_update_flow_policy(uuid,uuid,uuid,uuid,bigint,boolean,jsonb,text),public.mode_public_installation_policy(uuid),public.mode_owner_installations(uuid,uuid,uuid,uuid,integer),public.mode_owner_installation_history(uuid,uuid,uuid,uuid,bigint,integer),public.mode_owner_operation(uuid,uuid,uuid,text,text) to service_role;
commit;
