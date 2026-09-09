\set ON_ERROR_STOP on
begin;
\ir group_lifecycle_fixture.sql
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a2500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(p boolean,label text) returns void language plpgsql as $$begin if p is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin
 begin execute q;set constraints all immediate;exception when others then if sqlstate=code then return;end if;raise;end;
 raise exception 'EXPECTED % for %',code,q;
end $$;
create function pg_temp.release(gen bigint default 1) returns jsonb language sql as $$select public.release_planning_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(8),gen)$$;
select pg_temp.reject('select lumin.group_require_fence()','55000');
select pg_temp.fixture_parents(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7));
select pg_temp.fixture_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(8),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7),1,clock_timestamp()+interval '120 seconds');
set constraints all immediate;
select pg_temp.ok((select sealed and status='held' and worker_count=1 and resource_count=1 from public.allocation_groups),'complete sealed group');
select pg_temp.ok((select count(distinct expires_at)=1 from(select expires_at from public.capacity_holds union all select expires_at from public.resource_reservations union all select expires_at from public.worker_interval_holds union all select expires_at from public.allocation_groups)x),'exact common expiry');
set constraints all deferred;
select pg_temp.reject('update public.allocation_group_heads set current_generation=2','40001');
select pg_temp.reject('update public.allocation_group_heads set id=pg_temp.id(99)','55000');
select pg_temp.reject('update public.allocation_groups set sealed=false','55000');
select pg_temp.reject('update public.allocation_groups set expires_at=expires_at+interval ''1 second''','55000');
select pg_temp.reject('update public.allocation_groups set worker_count=2','55000');
select pg_temp.reject('insert into public.allocation_group_workers values(pg_temp.id(2),pg_temp.id(8),1,pg_temp.id(99))','55000');
select pg_temp.reject('delete from public.allocation_group_resources','55000');
select pg_temp.reject('update public.capacity_holds set group_id=null,group_generation=null','0A000');
select pg_temp.reject('update public.resource_reservations set group_generation=2','55000');
select pg_temp.reject('update public.resource_reservations set quantity=2','55000');
select pg_temp.reject('update public.capacity_holds set status=''consumed''','55000');
select pg_temp.reject('update public.capacity_holds set status=''released''','55000');
select pg_temp.reject('delete from public.worker_interval_holds','0A000');
select pg_temp.reject('delete from public.bookings where id=pg_temp.id(3)','0A000');
select pg_temp.reject('update public.bookings set slot_end=slot_end+interval ''1 hour'' where id=pg_temp.id(3)','0A000');
select pg_temp.reject('delete from public.resources where id=pg_temp.id(7)','0A000');
select pg_temp.reject('delete from public.workers where id=pg_temp.id(6)','0A000');
select pg_temp.reject('delete from public.crews where id=pg_temp.id(5)','0A000');
select pg_temp.reject('delete from public.tenants where id=pg_temp.id(2)','0A000');
select pg_temp.reject('truncate public.allocation_groups cascade','0A000');
select pg_temp.reject('truncate public.capacity_holds','0A000');
-- Original cascade and owner retirement behavior is covered by preserved suites.
update public.workers set active=false where id=pg_temp.id(6);
select pg_temp.ok((select status='active' from public.capacity_holds),'retirement does not release');
set local role service_role;
select pg_temp.reject('select * from public.allocation_groups','42501');
select pg_temp.reject('select lumin.group_prefix(true)','42501');
select pg_temp.reject('select pg_temp.fixture_group(null,null,null,null,null,null,null,null,1,now())','42501');
select pg_temp.reject('select public.release_planning_group(pg_temp.id(99),pg_temp.id(2),pg_temp.id(8),1)','42501');
select pg_temp.reject('select pg_temp.release(2)','40001');
do $$declare ns text;fn text;q text;begin
 foreach ns in array array['public','lumin'] loop
  foreach fn in array array['consume_hold','release_hold','consume_resource_holds','release_resource_holds'] loop
   perform pg_temp.reject(format('select %I.%I(pg_temp.id(3))',ns,fn),'0A000');
  end loop;
  q:=format('select * from %I.reserve_capacity(pg_temp.id(99),pg_temp.id(98),''2035-01-01T10:00Z'',''2035-01-01T11:00Z'',pg_temp.id(3),1,interval ''1 minute'')',ns);
  perform pg_temp.reject(q,'0A000');
  q:=format('select * from %I.reserve_resource(pg_temp.id(99),pg_temp.id(98),''2035-01-01T10:00Z'',''2035-01-01T11:00Z'',pg_temp.id(3),interval ''1 minute'')',ns);
  perform pg_temp.reject(q,'0A000');
 end loop;
 perform pg_temp.reject('select * from lumin.reserve_resource_quantity(pg_temp.id(99),pg_temp.id(98),''2035-01-01T10:00Z'',''2035-01-01T11:00Z'',pg_temp.id(3),interval ''1 minute'',1)','0A000');
end $$;
reset role;
-- Inject final group-state failure to prove the preceding carrier effects roll back.
create function pg_temp.fail_terminal() returns trigger language plpgsql as $$begin if new.status<>'held' then raise exception 'injected failure';end if;return new;end$$;
create trigger zz_test_failure before update on public.allocation_groups for each row execute function pg_temp.fail_terminal();
select pg_temp.reject('select pg_temp.release()','P0001');
select pg_temp.ok((select status='active' from public.capacity_holds) and(select status='held' from public.resource_reservations),'failed closure rolled back all carriers');
drop trigger zz_test_failure on public.allocation_groups;
-- Support callers choosing immediate constraints: closure remains one statement.
set constraints all immediate;
set local role service_role;
select pg_temp.ok(pg_temp.release()->>'status'='released','owner release');
select pg_temp.ok(pg_temp.release()->>'status'='released','idempotent terminal receipt');
reset role;
set constraints all deferred;
select pg_temp.reject('update public.allocation_groups set status=''held''','55000');
select pg_temp.reject('delete from public.bookings where id=pg_temp.id(3)','0A000');
select pg_temp.reject('insert into public.allocation_group_workers values(pg_temp.id(2),pg_temp.id(8),1,pg_temp.id(99))','55000');
select pg_temp.reject('update public.allocation_group_heads set current_generation=3','40001');
-- Deferred head FK and unsealed commit are checked independently.
create function pg_temp.stage_unsealed() returns void language plpgsql as $$begin
 update public.allocation_group_heads set current_generation=2;
 insert into public.allocation_groups select (jsonb_populate_record(null::public.allocation_groups,to_jsonb(g)||'{"generation":2,"sealed":false,"status":"held"}'::jsonb)).* from public.allocation_groups g where generation=1;
end$$;
select pg_temp.reject('update public.allocation_group_heads set current_generation=2','23503');
select pg_temp.reject('select pg_temp.stage_unsealed()','55000');
create function pg_temp.foreign_worker() returns void language plpgsql as $$begin perform pg_temp.stage_unsealed();insert into public.allocation_group_workers values(pg_temp.id(2),pg_temp.id(8),2,pg_temp.id(99));end$$;
select pg_temp.reject('select pg_temp.foreign_worker()','23503');
-- Terminal planning history deliberately does not permit cancellation/reschedule yet.
select pg_temp.reject('update public.bookings set state=''cancelled'' where id=pg_temp.id(3)','P0001');
select pg_temp.reject('update public.bookings set state=''failed'' where id=pg_temp.id(3)','0A000');

select pg_temp.fixture_group(pg_temp.id(1),pg_temp.id(2),pg_temp.id(3),pg_temp.id(8),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(7),2,clock_timestamp()-interval '1 second');
set constraints all immediate;
select pg_temp.ok((select count(*)=2 from public.allocation_group_workers),'historical manifest retained after rebind');
set local role service_role;
select pg_temp.reject('select pg_temp.release(1)','40001');
select pg_temp.ok(pg_temp.release(2)->>'status'='expired','fresh clock selects expired');
reset role;
select pg_temp.ok((select count(*)=2 from public.allocation_groups where sealed and status in('released','expired')),'both terminal generations retained');
select pg_temp.ok((select bool_and(state='draft') from public.bookings),'no confirmation');
select pg_temp.ok((select count(*)=0 from public.payments),'no payments');
select pg_temp.ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('public.allocation_group_heads'::regclass,'public.allocation_groups'::regclass,'public.allocation_group_resources'::regclass,'public.allocation_group_workers'::regclass,'public.worker_interval_holds'::regclass)),'all new tables force RLS');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='lumin'::regnamespace and p.proname like 'group_%' and(has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'all helpers private');
rollback;
-- Isolation checks must precede invalid arguments/identity; all legacy paths covered.
begin isolation level repeatable read;
set local role service_role;
do $$declare ns text;fn text;q text;begin
 foreach ns in array array['public','lumin'] loop
  foreach fn in array array['consume_hold','release_hold','consume_resource_holds','release_resource_holds','reserve_capacity','reserve_resource'] loop
   q:=case when fn='reserve_capacity' then format('select * from %I.%I(null,null,null,null,null,null,null)',ns,fn) when fn='reserve_resource' then format('select * from %I.%I(null,null,null,null,null,null)',ns,fn) else format('select %I.%I(null)',ns,fn) end;
   begin execute q;raise exception 'isolation accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;
  end loop;
 end loop;
 begin perform public.release_planning_group(null,null,null,null);raise exception 'isolation accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;
 begin perform lumin.reserve_resource_quantity(null,null,null,null,null,null,null);raise exception 'isolation accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;
end$$;
rollback;
begin isolation level serializable;
set local role service_role;
do $$begin begin perform public.release_planning_group(null,null,null,null);raise exception 'isolation accepted';exception when feature_not_supported then if sqlerrm<>'GROUP_ISOLATION_UNSUPPORTED' then raise;end if;end;end$$;
rollback;
\echo GROUP LIFECYCLE SQL TESTS PASS
