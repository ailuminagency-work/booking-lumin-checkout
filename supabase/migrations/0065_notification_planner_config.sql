-- Pure saved planner configuration only: no provider connection/status/secrets or sends.
begin;
create table public.tenant_notification_planner_configs(
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 revision bigint not null check(revision between 1 and 9007199254740991),
 config jsonb not null check(jsonb_typeof(config)='object')
);
alter table public.tenant_notification_planner_configs enable row level security;
alter table public.tenant_notification_planner_configs force row level security;
revoke all on public.tenant_notification_planner_configs from public,anon,authenticated,service_role;
create function lumin.notification_keys(v jsonb,keys text[]) returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(v)='object' and (select array_agg(k order by k) from jsonb_object_keys(v) k)=(select array_agg(k order by k) from unnest(keys) k)
$$;
create function lumin.notification_text(v jsonb,limit_length integer,multiline boolean default false) returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(v)='string' and (select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0) from regexp_split_to_table(v#>>'{}','') ch) between 1 and limit_length
 and (v#>>'{}')!~ '[\u0001-\u0008\u000B-\u001F\u007F-\u009F]'
 and (multiline or ((v#>>'{}')!~ E'[\n\t]'))
$$;
create function lumin.notification_channels(v jsonb,required boolean default false) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>2 or (required and jsonb_array_length(v)=0) then return false;end if;
 return not exists(select 1 from jsonb_array_elements(v) c where c not in('"email"'::jsonb,'"sms"'::jsonb)) and (select count(*)=count(distinct c) from jsonb_array_elements(v) c);
end$$;
create function lumin.notification_template_text(v jsonb,n integer,multiline boolean default false) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare txt text;
begin
 if not lumin.notification_text(v,n,multiline) then return false;end if;txt:=v#>>'{}';
 txt:=regexp_replace(txt,'\{\{(tenantName|customerName|customerEmail|bookingReference|bookingState|slotStart|slotEnd|slotDate|slotTime|customerPhone|total)\}\}','','g');
 return txt!~ '[{}]';
end$$;
create function lumin.notification_planner_valid(p_tenant uuid,c jsonb) returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare x jsonb;y jsonb;ch jsonb;allowed text[]:=array['booking.created','booking.pending_payment','booking.confirmed','booking.completed','booking.cancelled','booking.refunded','booking.failed','payment.intent_created','payment.succeeded','payment.failed','payment.refunded','integration.connected','integration.disconnected','integration.delivery_failed','tenant.created','tenant.member_invited','tenant.settings_updated'];
begin
 if not lumin.notification_keys(c,array['tenantId','locale','timezone','sender','events','reminders','templates']) or c->>'tenantId' is distinct from p_tenant::text
 or not lumin.notification_text(c->'locale',35) or c->>'locale' !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
 or not lumin.notification_text(c->'timezone',100) or not exists(select 1 from pg_timezone_names where name=c->>'timezone') then return false;end if;
 if jsonb_typeof(c->'sender') is distinct from 'object' or exists(select 1 from jsonb_object_keys(c->'sender') k where k not in('emailFrom','emailFromName','smsFrom')) then return false;end if;
 if c->'sender'?'emailFrom' and (not lumin.notification_text(c->'sender'->'emailFrom',254) or c->'sender'->>'emailFrom' ~ '^\.' or c->'sender'->>'emailFrom' like '%..%' or c->'sender'->>'emailFrom' !~* '^[A-Z0-9_''+.-]*[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$') then return false;end if;
 if c->'sender'?'emailFromName' and not lumin.notification_text(c->'sender'->'emailFromName',100) then return false;end if;
 if c->'sender'?'smsFrom' and (jsonb_typeof(c->'sender'->'smsFrom') is distinct from 'string' or c->'sender'->>'smsFrom' !~ '^\+[1-9][0-9]{6,14}$') then return false;end if;
 if jsonb_typeof(c->'events') is distinct from 'array' or jsonb_array_length(c->'events')>17 or jsonb_typeof(c->'reminders') is distinct from 'array' or jsonb_array_length(c->'reminders')>10 or jsonb_typeof(c->'templates') is distinct from 'array' or jsonb_array_length(c->'templates')>50 then return false;end if;
 if (select count(*)<>count(distinct e->>'event') from jsonb_array_elements(c->'events') e) or (select count(*)<>count(distinct e->>'id') from jsonb_array_elements(c->'reminders') e) or (select count(*)<>count(distinct (e->>'trigger',e->>'channel',e->>'locale')) from jsonb_array_elements(c->'templates') e) then return false;end if;
 for x in select * from jsonb_array_elements(c->'templates') loop
  if not lumin.notification_keys(x,case when x?'subject' then array['trigger','channel','locale','subject','body'] else array['trigger','channel','locale','body'] end)
  or jsonb_typeof(x->'trigger') is distinct from 'string' or jsonb_typeof(x->'channel') is distinct from 'string' or (x->>'trigger'<>all(allowed) and x->>'trigger'<>'reminder') or x->>'channel' not in('email','sms') or x->>'locale' is distinct from c->>'locale'
  or not lumin.notification_template_text(x->'body',4000,true) or (x?'subject' and (x->>'channel'<>'email' or not lumin.notification_template_text(x->'subject',200))) then return false;end if;
 end loop;
 for x in select * from jsonb_array_elements(c->'events') loop
  if not lumin.notification_keys(x,array['event','channels']) or jsonb_typeof(x->'event') is distinct from 'string' or x->>'event'<>all(allowed) or not lumin.notification_channels(x->'channels') then return false;end if;
  for ch in select * from jsonb_array_elements(x->'channels') loop
   if not exists(select 1 from jsonb_array_elements(c->'templates') t where t->>'trigger'=x->>'event' and t->'channel'=ch) then return false;end if;
  end loop;
 end loop;
 for x in select * from jsonb_array_elements(c->'reminders') loop
  if not lumin.notification_keys(x,array['id','offsetMinutes','channels']) or jsonb_typeof(x->'id') is distinct from 'string' or x->>'id' !~ '^[a-z][a-z0-9_-]{0,39}$'
  or jsonb_typeof(x->'offsetMinutes') is distinct from 'number' or x->>'offsetMinutes' !~ '^[0-9]+$' or (x->>'offsetMinutes')::numeric not between 1 and 525600 or not lumin.notification_channels(x->'channels',true) then return false;end if;
  for ch in select * from jsonb_array_elements(x->'channels') loop
   if not exists(select 1 from jsonb_array_elements(c->'templates') t where t->>'trigger'='reminder' and t->'channel'=ch) then return false;end if;
  end loop;
 end loop;
 return true;
exception when others then return false;
end$$;
create function public.owner_notification_planner_config(p_actor uuid,p_tenant uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.tenant_notification_planner_configs;t public.tenants;
begin
 select * into t from public.tenants where id=p_tenant for share;perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into r from public.tenant_notification_planner_configs where tenant_id=p_tenant for share;
 if not found then return null;end if;
 if not lumin.notification_planner_valid(p_tenant,r.config) or r.config->>'timezone' is distinct from t.timezone then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'revision',r.revision,'config',r.config);
end$$;
-- Trusted runtime read only; caller must independently bind the booking to this tenant.
create function public.runtime_notification_planner_config(p_tenant uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.tenant_notification_planner_configs;t public.tenants;
begin
 select * into t from public.tenants where id=p_tenant and status='active';
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select * into r from public.tenant_notification_planner_configs where tenant_id=p_tenant;
 if not found then return null;end if;
 if not lumin.notification_planner_valid(p_tenant,r.config) or r.config->>'timezone' is distinct from t.timezone then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'revision',r.revision,'config',r.config);
end$$;
create function public.save_notification_planner_config(p_actor uuid,p_tenant uuid,p_expected_revision bigint,p_config jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.tenants;r public.tenant_notification_planner_configs;
begin
 select * into t from public.tenants where id=p_tenant for update;perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 or not lumin.notification_planner_valid(p_tenant,p_config) or p_config->>'timezone' is distinct from t.timezone then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into r from public.tenant_notification_planner_configs where tenant_id=p_tenant for update;
 if coalesce(r.revision,0)<>p_expected_revision then raise exception 'CONFLICT' using errcode='40001';end if;
 insert into public.tenant_notification_planner_configs(tenant_id,revision,config) values(p_tenant,p_expected_revision+1,p_config)
 on conflict(tenant_id) do update set revision=excluded.revision,config=excluded.config;
 return public.owner_notification_planner_config(p_actor,p_tenant);
end$$;
revoke all on function lumin.notification_keys(jsonb,text[]),lumin.notification_text(jsonb,integer,boolean),lumin.notification_channels(jsonb,boolean),lumin.notification_template_text(jsonb,integer,boolean),lumin.notification_planner_valid(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.runtime_notification_planner_config(uuid),public.owner_notification_planner_config(uuid,uuid),public.save_notification_planner_config(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.runtime_notification_planner_config(uuid),public.owner_notification_planner_config(uuid,uuid),public.save_notification_planner_config(uuid,uuid,bigint,jsonb) to service_role;
commit;
