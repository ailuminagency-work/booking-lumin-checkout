-- Complete bounded owner roster projection. No provision/mutation on GET,
-- no worker login/access data, and no availability or assignment authority.
begin;
create function public.owner_roster_snapshot(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare roster_version bigint; failure text; payload jsonb; expected_bytes bigint;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select version into roster_version from public.worker_roster_state where tenant_id=p_tenant for share;
 if not found then raise exception 'ROSTER_NOT_INITIALIZED' using errcode='P0002';end if;
 -- All following source reads use ONE statement snapshot. Metadata materializes
 -- service byte lengths, never unbounded service names. The count/text gates
 -- precede every projected JSON object; sorted arrays aggregate only after an
 -- exact per-row serialized-byte budget. No late services table lock is taken.
 with counts as materialized (
  select (select count(*) from public.workers where tenant_id=p_tenant) wc,
   (select count(*) from public.crews where tenant_id=p_tenant) cc,
   (select count(*) from public.crew_members where tenant_id=p_tenant) mc,
   (select count(*) from public.service_worker_eligibility where tenant_id=p_tenant) ec,
   (select count(*) from public.worker_shifts where tenant_id=p_tenant) sc,
   (select count(*) from public.services where tenant_id=p_tenant) vc
 ), bounded_counts as materialized (
  select * from counts where wc<=100 and cc<=50 and mc<=500 and ec<=1000 and sc<=1000 and vc<=100
 ), service_metadata as materialized (
  select s.id,octet_length(s.name) bytes from public.services s cross join bounded_counts where s.tenant_id=p_tenant
 ), text_budget as materialized (
  select coalesce((select max(bytes) from service_metadata),0)<=4096
   and coalesce((select sum(bytes) from service_metadata),0)<=65536
   and coalesce((select sum(bytes) from service_metadata),0)
    +coalesce((select sum(octet_length(display_name)) from public.workers where tenant_id=p_tenant),0)
    +coalesce((select sum(octet_length(name)) from public.crews where tenant_id=p_tenant),0)
    +coalesce((select sum(octet_length(source_time_zone)+octet_length(kind)) from public.worker_shifts where tenant_id=p_tenant),0)<=131072 ok
  from bounded_counts
 ), w as materialized (
  select id,display_name,active from public.workers cross join text_budget where tenant_id=p_tenant and text_budget.ok
 ), c as materialized (
  select id,name,active from public.crews cross join text_budget where tenant_id=p_tenant and text_budget.ok
 ), m as materialized (
  select crew_id,worker_id from public.crew_members cross join text_budget where tenant_id=p_tenant and text_budget.ok
 ), e as materialized (
  select service_id,worker_id,active from public.service_worker_eligibility cross join text_budget where tenant_id=p_tenant and text_budget.ok
 ), s as materialized (
  select id,worker_id,kind,starts_at,ends_at,source_time_zone,active from public.worker_shifts cross join text_budget where tenant_id=p_tenant and text_budget.ok
 ), v as materialized (
  select src.id,src.name,src.active from public.services src join service_metadata sm on sm.id=src.id cross join text_budget where src.tenant_id=p_tenant and text_budget.ok
 ), zones as materialized (select name from pg_timezone_names), integrity as materialized (
  select not exists(select 1 from w where length(display_name) not between 1 and 160 or length(btrim(display_name))=0)
   and not exists(select 1 from c where length(name) not between 1 and 160 or length(btrim(name))=0)
   and not exists(select 1 from m where not exists(select 1 from c where c.id=m.crew_id) or not exists(select 1 from w where w.id=m.worker_id))
   and not exists(select 1 from e where not exists(select 1 from w where w.id=e.worker_id) or not exists(select 1 from v where v.id=e.service_id))
   and not exists(select 1 from s where not exists(select 1 from w where w.id=s.worker_id) or kind not in('available','blocked') or not isfinite(starts_at) or not isfinite(ends_at) or ends_at<=starts_at
    or not exists(select 1 from zones z where z.name=s.source_time_zone)) ok,
   not exists(select 1 from s where starts_at<'0001-01-01T00:00:00Z'::timestamptz or ends_at>='10000-01-01T00:00:00Z'::timestamptz) time_ok
 ), projected as materialized (
  select 'workers' collection,id::text ordering,jsonb_build_object('id',id,'displayName',display_name,'active',active) dto from w where (select ok and time_ok from integrity)
  union all select 'crews',id::text,jsonb_build_object('id',id,'name',name,'active',active,'workerIds',coalesce((select jsonb_agg(worker_id order by worker_id) from m where m.crew_id=c.id),'[]')) from c where (select ok and time_ok from integrity)
  union all select 'eligibility',service_id::text||worker_id::text,jsonb_build_object('serviceId',service_id,'workerId',worker_id,'active',active) from e where (select ok and time_ok from integrity)
  union all select 'shifts',id::text,jsonb_build_object('id',id,'workerId',worker_id,'kind',kind,'startsAt',to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'sourceTimeZone',source_time_zone,'active',active) from s where (select ok and time_ok from integrity)
  union all select 'services',id::text,jsonb_build_object('id',id,'name',name,'active',active) from v where (select ok and time_ok from integrity)
 ), sizes as materialized (
  select coalesce(sum(bytes),0)+octet_length(jsonb_build_object('rosterVersion',roster_version,'workers','[]'::jsonb,'crews','[]'::jsonb,'eligibility','[]'::jsonb,'shifts','[]'::jsonb,'services','[]'::jsonb)::text) bytes
  from (select sum(octet_length(dto::text))+greatest(count(*)-1,0)*2 bytes from projected group by collection) groups
 ), gate as materialized (
  select case when not exists(select 1 from bounded_counts) or not coalesce((select ok from text_budget),false) then 'ROSTER_TOO_LARGE'
   when not (select time_ok from integrity) then 'ROSTER_UNSUPPORTED_TIME'
   when not (select ok from integrity) then 'ROSTER_INVALID_DATA'
   when (select bytes from sizes)>524288 then 'ROSTER_TOO_LARGE' else null end reason
 )
 select reason,(select bytes from sizes),case when reason is null then jsonb_build_object('rosterVersion',roster_version,
  'workers',coalesce((select jsonb_agg(dto order by ordering COLLATE "C") from projected where collection='workers'),'[]'),
  'crews',coalesce((select jsonb_agg(dto order by ordering COLLATE "C") from projected where collection='crews'),'[]'),
  'eligibility',coalesce((select jsonb_agg(dto order by ordering COLLATE "C") from projected where collection='eligibility'),'[]'),
  'shifts',coalesce((select jsonb_agg(dto order by ordering COLLATE "C") from projected where collection='shifts'),'[]'),
  'services',coalesce((select jsonb_agg(dto order by ordering COLLATE "C") from projected where collection='services'),'[]')) else null end
 into failure,expected_bytes,payload from gate;
 if failure='ROSTER_UNSUPPORTED_TIME' then raise exception 'ROSTER_UNSUPPORTED_TIME' using errcode='22008';end if;
 if failure='ROSTER_TOO_LARGE' then raise exception 'ROSTER_TOO_LARGE' using errcode='54000';end if;
 if failure is not null or payload is null then raise exception 'ROSTER_INVALID_DATA' using errcode='22023';end if;
 if octet_length(payload::text)>524288 then raise exception 'ROSTER_TOO_LARGE' using errcode='54000';end if;
 if octet_length(payload::text)<>expected_bytes then raise exception 'ROSTER_INVALID_DATA' using errcode='22023';end if;
 return payload;
end $$;
revoke all on function public.owner_roster_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_roster_snapshot(uuid,uuid) to service_role;
commit;
