\set ON_ERROR_STOP on
begin;
\ir group_lifecycle_fixture.sql
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a2900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,c text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=c then return;end if;raise;end;raise exception 'EXPECTED %',c;end$$;
select pg_temp.ok(lumin.allocation_encode('["é",null,true,[],9007199254740991]')='1:52:é-1:1:11:016:9007199254740991','UTF8/null/nesting/safeinteger bytes');
select pg_temp.ok(lumin.allocation_us('1969-12-31T23:59:59.999999Z')='-1','negative microsecond exact');
-- Independent Arendt oracle vector, not derived from the SQL encoder.
select pg_temp.ok(encode(sha256(convert_to(lumin.allocation_encode('["lumin/allocation/intent/v1","10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002",9007199254740991,"30000000-0000-4000-8000-000000000003","40000000-0000-4000-8000-000000000004","-1","60000000"]'),'UTF8')),'hex')='5c9b9493bce305d9d30e61500bd43fa7cd0ad32723164c03d2102064f3c2ecf0','known independent intent SHA256');
select pg_temp.fixture_parents(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7));
update public.bookings set slot_start=((clock_timestamp() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'+interval '10 hours',slot_end=((clock_timestamp() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'+interval '11 hours' where id=pg_temp.id(3);
insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values(pg_temp.id(2),pg_temp.id(4),0,30,30);
insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select pg_temp.id(2),pg_temp.id(4),extract(dow from slot_start at time zone 'UTC'),0,1440,2 from public.bookings where id=pg_temp.id(3);
insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active) select pg_temp.id(9),pg_temp.id(2),pg_temp.id(6),'available',slot_start-interval '10 hours',slot_end+interval '13 hours','UTC',true from public.bookings where id=pg_temp.id(3);
set local statement_timeout='5s';
set local lock_timeout='5s';
-- Duplicate selected overrides reject before a UUID-ordered closed row masks ambiguity.
insert into public.availability_overrides(id,tenant_id,service_id,date,kind,start_minute,end_minute,capacity) select pg_temp.id(80),pg_temp.id(2),pg_temp.id(4),(slot_start at time zone 'UTC')::date,'closed',null,null,null from public.bookings where id=pg_temp.id(3);
insert into public.availability_overrides(id,tenant_id,service_id,date,kind,start_minute,end_minute,capacity) select pg_temp.id(81),pg_temp.id(2),pg_temp.id(4),(slot_start at time zone 'UTC')::date,'open',0,1440,2 from public.bookings where id=pg_temp.id(3);
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),1)','0A000');
delete from public.availability_overrides;
set constraints all immediate;
set local role service_role;
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),1);
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),1);
reset role;
select pg_temp.ok((select count(*)=1 from public.allocation_groups) and(select count(*)=1 from public.capacity_holds) and(select count(*)=1 from public.resource_reservations),'actual persisted group and carriers');
select pg_temp.ok((select g.sealed and g.status='held' and g.expires_at=c.expires_at and g.expires_at=r.expires_at and g.expires_at=w.expires_at from public.allocation_groups g join public.capacity_holds c on c.group_id=g.id join public.resource_reservations r on r.group_id=g.id join public.worker_interval_holds w on w.group_id=g.id),'one absolute expiry');
select pg_temp.ok(not exists(select 1 from public.payments) and(select state='draft' from public.bookings where id=pg_temp.id(3)),'draft no financial effects');
create temp table original_carrier as select id,hold_key from public.resource_reservations;
select public.release_planning_group(pg_temp.id(1),pg_temp.id(2),(select id from public.allocation_group_heads),1);
delete from public.service_resources where service_id=pg_temp.id(4);
select public.save_allocation_policy(pg_temp.id(1),pg_temp.id(2),pg_temp.id(4),1,0,0,120,'none');
set constraints public.group_final,public.allocation_head_current_generation deferred;
set local role service_role;
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),2);
reset role;
select public.release_planning_group(pg_temp.id(1),pg_temp.id(2),(select id from public.allocation_group_heads),2);
insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values(pg_temp.id(2),pg_temp.id(4),pg_temp.id(7),2);
select public.save_allocation_policy(pg_temp.id(1),pg_temp.id(2),pg_temp.id(4),2,0,0,120,'linked');
-- Terminal receipt ignores changed/disabled current crew; new generation does not.
update public.crews set active=false where id=pg_temp.id(5);
set constraints public.group_final,public.allocation_head_current_generation deferred;
set local role service_role;
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),2);
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),3)','P0001');
reset role;
update public.crews set active=true where id=pg_temp.id(5);
-- Last-stage injected failure must roll back rebind/head/manifests together.
create function pg_temp.reject_seal() returns trigger language plpgsql as $$begin if new.generation=3 and new.sealed then raise exception 'fixture seal failure' using errcode='23514';end if;return new;end$$;
create trigger zz_fixture_seal before update on public.allocation_groups for each row execute function pg_temp.reject_seal();
set local role service_role;
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),3)','23514');
reset role;
select pg_temp.ok((select current_generation=2 from public.allocation_group_heads) and(select group_generation=1 and status='released' from public.resource_reservations) and(select count(*)=2 from public.allocation_groups),'failed gen3 preserves all history');
drop trigger zz_fixture_seal on public.allocation_groups;
set local role service_role;
select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),3);
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),2)','40001');
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(99),pg_temp.id(5),1)','P0002');
select pg_temp.reject('select lumin.allocation_encode(''[]''::jsonb)','42501');
reset role;
select pg_temp.ok((select r.id=o.id and r.hold_key<>o.hold_key and r.group_generation=3 and r.quantity=2 from public.resource_reservations r cross join original_carrier o) and(select count(*)=3 from public.allocation_groups),'same physical R returns1 to3 fresh key');
set local lock_timeout='0';
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),3)','55000');
set local lock_timeout='5s';
set local statement_timeout='0';
select pg_temp.reject('select public.allocate_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(5),3)','55000');
rollback;
\echo PLANNING ALLOCATOR TESTS PASS
