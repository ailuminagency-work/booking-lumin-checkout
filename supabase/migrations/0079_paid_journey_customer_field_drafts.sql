-- Additive private authoring only. Does not activate V9 publication or financial writers.
begin;
-- Count compact JSON UTF-8 bytes, without mistaking PostgreSQL separator spaces for form data.
create function lumin.paid_journey_customer_field_json_bytes(p jsonb) returns integer
language plpgsql immutable set search_path=pg_catalog as $$declare size integer;n integer;begin
 if jsonb_typeof(p)='object' then
  select coalesce(sum(octet_length(to_jsonb(e.key)::text)+1+lumin.paid_journey_customer_field_json_bytes(e.value)),0),count(*) into size,n from jsonb_each(p) e;return size+greatest(n-1,0)+2;
 elsif jsonb_typeof(p)='array' then
  select coalesce(sum(lumin.paid_journey_customer_field_json_bytes(e.value)),0),count(*) into size,n from jsonb_array_elements(p) e;return size+greatest(n-1,0)+2;
 else return octet_length(p::text);end if;
end$$;
revoke all on function lumin.paid_journey_customer_field_json_bytes(jsonb) from public,anon,authenticated,service_role;
create function lumin.paid_journey_customer_field_form_valid(p jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare binding jsonb;field jsonb;stage jsonb;positions jsonb:='{}';bound text[]:='{}';i integer:=0;position integer;previous integer:=-1;name text;
begin
 if p is null or jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>5 or not(p ?& array['name','presentation','journey','customerFields','fieldBindings']) or lumin.paid_journey_customer_field_json_bytes(p)>24576
 or jsonb_typeof(p->'name') is distinct from 'string' or jsonb_typeof(p->'presentation') is distinct from 'object'
 or not lumin.paid_journey_valid(p->'journey') or not lumin.conditional_customer_fields_valid(p->'customerFields')
 or jsonb_typeof(p->'fieldBindings') is distinct from 'array' then return false;end if;
 name:=p->>'name';
 if lumin.utf16_length(name) not between 1 and 200 or name ~ U&'[\0001-\001f\007f-\009f]' or name<>btrim(name,U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') or length(name)=0 then return false;end if;
 if (select count(*) from jsonb_object_keys(p->'presentation'))<>2 or not((p->'presentation') ?& array['accentColor','layout'])
 or p#>>'{presentation,accentColor}' not in('#4f46e5','#0e7490','#0f766e','#2563eb','#be123c') or p#>>'{presentation,layout}' not in('stacked','compact')
 or jsonb_typeof(p#>'{presentation,accentColor}') is distinct from 'string' or jsonb_typeof(p#>'{presentation,layout}') is distinct from 'string' then return false;end if;
 if jsonb_array_length(p->'fieldBindings')<>jsonb_array_length(p->'customerFields') then return false;end if;
 for binding in select value from jsonb_array_elements(p->'fieldBindings') loop
  field:=p->'customerFields'->i;i:=i+1;
  if jsonb_typeof(binding)<>'object' or (select count(*) from jsonb_object_keys(binding))<>2 or not(binding ?& array['fieldId','stageId'])
   or jsonb_typeof(binding->'fieldId') is distinct from 'string' or jsonb_typeof(binding->'stageId') is distinct from 'string' or binding->>'fieldId' is distinct from field->>'id' then return false;end if;
  select e.value,(e.ordinality-1)::integer into stage,position from jsonb_array_elements(p#>'{journey,stages}') with ordinality e where e.value->>'id'=binding->>'stageId';
  if not found or stage->'enabled' is distinct from 'true'::jsonb or stage->>'kind' not in('information','informational') or position<previous then return false;end if;
  previous:=position;positions:=positions||jsonb_build_object(binding->>'fieldId',position);bound:=array_append(bound,binding->>'stageId');
  if field ? 'when' and (not(positions ? (field#>>'{when,fieldId}')) or (positions->>(field#>>'{when,fieldId}'))::integer>position) then return false;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p#>'{journey,stages}') s where s->>'kind'='informational' and s->'enabled'='true'::jsonb and not(s->>'id'=any(bound))) then return false;end if;
 return true;
end $$;
revoke all on function lumin.paid_journey_customer_field_form_valid(jsonb) from public,anon,authenticated,service_role;
create table public.paid_journey_customer_field_drafts(
 flow_id uuid primary key,tenant_id uuid not null references public.tenants(id),service_id uuid not null,
 revision bigint not null check(revision between 1 and 9007199254740991),form jsonb not null check(lumin.paid_journey_customer_field_form_valid(form)),
 unique(tenant_id,flow_id),foreign key(tenant_id,service_id) references public.services(tenant_id,id)
);
alter table public.paid_journey_customer_field_drafts enable row level security;
alter table public.paid_journey_customer_field_drafts force row level security;
revoke all on public.paid_journey_customer_field_drafts from public,anon,authenticated,service_role;
-- One flow identity namespace serializes both directions, without table-wide locks.
create function lumin.guard_paid_journey_customer_field_identity() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$declare identity uuid;begin
 if tg_table_name='flows' then identity:=new.id;else identity:=new.flow_id;end if;
 if identity is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(identity::text,79009));
 if tg_table_name='paid_journey_customer_field_drafts' then
  if tg_op='UPDATE' and new.flow_id is distinct from old.flow_id then raise exception 'IDENTITY_IMMUTABLE' using errcode='55000';end if;
  if exists(select 1 from public.flow_drafts where flow_id=identity) or exists(select 1 from public.paid_simple_drafts where flow_id=identity) or exists(select 1 from public.detailing_drafts where flow_id=identity) or exists(select 1 from public.paid_journey_drafts where flow_id=identity) or exists(select 1 from public.flows where id=identity) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 elsif exists(select 1 from public.paid_journey_customer_field_drafts where flow_id=identity) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 return new;
end$$;
revoke all on function lumin.guard_paid_journey_customer_field_identity() from public,anon,authenticated,service_role;
create trigger paid_journey_customer_field_identity before insert or update of flow_id on public.paid_journey_customer_field_drafts for each row execute function lumin.guard_paid_journey_customer_field_identity();
create trigger paid_journey_customer_field_identity before insert or update of flow_id on public.flow_drafts for each row execute function lumin.guard_paid_journey_customer_field_identity();
create trigger paid_journey_customer_field_identity before insert or update of flow_id on public.paid_simple_drafts for each row execute function lumin.guard_paid_journey_customer_field_identity();
create trigger paid_journey_customer_field_identity before insert or update of flow_id on public.detailing_drafts for each row execute function lumin.guard_paid_journey_customer_field_identity();
create trigger paid_journey_customer_field_identity before insert or update of flow_id on public.paid_journey_drafts for each row execute function lumin.guard_paid_journey_customer_field_identity();
create trigger paid_journey_customer_field_identity before insert or update of id on public.flows for each row execute function lumin.guard_paid_journey_customer_field_identity();
create function lumin.paid_journey_customer_field_catalog(p_tenant uuid,p_service uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 perform 1 from public.business_profiles where tenant_id=p_tenant and business_type='HOUSEKEEPING' for share;
 if not found then raise exception 'UNSUPPORTED_PROFILE' using errcode='0A000';end if;
 perform lumin.paid_simple_service(p_tenant,p_service);
end$$;
revoke all on function lumin.paid_journey_customer_field_catalog(uuid,uuid) from public,anon,authenticated,service_role;
create function public.save_paid_journey_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid,p_service uuid,p_expected_revision bigint,p_form jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare next_revision bigint;begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is null or p_service is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or not lumin.paid_journey_customer_field_form_valid(p_form) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.paid_journey_customer_field_catalog(p_tenant,p_service);
 -- Shared narrow identity reservation; old rows are scanned without row locks.
 perform pg_advisory_xact_lock(hashtextextended(p_flow::text,79009));
 if exists(select 1 from public.flow_drafts where flow_id=p_flow) or exists(select 1 from public.paid_simple_drafts where flow_id=p_flow) or exists(select 1 from public.detailing_drafts where flow_id=p_flow) or exists(select 1 from public.paid_journey_drafts where flow_id=p_flow) or exists(select 1 from public.flows where id=p_flow) then raise exception 'IDENTITY_COLLISION' using errcode='0A000';end if;
 if p_expected_revision=0 then
  insert into public.paid_journey_customer_field_drafts(flow_id,tenant_id,service_id,revision,form) values(p_flow,p_tenant,p_service,1,p_form) returning revision into next_revision;
 else
  update public.paid_journey_customer_field_drafts set service_id=p_service,revision=revision+1,form=p_form where tenant_id=p_tenant and flow_id=p_flow and revision=p_expected_revision returning revision into next_revision;
  if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',p_tenant,'flowId',p_flow,'revision',next_revision);
end$$;
create function public.get_paid_journey_customer_field_draft(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare service uuid;d public.paid_journey_customer_field_drafts;begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select service_id into service from public.paid_journey_customer_field_drafts where tenant_id=p_tenant and flow_id=p_flow;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 perform lumin.paid_journey_customer_field_catalog(p_tenant,service);
 select * into d from public.paid_journey_customer_field_drafts where tenant_id=p_tenant and flow_id=p_flow for share;
 if not found or d.service_id is distinct from service then raise exception 'CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('schemaVersion',2,'tenantId',d.tenant_id,'flowId',d.flow_id,'revision',d.revision,'serviceId',d.service_id,'form',d.form);
end$$;
revoke all on function public.save_paid_journey_customer_field_draft(uuid,uuid,uuid,uuid,bigint,jsonb),public.get_paid_journey_customer_field_draft(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_paid_journey_customer_field_draft(uuid,uuid,uuid,uuid,bigint,jsonb),public.get_paid_journey_customer_field_draft(uuid,uuid,uuid) to service_role;
commit;
