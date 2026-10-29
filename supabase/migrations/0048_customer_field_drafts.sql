-- Versioned additional customer information authoring only. V2 publish closed.
begin;
create function lumin.customer_draft_fields_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb;key text;label text;seen text[]:=array[]::text[];bound numeric;
begin
 if p is null or jsonb_typeof(p)<>'array' or octet_length(p::text)>32768 then return false;end if;
 if jsonb_array_length(p)>10 then return false;end if;
 for f in select value from jsonb_array_elements(p) loop
  if jsonb_typeof(f)<>'object' or (select count(*) from jsonb_object_keys(f))<>5 or not(f ?& array['id','kind','label','required','maxLength'])
   or jsonb_typeof(f->'id') is distinct from 'string' or f->'kind' is distinct from '"text"'::jsonb
   or jsonb_typeof(f->'label') is distinct from 'string' or jsonb_typeof(f->'required') is distinct from 'boolean' or jsonb_typeof(f->'maxLength') is distinct from 'number' then return false;end if;
  key:=f->>'id';label:=f->>'label';bound:=(f->>'maxLength')::numeric;
  if key !~ '^custom_[a-z][a-z0-9_]{0,40}$' or substring(key from 8) in('name','email','phone','address','service','service_id','tenant','tenant_id','role','price','total','tax','provider','payment','prototype','constructor','__proto__') or key=any(seen)
   or lumin.utf16_length(label) not between 1 and 100 or label ~ U&'[\0001-\001f\007f-\009f]'
   or label<>btrim(label,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
   or bound not between 1 and 1000 or bound<>trunc(bound) then return false;end if;
  seen:=array_append(seen,key);
 end loop;
 return true;
end $$;
revoke all on function lumin.customer_draft_fields_valid(jsonb) from public,anon,authenticated,service_role;
alter table public.paid_simple_drafts add column draft_schema_version integer not null default 1,add column customer_fields jsonb not null default '[]'::jsonb;
alter table public.paid_simple_drafts add constraint paid_customer_draft_shape check((draft_schema_version=1 and customer_fields='[]'::jsonb) or (draft_schema_version=2 and lumin.customer_draft_fields_valid(customer_fields)));
create function lumin.reject_customer_draft_downgrade() returns trigger language plpgsql set search_path=pg_catalog as $$begin if old.draft_schema_version=2 and new.draft_schema_version<>2 then raise exception 'DRAFT_DOWNGRADE_FORBIDDEN' using errcode='55000';end if;return new;end$$;
revoke all on function lumin.reject_customer_draft_downgrade() from public,anon,authenticated,service_role;
create trigger paid_customer_draft_no_downgrade before update on public.paid_simple_drafts for each row execute function lumin.reject_customer_draft_downgrade();

-- Retain the accepted legacy implementation behind owner-checked wrappers.
-- Renamed functions lose direct server execution so they cannot bypass V2 guards.
alter function public.save_paid_simple_draft(uuid,uuid,uuid,uuid,bigint,text,text,text) rename to save_paid_simple_draft_v1;
alter function public.get_paid_simple_draft(uuid,uuid,uuid) rename to get_paid_simple_draft_v1;
alter function public.publish_paid_simple_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb) rename to publish_paid_simple_draft_v1;
revoke all on function public.save_paid_simple_draft_v1(uuid,uuid,uuid,uuid,bigint,text,text,text),public.get_paid_simple_draft_v1(uuid,uuid,uuid),public.publish_paid_simple_draft_v1(uuid,uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.save_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_accent_color text,p_layout text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare schema integer;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or p_name is null or length(btrim(p_name)) not between 1 and 200
  or p_accent_color is null or p_accent_color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p_layout is null or p_layout not in('stacked','compact') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.paid_simple_service(p_tenant,p_service);
 select draft_schema_version into schema from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for update;
 if schema=2 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return public.save_paid_simple_draft_v1(p_actor,p_tenant,p_flow,p_service,p_expected_revision,p_name,p_accent_color,p_layout);
end $$;

create function public.save_paid_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_name text,p_accent_color text,p_layout text,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare next_revision bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or p_name is null or length(btrim(p_name)) not between 1 and 200
  or p_accent_color is null or p_accent_color not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p_layout is null or p_layout not in('stacked','compact') or not lumin.customer_draft_fields_valid(p_fields) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Existing catalog-before-draft ordering and sole price eligibility authority.
 perform lumin.paid_simple_service(p_tenant,p_service);
 if p_expected_revision=0 then
  insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout,draft_schema_version,customer_fields) values(p_flow,p_tenant,p_service,1,btrim(p_name),p_accent_color,p_layout,2,p_fields);next_revision:=1;
 else
  update public.paid_simple_drafts set service_id=p_service,revision=revision+1,name=btrim(p_name),accent_color=p_accent_color,layout=p_layout,draft_schema_version=2,customer_fields=p_fields
   where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',2,'flowId',p_flow,'revision',next_revision);
end $$;

create function public.get_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;service uuid;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select service_id into service from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_simple_service(p_tenant,service);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or d.service_id<>service then raise exception 'CONFLICT' using errcode='40001';end if;
 if d.draft_schema_version=1 then return public.get_paid_simple_draft_v1(p_actor,p_tenant,p_flow);end if;
 return jsonb_build_object('schemaVersion',2,'flowId',d.flow_id,'revision',d.revision,'serviceId',d.service_id,'name',d.name,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout),'customerFields',d.customer_fields);
end $$;

create or replace function public.owner_paid_simple_drafts(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;bounded public.paid_simple_drafts[];drafts jsonb:='[]'::jsonb;entry jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select array_agg(entries.row order by (entries.row).flow_id) into bounded from(select row from public.paid_simple_drafts row where tenant_id=p_tenant order by flow_id limit 51)entries;
 if cardinality(bounded)>50 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 foreach d in array coalesce(bounded,array[]::public.paid_simple_drafts[]) loop
  perform lumin.paid_simple_service(p_tenant,d.service_id);
  entry:=jsonb_build_object('flowId',d.flow_id,'name',d.name,'revision',d.revision,'serviceId',d.service_id,'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout));
  if d.draft_schema_version=2 then entry:=entry||jsonb_build_object('schemaVersion',2,'customerFields',d.customer_fields);end if;
  drafts:=drafts||jsonb_build_array(entry);
 end loop;
 return jsonb_build_object('drafts',drafts);
end $$;

create function public.publish_paid_simple_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_expected_revision bigint,p_version uuid,p_installation uuid,p_origins jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts;service uuid;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_version is null or p_installation is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991 or not lumin.flow_origins_storage_valid(p_origins) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select service_id into service from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_simple_service(p_tenant,service);
 select * into d from public.paid_simple_drafts where tenant_id=p_tenant and flow_id=p_flow for update;
 if not found or d.service_id<>service or d.revision is distinct from p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 -- Locked exact saved representation has no customer renderer yet. Fail before
 -- any legacy publication/version/installation writer is invoked, even if empty.
 if d.draft_schema_version=2 then raise exception 'UNSUPPORTED_CONFIG' using errcode='0A000';end if;
 return public.publish_paid_simple_draft_v1(p_actor,p_tenant,p_flow,p_expected_revision,p_version,p_installation,p_origins);
end $$;
revoke all on function public.save_paid_simple_draft(uuid,uuid,uuid,uuid,bigint,text,text,text),public.save_paid_customer_field_draft(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb),public.get_paid_simple_draft(uuid,uuid,uuid),public.publish_paid_simple_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.owner_paid_simple_drafts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_paid_simple_draft(uuid,uuid,uuid,uuid,bigint,text,text,text),public.save_paid_customer_field_draft(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb),public.get_paid_simple_draft(uuid,uuid,uuid),public.publish_paid_simple_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb),public.owner_paid_simple_drafts(uuid,uuid) to service_role;
commit;
