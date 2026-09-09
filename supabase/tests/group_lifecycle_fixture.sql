-- TEST ONLY, privileged invoker helpers in this session's pg_temp schema.
-- Prepare/commit parents before an observed race; group construction takes its
-- prefix before any group/carrier row locks. Never install application helpers.
create or replace function pg_temp.fixture_parents(a uuid,t uuid,b uuid,s uuid,c uuid,w uuid,r uuid) returns void language plpgsql as $$begin
 insert into auth.users(id,email) values(a,a::text||'@example.test') on conflict(id) do nothing;
 insert into public.tenants(id,name,slug,timezone,currency) values(t,'Group fixture',t::text,'UTC','USD') on conflict(id) do nothing;
 insert into public.tenant_members(tenant_id,user_id,role) values(t,a,'BUSINESS_OWNER') on conflict do nothing;
 insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values(s,t,'Planning service','simple','USD',0,60) on conflict(id) do nothing;
 insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end) values(b,t,b::text,b::text,jsonb_build_object('serviceId',s),'2035-01-01T10:00Z','2035-01-01T11:00Z') on conflict(id) do nothing;
 insert into public.allocation_policies values(t,s,1,0,0,120,case when r is null then 'none' else 'linked' end) on conflict do nothing;
 perform public.roster_provision(a,t);
 perform version from public.worker_roster_state where tenant_id=t for update;
 insert into public.workers(id,tenant_id,display_name) values(w,t,'Worker') on conflict(id) do nothing;
 insert into public.crews(id,tenant_id,name) values(c,t,'Crew') on conflict(id) do nothing;
 insert into public.crew_members values(t,c,w) on conflict do nothing;
 insert into public.service_worker_eligibility values(t,s,w,true) on conflict do nothing;
 if r is not null then
  insert into public.resources(id,tenant_id,name,capacity) values(r,t,'Resource',3) on conflict(id) do nothing;
  insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values(t,s,r,1) on conflict do nothing;
 end if;
end $$;
create or replace function pg_temp.fixture_group(a uuid,t uuid,b uuid,gid uuid,s uuid,c uuid,w uuid,r uuid,gen bigint,expiry timestamptz) returns void language plpgsql as $$
declare digest_value bytea;v bigint;k uuid;
begin
 perform lumin.group_prefix(true);
 lock table public.capacity_holds,public.resource_reservations,public.worker_interval_holds in row exclusive mode;
 perform lumin.flow_actor(a,t,true);select version into v from public.worker_roster_state where tenant_id=t for share;
 if v is null then raise exception 'missing fixture parents';end if;
 perform 1 from public.allocation_group_heads where tenant_id=t and id=gid for update;
 perform 1 from public.bookings where tenant_id=t and id=b for share;
 perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||t::text||':'||s::text,0));
 if r is not null then perform pg_advisory_xact_lock(hashtextextended('lumin:resource-capacity:'||t::text||':'||r::text,0));end if;
 perform pg_advisory_xact_lock(hashtextextended('lumin:worker-capacity:'||t::text||':'||w::text,0));
 if exists(select 1 from public.capacity_holds where booking_id=b and group_id is null) or exists(select 1 from public.resource_reservations where booking_id=b and group_id is null) then raise exception 'GROUP_INCOMPLETE' using errcode='55000';end if;
 if gen=1 then insert into public.allocation_group_heads values(t,gid,b,1);
 else update public.allocation_group_heads set current_generation=gen where tenant_id=t and id=gid;end if;
 digest_value:=public.digest(convert_to(jsonb_build_array(1,jsonb_build_array(w),case when r is null then '[]'::jsonb else jsonb_build_array(jsonb_build_array(r,1)) end)::text,'UTF8'),'sha256');
 insert into public.allocation_groups(tenant_id,id,generation,booking_id,service_id,crew_id,policy_revision,roster_version,requested_start,requested_end,occupied_start,occupied_end,setup_minutes,cleanup_minutes,created_at,expires_at,resource_mode,intent_hash,evidence_hash,manifest_digest,worker_count,resource_count,status,sealed)
 values(t,gid,gen,b,s,c,1,v,'2035-01-01T10:00Z','2035-01-01T11:00Z','2035-01-01T10:00Z','2035-01-01T11:00Z',0,0,least(clock_timestamp(),expiry-interval '120 seconds'),expiry,case when r is null then 'none' else 'linked' end,digest_value,digest_value,digest_value,1,case when r is null then 0 else 1 end,'held',false);
 insert into public.allocation_group_workers values(t,gid,gen,w);
 if r is not null then insert into public.allocation_group_resources values(t,gid,gen,r,1);end if;
 if gen=1 then
  insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,group_id,group_generation) values(t,s,b,'2035-01-01T10:00Z','2035-01-01T11:00Z','synthetic','active',expiry,gid,gen);
  if r is not null then insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity,group_id,group_generation) values(t,r,b,'2035-01-01T10:00Z','2035-01-01T11:00Z','synthetic','held',expiry,1,gid,gen);end if;
 else
  update public.capacity_holds set group_generation=gen,status='active',expires_at=expiry where tenant_id=t and group_id=gid and booking_id=b;
  if r is not null then update public.resource_reservations set group_generation=gen,status='held',expires_at=expiry where tenant_id=t and group_id=gid and resource_id=r and booking_id=b;end if;
 end if;
 insert into public.worker_interval_holds values(t,gid,gen,w,'2035-01-01T10:00Z','2035-01-01T11:00Z',expiry,'held');
 update public.allocation_groups set sealed=true where tenant_id=t and id=gid and generation=gen;
end $$;
revoke all on function pg_temp.fixture_parents(uuid,uuid,uuid,uuid,uuid,uuid,uuid),pg_temp.fixture_group(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
