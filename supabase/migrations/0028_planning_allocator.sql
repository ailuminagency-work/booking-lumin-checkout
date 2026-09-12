-- UTC-only owner planning allocator. Trusted separate-statement timeout caller only.
-- No confirmation, payment, worker access or hosted authentication authority.
begin;
create function lumin.allocation_encode(v jsonb) returns text language plpgsql immutable set search_path=pg_catalog as $$
declare s text;out_value text:='';x jsonb;
begin
 case jsonb_typeof(v)
 when 'null' then return '-1:';
 when 'array' then
  s:=jsonb_array_length(v)::text;out_value:=octet_length(s)::text||':'||s;
  for x in select value from jsonb_array_elements(v) loop out_value:=out_value||lumin.allocation_encode(x);end loop;return out_value;
 when 'string' then s:=v#>>'{}';
 when 'boolean' then s:=case when v='true'::jsonb then '1' else '0' end;
 when 'number' then if (v#>>'{}')::numeric<>trunc((v#>>'{}')::numeric) then raise exception 'ALLOCATION_INVALID' using errcode='22023';end if;s:=trunc((v#>>'{}')::numeric)::text;
 else raise exception 'ALLOCATION_INVALID' using errcode='22023';end case;
 if s is null then raise exception 'ALLOCATION_INVALID' using errcode='22023';end if;
 return octet_length(convert_to(s,'UTF8'))::text||':'||s;
end$$;
create function lumin.allocation_us(v timestamptz) returns text language plpgsql immutable set search_path=pg_catalog as $$begin
 if v is null or not isfinite(v) or v<timestamptz '0001-01-01 00:00:00+00' or v>=timestamptz '10000-01-01 00:00:00+00' then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
 return trunc(extract(epoch from v)*1000000)::text;
end$$;
create function lumin.allocation_deadline(v timestamptz) returns void language plpgsql volatile set search_path=pg_catalog as $$begin
 if clock_timestamp()>=v then raise exception 'ALLOCATION_DEADLINE' using errcode='57014';end if;
end$$;
create function lumin.allocation_receipt(g public.allocation_groups) returns jsonb language plpgsql volatile set search_path=pg_catalog as $$declare r jsonb;begin
 perform lumin.allocation_us(g.requested_start);perform lumin.allocation_us(g.requested_end);perform lumin.allocation_us(g.occupied_start);perform lumin.allocation_us(g.occupied_end);perform lumin.allocation_us(g.created_at);perform lumin.allocation_us(g.expires_at);
 r:=jsonb_build_object('schemaVersion',1,'groupId',g.id,'generation',g.generation,'bookingId',g.booking_id,'status',g.status,'usable',g.status='held' and g.expires_at>clock_timestamp(),'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'bookingState','draft','confirmed',false);
 if octet_length(convert_to(r::text,'UTF8'))>2048 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;return r;
end$$;
create function public.allocate_planning_group(p_actor uuid,p_tenant uuid,p_booking uuid,p_crew uuid,p_target_generation bigint) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare
 deadline_at timestamptz:=clock_timestamp()+interval '5 seconds';h public.allocation_group_heads%rowtype;g public.allocation_groups%rowtype;b public.bookings%rowtype;
 ap public.allocation_policies%rowtype;sp public.scheduling_policies%rowtype;s public.services%rowtype;
 r record;q record;x jsonb;workers_json jsonb:='[]';resources_json jsonb:='[]';shifts_json jsonb;rules_json jsonb:='[]';policy_json jsonb;
 worker_ids uuid[]:='{}';resource_ids uuid[]:='{}';roster bigint;sid uuid;gid uuid;intent bytea;evidence bytea;manifest bytea;
 tier text;chosen uuid;win_start integer;win_end integer;win_capacity integer;day_value date;day_start timestamptz;day_end timestamptz;occupied_start timestamptz;occupied_end timestamptz;
 n bigint;total_n bigint:=0;shift_n bigint:=0;used numeric;valid_shift boolean;specific boolean;retry boolean:=false;fresh timestamptz;expiry timestamptz;key_schema text;hold_key_value text;
begin
 perform lumin.group_rc();
 if p_actor is null or p_tenant is null or p_booking is null or p_crew is null or p_target_generation is null or p_target_generation not between 1 and 9007199254740991 then raise exception 'ALLOCATION_INVALID' using errcode='22023';end if;
 -- Preconditions only: these settings do not attest the caller's command history.
 if (select count(*) from pg_catalog.pg_settings where name in('statement_timeout','lock_timeout') and unit='ms' and setting::numeric between 1 and 5000)<>2 then raise exception 'ALLOCATION_PROTOCOL' using errcode='55000';end if;
 lock table public.allocation_policies in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.bookings in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.service_resources in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.services in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.availability_rules in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.availability_overrides in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.scheduling_policies in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.resources in share mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.allocation_group_heads in share row exclusive mode;perform lumin.allocation_deadline(deadline_at);
 lock table public.capacity_holds,public.resource_reservations,public.worker_interval_holds in row exclusive mode;perform lumin.allocation_deadline(deadline_at);
 perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.allocation_deadline(deadline_at);
 select version into roster from public.worker_roster_state where tenant_id=p_tenant for share;perform lumin.allocation_deadline(deadline_at);
 select * into h from public.allocation_group_heads where tenant_id=p_tenant and booking_id=p_booking for update;
 if found then
  select * into g from public.allocation_groups where tenant_id=p_tenant and id=h.id and generation=h.current_generation for update;
  if not found then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  if p_target_generation<>h.current_generation and not(g.status in('released','expired') and h.current_generation<9007199254740991 and p_target_generation=h.current_generation+1) then raise exception 'ALLOCATION_GENERATION_CONFLICT' using errcode='40001';end if;
 elsif p_target_generation<>1 then raise exception 'ALLOCATION_GENERATION_CONFLICT' using errcode='40001';end if;
 select id,tenant_id,state,slot_start,slot_end,lumin.planning_service_id(selection) into b.id,b.tenant_id,b.state,b.slot_start,b.slot_end,sid from public.bookings where tenant_id=p_tenant and id=p_booking for share;perform lumin.allocation_deadline(deadline_at);
 if b.id is null then raise exception 'ALLOCATION_NOT_FOUND' using errcode='P0002';end if;
 -- Read only the canonical service identifier, not customer selection payload.
 if b.state<>'draft' or sid is null then raise exception 'ALLOCATION_INVALID' using errcode='22023';end if;
 intent:=sha256(convert_to(lumin.allocation_encode(jsonb_build_array('lumin/allocation/intent/v1',p_tenant,p_booking,p_target_generation,p_crew,sid,lumin.allocation_us(b.slot_start),lumin.allocation_us(b.slot_end))),'UTF8'));
 if h.id is not null then
  perform lumin.group_validate(p_tenant,h.id,h.current_generation);
  if p_target_generation=h.current_generation then
   if g.intent_hash<>intent or g.crew_id<>p_crew or g.service_id<>sid then raise exception 'ALLOCATION_GENERATION_CONFLICT' using errcode='40001';end if;
   retry:=true;
   if g.status<>'held' or g.expires_at<=clock_timestamp() then
    perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.allocation_deadline(deadline_at);return lumin.allocation_receipt(g);
   end if;
  end if;
 end if;
 -- Live resolver errors may not obscure a now-expired structurally valid retry.
 begin
  if roster is null then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  if (select timezone from public.tenants where id=p_tenant)<>'UTC' then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  select id,tenant_id,active,duration_minutes into s.id,s.tenant_id,s.active,s.duration_minutes from public.services where id=sid;
  if not found or s.tenant_id<>p_tenant then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  if not s.active then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  select * into ap from public.allocation_policies where tenant_id=p_tenant and service_id=sid;
  if not found then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  if b.slot_end<=b.slot_start or b.slot_end-b.slot_start<>make_interval(mins=>s.duration_minutes) or date_trunc('minute',b.slot_start at time zone 'UTC')<>(b.slot_start at time zone 'UTC') or date_trunc('minute',b.slot_end at time zone 'UTC')<>(b.slot_end at time zone 'UTC') then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  occupied_start:=b.slot_start-make_interval(mins=>ap.setup_minutes);occupied_end:=b.slot_end+make_interval(mins=>ap.cleanup_minutes);
  perform lumin.allocation_us(occupied_start);perform lumin.allocation_us(occupied_end);
  day_value:=(occupied_start at time zone 'UTC')::date;day_start:=day_value::timestamp at time zone 'UTC';day_end:=day_start+interval '24 hours';
  if occupied_end>day_end then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  select count(*) into n from(select 1 from public.scheduling_policies where (tenant_id=p_tenant and service_id is null) or service_id=sid limit 3)z;
  if n>2 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if exists(select 1 from public.scheduling_policies where service_id=sid and tenant_id<>p_tenant) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  select * into sp from public.scheduling_policies where tenant_id=p_tenant and(service_id=sid or service_id is null) order by service_id nulls last limit 1;
  if not found or sp.lead_time_minutes not between 0 and 525600 or sp.horizon_days not between 1 and 366 or sp.slot_interval_minutes not between 5 and 1440 then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  policy_json:=jsonb_build_array(sp.id,sp.service_id,sp.lead_time_minutes,sp.horizon_days,sp.slot_interval_minutes);
  select count(*) into n from(select 1 from public.availability_overrides where date=day_value and ((tenant_id=p_tenant and service_id is null) or service_id=sid) limit 129)z;
  if n>128 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if exists(select 1 from public.availability_overrides where date=day_value and service_id=sid and tenant_id<>p_tenant) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  select count(*) into n from(select 1 from public.availability_rules where weekday=extract(dow from day_value) and ((tenant_id=p_tenant and service_id is null) or service_id=sid) limit 129)z;
  if n>128 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if exists(select 1 from public.availability_rules where weekday=extract(dow from day_value) and service_id=sid and tenant_id<>p_tenant) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  specific:=exists(select 1 from public.availability_overrides where service_id=sid and date=day_value);
  if exists(select 1 from public.availability_overrides where tenant_id=p_tenant and date=day_value and(service_id=sid or service_id is null)) then
   tier:=case when specific then 'serviceOverride' else 'tenantOverride' end;
   if (select count(*) from public.availability_overrides where tenant_id=p_tenant and date=day_value and(case when specific then service_id=sid else service_id is null end))<>1 then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
   for r in select * from public.availability_overrides where tenant_id=p_tenant and date=day_value and(case when specific then service_id=sid else service_id is null end) order by id loop
    if chosen is not null then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
    chosen:=r.id;win_start:=r.start_minute;win_end:=r.end_minute;win_capacity:=r.capacity;
    if r.kind='closed' then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
    rules_json:=rules_json||jsonb_build_array(jsonb_build_array(r.id,r.kind,to_char(day_value,'YYYY-MM-DD'),r.start_minute,r.end_minute,r.capacity));
   end loop;
  else
   specific:=exists(select 1 from public.availability_rules where service_id=sid and weekday=extract(dow from day_value));tier:=case when specific then 'serviceRules' else 'tenantRules' end;
   for r in select * from public.availability_rules where tenant_id=p_tenant and weekday=extract(dow from day_value) and(case when specific then service_id=sid else service_id is null end) order by id loop
    rules_json:=rules_json||jsonb_build_array(jsonb_build_array(r.id,'rule',r.weekday,r.start_minute,r.end_minute,r.capacity));
    if occupied_start>=day_start+make_interval(mins=>r.start_minute) and occupied_end<=day_start+make_interval(mins=>r.end_minute) then
     if chosen is not null then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
     chosen:=r.id;win_start:=r.start_minute;win_end:=r.end_minute;win_capacity:=r.capacity;
    end if;
   end loop;
   if chosen is not null and exists(select 1 from jsonb_array_elements(rules_json) j(value) where (j.value->>0)::uuid<>chosen and(j.value->>3)::int<win_end and(j.value->>4)::int>win_start) then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  end if;
  if chosen is null then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  if win_capacity is null then raise exception 'ALLOCATION_UNSUPPORTED_SCHEDULE' using errcode='0A000';end if;
  if occupied_start<day_start+make_interval(mins=>win_start) or occupied_end>day_start+make_interval(mins=>win_end) or mod(extract(epoch from(b.slot_start-(day_start+make_interval(mins=>win_start))))::numeric,sp.slot_interval_minutes::numeric*60)<>0 then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  if not exists(select 1 from public.crews where tenant_id=p_tenant and id=p_crew and active) then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  select count(*) into n from(select 1 from public.crew_members where crew_id=p_crew limit 101)z;
  if n>100 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if n=0 then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  for r in select cm.tenant_id,cm.worker_id,w.active,w.tenant_id worker_tenant,e.active eligible from public.crew_members cm left join public.workers w on w.id=cm.worker_id left join public.service_worker_eligibility e on e.tenant_id=p_tenant and e.service_id=sid and e.worker_id=cm.worker_id where cm.crew_id=p_crew order by cm.worker_id loop
   if r.tenant_id<>p_tenant or r.worker_tenant is distinct from p_tenant then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
   if r.active is distinct from true or r.eligible is distinct from true then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
   select count(*) into n from(select 1 from public.worker_shifts where worker_id=r.worker_id and active and starts_at<occupied_end and ends_at>occupied_start limit 65)z;
   shift_n:=shift_n+n;if n>64 or shift_n>4096 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
   shifts_json:='[]';valid_shift:=false;
   for q in select * from public.worker_shifts where worker_id=r.worker_id and active and starts_at<occupied_end and ends_at>occupied_start order by id loop
    if q.tenant_id<>p_tenant then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
    if q.kind='blocked' then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
    valid_shift:=valid_shift or(q.kind='available' and q.starts_at<=occupied_start and q.ends_at>=occupied_end);
    shifts_json:=shifts_json||jsonb_build_array(jsonb_build_array(q.id,q.kind,lumin.allocation_us(q.starts_at),lumin.allocation_us(q.ends_at)));
   end loop;
   if not valid_shift then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
   worker_ids:=array_append(worker_ids,r.worker_id);workers_json:=workers_json||jsonb_build_array(jsonb_build_array(r.worker_id,true,true,shifts_json));
  end loop;
  select count(*) into n from(select 1 from public.service_resources where service_id=sid limit 101)z;
  if n>100 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if (ap.resource_mode='none' and n<>0) or(ap.resource_mode='linked' and n=0) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  for r in select sr.tenant_id,sr.resource_id,sr.quantity_required,z.tenant_id resource_tenant,z.active,z.capacity from public.service_resources sr left join public.resources z on z.id=sr.resource_id where sr.service_id=sid order by sr.resource_id loop
   if r.tenant_id<>p_tenant or r.resource_tenant is distinct from p_tenant or r.quantity_required is null or r.quantity_required<=0 then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
   if not r.active then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
   resource_ids:=array_append(resource_ids,r.resource_id);resources_json:=resources_json||jsonb_build_array(jsonb_build_array(r.resource_id,true,r.capacity,r.quantity_required));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||p_tenant::text||':'||sid::text,0));perform lumin.allocation_deadline(deadline_at);
  for r in select unnest(resource_ids) id loop perform pg_advisory_xact_lock(hashtextextended('lumin:resource-capacity:'||p_tenant::text||':'||r.id::text,0));perform lumin.allocation_deadline(deadline_at);end loop;
  for r in select unnest(worker_ids) id loop perform pg_advisory_xact_lock(hashtextextended('lumin:worker-capacity:'||p_tenant::text||':'||r.id::text,0));perform lumin.allocation_deadline(deadline_at);end loop;
  -- Find all historical physical carriers, including resources omitted last time.
  for r in select * from public.capacity_holds where booking_id=p_booking order by id for update loop
   if r.tenant_id<>p_tenant or r.service_id<>sid or r.group_id is distinct from h.id or r.group_id is null then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
   perform lumin.group_validate(p_tenant,r.group_id,r.group_generation);
   if not retry and r.status<>'released' then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  end loop;
  for r in select * from public.resource_reservations where booking_id=p_booking order by resource_id for update loop
   if r.tenant_id<>p_tenant or r.group_id is distinct from h.id or r.group_id is null then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
   perform lumin.group_validate(p_tenant,r.group_id,r.group_generation);
   if not retry and r.status<>'released' then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  end loop;
  perform 1 from public.worker_interval_holds where tenant_id=p_tenant and group_id=h.id order by worker_id,generation for update;
  perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.allocation_deadline(deadline_at);
  if retry and g.expires_at<=clock_timestamp() then return lumin.allocation_receipt(g);end if;
  fresh:=clock_timestamp();
  if not retry and (b.slot_start<fresh+make_interval(mins=>sp.lead_time_minutes) or b.slot_start>fresh+make_interval(hours=>sp.horizon_days*24)) then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  select count(*) into n from(select 1 from public.bookings where lumin.planning_service_id(selection)=sid and state in('pending_payment','confirmed','completed') limit 10001)z;
  total_n:=total_n+n;if n>10000 or total_n>20000 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if n>0 then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  select count(*) into n from(select 1 from public.capacity_holds where service_id=sid and(status='consumed' or(status='active' and expires_at>fresh and slot_start<occupied_end and slot_end>occupied_start)) limit 10001)z;
  total_n:=total_n+n;if n>10000 or total_n>20000 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
  if exists(select 1 from public.capacity_holds where service_id=sid and(status='consumed' or tenant_id<>p_tenant)) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
  select count(*) into used from public.capacity_holds where service_id=sid and status='active' and expires_at>fresh and slot_start<occupied_end and slot_end>occupied_start and not(retry and group_id is not distinct from h.id and group_generation=g.generation);
  if used+1>win_capacity then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  for x in select value from jsonb_array_elements(resources_json) loop
   select count(*) into n from(select 1 from public.resource_reservations where resource_id=(x->>0)::uuid and(status='consumed' or(status='held' and expires_at>fresh)) and slot_start<occupied_end and slot_end>occupied_start limit 10001)z;
   total_n:=total_n+n;if n>10000 or total_n>20000 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
   if exists(select 1 from public.resource_reservations where resource_id=(x->>0)::uuid and tenant_id<>p_tenant and(status='consumed' or(status='held' and expires_at>fresh)) and slot_start<occupied_end and slot_end>occupied_start) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
   select coalesce(sum(quantity::numeric),0) into used from public.resource_reservations where resource_id=(x->>0)::uuid and(status='consumed' or(status='held' and expires_at>fresh)) and slot_start<occupied_end and slot_end>occupied_start and not(retry and group_id is not distinct from h.id and group_generation=g.generation);
   if used+(x->>3)::numeric>(x->>2)::numeric then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  end loop;
  for r in select unnest(worker_ids) id loop
   select count(*) into n from(select 1 from public.worker_interval_holds where worker_id=r.id and status='held' and expires_at>fresh and slot_start<occupied_end and slot_end>occupied_start limit 10001)z;
   total_n:=total_n+n;if n>10000 or total_n>20000 then raise exception 'ALLOCATION_LIMIT' using errcode='54000';end if;
   if exists(select 1 from public.worker_interval_holds where worker_id=r.id and tenant_id<>p_tenant and status='held' and expires_at>fresh and slot_start<occupied_end and slot_end>occupied_start) then raise exception 'ALLOCATION_CORRUPT' using errcode='55000';end if;
   if exists(select 1 from public.worker_interval_holds where worker_id=r.id and status='held' and expires_at>fresh and slot_start<occupied_end and slot_end>occupied_start and not(retry and group_id=h.id and generation=g.generation)) then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
  end loop;
  evidence:=sha256(convert_to(lumin.allocation_encode(jsonb_build_array('lumin/allocation/evidence/v1',encode(intent,'hex'),'UTC',s.duration_minutes,ap.revision,ap.setup_minutes,ap.cleanup_minutes,ap.ttl_seconds,ap.resource_mode,roster,lumin.allocation_us(occupied_start),lumin.allocation_us(occupied_end),chosen,policy_json,tier,rules_json,workers_json,resources_json)),'UTF8'));
  if retry then
   perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.allocation_deadline(deadline_at);
   if g.expires_at<=clock_timestamp() then return lumin.allocation_receipt(g);end if;
   if g.evidence_hash<>evidence then raise exception 'ALLOCATION_EVIDENCE_CHANGED' using errcode='40001';end if;
   return lumin.allocation_receipt(g);
  end if;
 exception when sqlstate 'P0001' or sqlstate '0A000' or sqlstate '54000' or sqlstate '40001' then
  if retry and g.expires_at<=clock_timestamp() then perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.group_validate(p_tenant,h.id,g.generation);perform lumin.allocation_deadline(deadline_at);return lumin.allocation_receipt(g);end if;raise;
 end;
 -- Fresh timestamps are derived once after admission waits, never transaction now().
 perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.allocation_deadline(deadline_at);
 fresh:=clock_timestamp();expiry:=fresh+make_interval(secs=>ap.ttl_seconds);
 perform lumin.allocation_us(fresh);perform lumin.allocation_us(expiry);
 if b.slot_start<fresh+make_interval(mins=>sp.lead_time_minutes) or b.slot_start>fresh+make_interval(hours=>sp.horizon_days*24) then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
 -- Use only the trusted extension-owned function binding, never search_path lookup.
 select ns.nspname into key_schema from pg_catalog.pg_extension e join pg_catalog.pg_namespace ns on ns.oid=e.extnamespace join pg_catalog.pg_proc p on p.pronamespace=ns.oid and p.proname='gen_random_bytes' and p.proargtypes='23'::oidvector join pg_catalog.pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass and d.refobjid=e.oid and d.deptype='e'
 where e.extname='pgcrypto' and ns.nspname in('public','extensions') and e.extowner=(select oid from pg_roles where rolname='postgres') and p.proowner=e.extowner and p.prokind='f' and p.prorettype='bytea'::regtype and not p.proretset
 and p.provariadic=0 and p.pronargs=1 and p.pronargdefaults=0 and p.proallargtypes is null and p.proargmodes is null
 and p.proargdefaults is null and p.proconfig is null and not p.prosecdef and not p.proleakproof and p.proisstrict
 and p.provolatile='v' and p.proparallel='s' and p.procost=1 and p.prorows=0 and p.proargnames is null and p.prosupport=0
 and p.protrftypes is null and p.prosqlbody is null and p.prolang=(select oid from pg_language where lanname='c')
 and p.prosrc='pg_random_bytes' and p.probin='$libdir/pgcrypto' and d.objsubid=0;
 if key_schema is null then raise exception 'ALLOCATION_PROTOCOL' using errcode='55000';end if;
 gid:=coalesce(h.id,gen_random_uuid());
 -- Narrow construction window; always force these validators IMMEDIATE before return.
 set constraints public.group_final,public.allocation_head_current_generation deferred;
 if h.id is null then insert into public.allocation_group_heads values(p_tenant,gid,p_booking,p_target_generation);
 else update public.allocation_group_heads set current_generation=p_target_generation where tenant_id=p_tenant and id=gid;end if;
 manifest:=sha256(convert_to(jsonb_build_array(1,to_jsonb(worker_ids),(select coalesce(jsonb_agg(jsonb_build_array(value->0,value->3) order by (value->>0)::uuid),'[]'::jsonb) from jsonb_array_elements(resources_json)))::text,'UTF8'));
 insert into public.allocation_groups(tenant_id,id,generation,booking_id,service_id,crew_id,policy_revision,roster_version,requested_start,requested_end,occupied_start,occupied_end,setup_minutes,cleanup_minutes,created_at,expires_at,resource_mode,intent_hash,evidence_hash,manifest_digest,worker_count,resource_count,status,sealed)
 values(p_tenant,gid,p_target_generation,p_booking,sid,p_crew,ap.revision,roster,b.slot_start,b.slot_end,occupied_start,occupied_end,ap.setup_minutes,ap.cleanup_minutes,fresh,expiry,ap.resource_mode,intent,evidence,manifest,cardinality(worker_ids),cardinality(resource_ids),'held',false);
 insert into public.allocation_group_workers select p_tenant,gid,p_target_generation,unnest(worker_ids);
 insert into public.allocation_group_resources select p_tenant,gid,p_target_generation,(value->>0)::uuid,(value->>3)::integer from jsonb_array_elements(resources_json);
 execute format('select encode(%I.gen_random_bytes(16),''hex'')',key_schema) into hold_key_value;
 if exists(select 1 from public.capacity_holds where booking_id=p_booking) then
  update public.capacity_holds set group_generation=p_target_generation,slot_start=occupied_start,slot_end=occupied_end,expires_at=expiry,status='active',hold_key=hold_key_value where tenant_id=p_tenant and booking_id=p_booking and group_id=gid;
 else
  insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,group_id,group_generation) values(p_tenant,sid,p_booking,occupied_start,occupied_end,hold_key_value,'active',expiry,gid,p_target_generation);
 end if;
 for x in select value from jsonb_array_elements(resources_json) loop
  execute format('select encode(%I.gen_random_bytes(16),''hex'')',key_schema) into hold_key_value;
  if exists(select 1 from public.resource_reservations where booking_id=p_booking and resource_id=(x->>0)::uuid) then
   update public.resource_reservations set group_generation=p_target_generation,slot_start=occupied_start,slot_end=occupied_end,expires_at=expiry,status='held',hold_key=hold_key_value,quantity=(x->>3)::integer where tenant_id=p_tenant and booking_id=p_booking and group_id=gid and resource_id=(x->>0)::uuid;
  else
   insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity,group_id,group_generation) values(p_tenant,(x->>0)::uuid,p_booking,occupied_start,occupied_end,hold_key_value,'held',expiry,(x->>3)::integer,gid,p_target_generation);
  end if;
 end loop;
 insert into public.worker_interval_holds select p_tenant,gid,p_target_generation,unnest(worker_ids),occupied_start,occupied_end,expiry,'held';
 perform lumin.allocation_deadline(deadline_at);
 update public.allocation_groups set sealed=true where tenant_id=p_tenant and id=gid and generation=p_target_generation;
 set constraints public.group_final,public.allocation_head_current_generation immediate;
 perform lumin.group_validate(p_tenant,gid,p_target_generation);perform lumin.flow_actor(p_actor,p_tenant,true);perform lumin.allocation_deadline(deadline_at);
 fresh:=clock_timestamp();
 if fresh>=expiry then raise exception 'ALLOCATION_DEADLINE' using errcode='57014';end if;
 if b.slot_start<fresh+make_interval(mins=>sp.lead_time_minutes) or b.slot_start>fresh+make_interval(hours=>sp.horizon_days*24) then raise exception 'ALLOCATION_UNAVAILABLE' using errcode='P0001';end if;
 select * into g from public.allocation_groups where tenant_id=p_tenant and id=gid and generation=p_target_generation;
 return lumin.allocation_receipt(g);
end$$;
revoke all on function lumin.allocation_encode(jsonb),lumin.allocation_us(timestamptz),lumin.allocation_deadline(timestamptz),lumin.allocation_receipt(public.allocation_groups),public.allocate_planning_group(uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.allocate_planning_group(uuid,uuid,uuid,uuid,bigint) to service_role;
commit;
