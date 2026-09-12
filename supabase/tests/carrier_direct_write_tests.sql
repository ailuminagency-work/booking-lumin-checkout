\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(p boolean,msg text) returns void language plpgsql as $$begin if p is distinct from true then raise exception 'ASSERT: %',msg;end if;end$$;
create function pg_temp.denied(q text) returns void language plpgsql as $$begin begin execute q;exception when insufficient_privilege then return;end;raise exception 'EXPECTED 42501: %',q;end$$;
insert into public.tenants(id,name,slug,timezone,currency) values('a2240000-0000-4000-8000-000000000001','Carrier','carrier-boundary','UTC','USD');
insert into public.services(id,tenant_id,name,archetype,currency,base_price) values('a2240000-0000-4000-8000-000000000002','a2240000-0000-4000-8000-000000000001','Service','simple','USD',0);
insert into public.resources(id,tenant_id,name,capacity) values('a2240000-0000-4000-8000-000000000003','a2240000-0000-4000-8000-000000000001','Resource',3);
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end)
 select ('a2240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a2240000-0000-4000-8000-000000000001','CARRIER-'||n,'carrier-fixture-'||n,'{"serviceId":"a2240000-0000-4000-8000-000000000002"}', '2035-01-01T10:00Z','2035-01-01T11:00Z' from generate_series(10,12)n;
set local role service_role;
do $$declare t text;begin
 foreach t in array array['capacity_holds','resource_reservations'] loop
  perform pg_temp.denied(format('insert into public.%I default values',t));
  perform pg_temp.denied(format('update public.%I set status=status where false',t));
  perform pg_temp.denied(format('delete from public.%I where false',t));
  perform pg_temp.denied(format('truncate public.%I',t));
  perform pg_temp.denied(format('select * from public.%I for update',t));
  perform pg_temp.denied(format('select * from public.%I for no key update',t));
 end loop;
end $$;
select pg_temp.denied('select * from lumin.reserve_capacity_nonplanning(null,null,null,null,null,null,null)');
-- Actual invoker wrappers must still reach their definer writers after REVOKE.
select pg_temp.ok((select result='GRANTED' from public.reserve_capacity('a2240000-0000-4000-8000-000000000001','a2240000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z','a2240000-0000-4000-8000-000000000010',2,interval '5 minutes')),'capacity reserve');
select pg_temp.ok(public.consume_hold('a2240000-0000-4000-8000-000000000010'),'capacity consume');
select pg_temp.ok((select result='GRANTED' and hold_status='consumed' from public.reserve_capacity('a2240000-0000-4000-8000-000000000001','a2240000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z','a2240000-0000-4000-8000-000000000010',2,interval '5 minutes')),'capacity idempotent consumed');
select pg_temp.ok((select result='GRANTED' from public.reserve_capacity('a2240000-0000-4000-8000-000000000001','a2240000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z','a2240000-0000-4000-8000-000000000011',2,interval '5 minutes')),'second capacity');
select pg_temp.ok(public.release_hold('a2240000-0000-4000-8000-000000000011'),'capacity release');
select pg_temp.ok((select status='consumed' and expires_at>now() from public.capacity_holds where booking_id='a2240000-0000-4000-8000-000000000010'),'webhook direct SELECT retained');
select pg_temp.ok((select result='GRANTED' from public.reserve_resource('a2240000-0000-4000-8000-000000000001','a2240000-0000-4000-8000-000000000003','2035-01-01T10:00Z','2035-01-01T11:00Z','a2240000-0000-4000-8000-000000000010',interval '5 minutes')),'legacy resource reserve');
select pg_temp.ok((select result='GRANTED' from lumin.reserve_resource_quantity('a2240000-0000-4000-8000-000000000001','a2240000-0000-4000-8000-000000000003','2035-01-01T10:00Z','2035-01-01T11:00Z','a2240000-0000-4000-8000-000000000011',interval '5 minutes',2)),'quantity resource reserve');
select pg_temp.ok((select sum(quantity)=3 from public.resource_reservations),'complete resource SELECT');
select pg_temp.ok(public.consume_resource_holds('a2240000-0000-4000-8000-000000000010')=1,'resource consume');
select pg_temp.ok(public.release_resource_holds('a2240000-0000-4000-8000-000000000011')=1,'resource release');
select pg_temp.ok((select count(*)=2 from public.resource_reservations),'no removal by release');
reset role;
set local role anon;
select pg_temp.denied('select * from public.capacity_holds');select pg_temp.denied('select * from public.resource_reservations');
select pg_temp.denied('insert into public.capacity_holds default values');select pg_temp.denied('insert into public.resource_reservations default values');
reset role;
set local role authenticated;
select pg_temp.denied('select * from public.capacity_holds');select pg_temp.denied('select * from public.resource_reservations');
select pg_temp.denied('update public.capacity_holds set status=status');select pg_temp.denied('delete from public.resource_reservations');
reset role;
do $$declare r text;t regclass;p text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  foreach t in array array['public.capacity_holds'::regclass,'public.resource_reservations'::regclass] loop
   for p in select privilege_type from aclexplode(acldefault('r',(select oid from pg_roles where rolname=current_user))) loop
    perform pg_temp.ok(has_table_privilege(r,t,p)=(p='SELECT' and r='service_role'),'effective '||r||' '||t||' '||p);
    perform pg_temp.ok(not has_table_privilege(r,t,p||' WITH GRANT OPTION'),'no grant option');
   end loop;
   perform pg_temp.ok(not has_any_column_privilege(r,t,'INSERT,UPDATE,REFERENCES'),'no column write');
  end loop;
 end loop;
end $$;
select pg_temp.ok((select bool_and(state='draft') from public.bookings where tenant_id='a2240000-0000-4000-8000-000000000001'),'no confirmation');
rollback;
\echo CARRIER DIRECT WRITE TESTS PASS
