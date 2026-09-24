-- Synthetic, transactional composition proof for the current-main 0028
-- planning allocator and 0031 exclusive-resource backstop. Run only on a
-- disposable database with 0001..0031 applied. Sequential admission is tested
-- here; this fixture makes no claim about simultaneous transaction races.
\set ON_ERROR_STOP on
begin;
\ir group_lifecycle_fixture.sql

create function pg_temp.id(n integer) returns uuid language sql immutable as
  $$ select ('d2900000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as
  $$ begin if v is distinct from true then raise exception 'FAIL: %', label; end if;
     raise notice 'PASS: %', label; end $$;
create function pg_temp.reject(q text, code text, label text, expected_constraint text default null)
 returns void language plpgsql as
  $$ declare actual_constraint text;
     begin
       begin execute q;
       exception when others then
         get stacked diagnostics actual_constraint = constraint_name;
         if sqlstate = code and (expected_constraint is null or actual_constraint = expected_constraint)
           then raise notice 'PASS: %', label; return; end if;
         raise exception 'FAIL: %: SQLSTATE %, expected %', label, sqlstate, code;
       end;
       raise exception 'FAIL: %: accepted', label;
     end $$;

-- Tenant A has two independent crews and draft bookings competing for one
-- exclusive vehicle. Tenant B supplies a foreign booking for the FK attack.
select pg_temp.fixture_parents(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),
  pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7));
select pg_temp.fixture_parents(pg_temp.id(11),pg_temp.id(12),pg_temp.id(13),
  pg_temp.id(14),pg_temp.id(15),pg_temp.id(16),pg_temp.id(17));
update public.resources set capacity=1 where id=pg_temp.id(7);
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end)
  values(pg_temp.id(8),pg_temp.id(2),'composition-2','composition-booking-2',
    jsonb_build_object('serviceId',pg_temp.id(4)),'2035-01-01T10:00Z','2035-01-01T11:00Z');
insert into public.workers(id,tenant_id,display_name) values(pg_temp.id(18),pg_temp.id(2),'Other worker');
insert into public.crews(id,tenant_id,name) values(pg_temp.id(19),pg_temp.id(2),'Other crew');
insert into public.crew_members values(pg_temp.id(2),pg_temp.id(19),pg_temp.id(18));
insert into public.service_worker_eligibility values(pg_temp.id(2),pg_temp.id(4),pg_temp.id(18),true);

-- Keep both slots inside a live, UTC schedule. Each worker has an independent
-- shift, so the second allocation's rejection isolates the scarce resource.
update public.bookings
   set slot_start=((clock_timestamp() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'+interval '10 hours',
       slot_end=((clock_timestamp() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'+interval '11 hours'
 where id in(pg_temp.id(3),pg_temp.id(8));
insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes)
 values(pg_temp.id(2),pg_temp.id(4),0,30,30);
insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity)
 select pg_temp.id(2),pg_temp.id(4),extract(dow from slot_start at time zone 'UTC'),0,1440,2
   from public.bookings where id=pg_temp.id(3);
insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active)
 select pg_temp.id(20),pg_temp.id(2),pg_temp.id(6),'available',slot_start-interval '1 hour',slot_end+interval '1 hour','UTC',true
   from public.bookings where id=pg_temp.id(3);
insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active)
 select pg_temp.id(21),pg_temp.id(2),pg_temp.id(18),'available',slot_start-interval '1 hour',slot_end+interval '1 hour','UTC',true
   from public.bookings where id=pg_temp.id(8);
set local statement_timeout='5s';
set local lock_timeout='5s';

set local role service_role;
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),1);
reset role;
select pg_temp.ok(
  (select count(*)=1 from public.resource_reservations where resource_id=pg_temp.id(7)
     and status='held' and is_exclusive and group_id is not null)
  and (select count(*)=1 from public.allocation_groups where sealed and status='held')
  and (select count(*)=1 from public.capacity_holds where booking_id=pg_temp.id(3) and status='active'),
  'allocator creates a sealed group with an exclusive resource carrier');

-- Direct privileged bypass of the allocator is still stopped by the storage
-- constraint; a cross-tenant booking also fails its tenant FK, with no row.
select pg_temp.reject(format(
  'insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) select %L::uuid,%L::uuid,%L::uuid,slot_start,slot_end,%L,%L,clock_timestamp()+interval ''5 minutes'' from public.bookings where id=%L::uuid',
  pg_temp.id(2),pg_temp.id(7),pg_temp.id(8),'direct-overlap','held',pg_temp.id(8)),
  '23P01','direct overlapping exclusive reservation rejected',
  'resource_reservations_no_exclusive_overlap');
select pg_temp.reject(format(
  'insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) select %L::uuid,%L::uuid,%L::uuid,slot_start,slot_end,%L,%L,clock_timestamp()+interval ''5 minutes'' from public.bookings where id=%L::uuid',
  pg_temp.id(2),pg_temp.id(7),pg_temp.id(13),'foreign-booking','held',pg_temp.id(3)),
  '23503','cross-tenant booking/resource carrier rejected by tenant FK');
select pg_temp.ok((select count(*)=1 from public.resource_reservations where resource_id=pg_temp.id(7)),
  'failed direct writes leave the first exclusive carrier intact');

set local role service_role;
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(8),pg_temp.id(19),1)',
  'P0001','second independent crew cannot allocate the occupied exclusive resource');
reset role;
select pg_temp.ok(
  (select count(*)=1 from public.allocation_group_heads)
  and not exists(select 1 from public.allocation_groups where booking_id=pg_temp.id(8))
  and not exists(select 1 from public.worker_interval_holds where worker_id=pg_temp.id(18))
  and (select count(*)=1 from public.resource_reservations where resource_id=pg_temp.id(7))
  and not exists(select 1 from public.capacity_holds where booking_id=pg_temp.id(8))
  and not exists(select 1 from public.payments),
  'failed allocator call leaves no second group, hold, reservation, or payment');

-- Positive control: clearing only the first group frees the vehicle; the
-- previously rejected booking and its independent crew then allocate.
select public.release_planning_group(pg_temp.id(1),pg_temp.id(2),
  (select id from public.allocation_group_heads where booking_id=pg_temp.id(3)),1);
set local role service_role;
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(8),pg_temp.id(19),1);
reset role;
select pg_temp.ok(
  (select count(*)=1 from public.resource_reservations where booking_id=pg_temp.id(3) and status='released')
  and (select count(*)=1 from public.resource_reservations where booking_id=pg_temp.id(8)
     and status='held' and is_exclusive)
  and (select count(*)=1 from public.allocation_groups where booking_id=pg_temp.id(8)
     and sealed and status='held'),
  'after release the second crew can acquire the same exclusive resource');
rollback;
\echo RESOURCE BACKSTOP COMPOSITION TESTS PASS
