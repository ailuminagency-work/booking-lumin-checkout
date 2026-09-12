\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;
insert into public.tenants(id,name,slug,timezone,currency,status) values('a2600000-0000-4000-8000-000000000001','Crypto fixture','crypto-layout-fixture','UTC','USD','active');
insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes) values('a2600000-0000-4000-8000-000000000002','a2600000-0000-4000-8000-000000000001','simple','Fixture service','USD',0,60);
insert into public.resources(id,tenant_id,name,capacity) values('a2600000-0000-4000-8000-000000000003','a2600000-0000-4000-8000-000000000001','Fixture resource',3);
insert into public.bookings(id,tenant_id,reference,selection,slot_start,slot_end,idempotency_key) values('a2600000-0000-4000-8000-000000000004','a2600000-0000-4000-8000-000000000001','CRYPTO-FIXTURE','{"serviceId":"a2600000-0000-4000-8000-000000000002"}','2035-01-01T10:00Z','2035-01-01T11:00Z','crypto-layout-fixture');
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reserve_pair() returns void language plpgsql as $$begin
 perform pg_temp.assert((select result='GRANTED' from public.reserve_capacity('a2600000-0000-4000-8000-000000000001','a2600000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z','a2600000-0000-4000-8000-000000000004',1,interval '120 seconds')),'capacity granted');
 perform pg_temp.assert((select result='GRANTED' from lumin.reserve_resource_quantity('a2600000-0000-4000-8000-000000000001','a2600000-0000-4000-8000-000000000003','2035-01-01T10:00Z','2035-01-01T11:00Z','a2600000-0000-4000-8000-000000000004',interval '120 seconds',2)),'resource granted');
end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'EXPECTED %',code;end$$;
set local role anon;
select pg_temp.reject('select pg_temp.reserve_pair()','42501');
reset role;
set local role authenticated;
select pg_temp.reject('select pg_temp.reserve_pair()','42501');
reset role;
set local role service_role;
select pg_temp.reserve_pair();
reset role;
create temporary table keys_before as select 'capacity' kind,id,hold_key from public.capacity_holds union all select 'resource',id,hold_key from public.resource_reservations;
select pg_temp.assert((select count(*)=2 and bool_and(hold_key ~ '^[0-9a-f]{32}$') from keys_before),'first native random keys');
set local role service_role;
select pg_temp.reserve_pair();
reset role;
select pg_temp.assert(not exists((select 'capacity',id,hold_key from public.capacity_holds union all select 'resource',id,hold_key from public.resource_reservations) except select * from keys_before),'retry retains exact keys');
set local role service_role;
select public.release_hold('a2600000-0000-4000-8000-000000000004');
select public.release_resource_holds('a2600000-0000-4000-8000-000000000004');
select pg_temp.reserve_pair();
reset role;
select pg_temp.assert((select count(*)=2 and bool_and(c.hold_key<>k.hold_key and c.hold_key~'^[0-9a-f]{32}$') from(select 'capacity' kind,id,hold_key from public.capacity_holds union all select 'resource',id,hold_key from public.resource_reservations)c join keys_before k using(kind,id)),'released replacement new random keys same rows');
truncate keys_before;
insert into keys_before select 'capacity',id,hold_key from public.capacity_holds union all select 'resource',id,hold_key from public.resource_reservations;
-- Privileged synthetic expiry only; direct app writes remain denied.
update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second';
update public.resource_reservations set expires_at=clock_timestamp()-interval '1 second';
set local role service_role;
select pg_temp.reserve_pair();
select pg_temp.reject('select lumin.reserve_capacity_nonplanning(null,null,null,null,null,null,null)','42501');
reset role;
select pg_temp.assert((select count(*)=2 and bool_and(c.hold_key<>k.hold_key and c.hold_key~'^[0-9a-f]{32}$') from(select 'capacity' kind,id,hold_key from public.capacity_holds union all select 'resource',id,hold_key from public.resource_reservations)c join keys_before k using(kind,id)),'expired replacement new random keys same rows');
-- Body fidelity includes the 0025 entry guard and all prior capacity semantics.
select pg_temp.assert((select count(*)=2 and bool_and(encode(sha256(convert_to(replace(replace(p.prosrc,'extensions.gen_random_bytes(16)','public.gen_random_bytes(16)'),chr(13)||chr(10),chr(10)),'UTF8')),'hex')=case p.proname when 'reserve_capacity_nonplanning' then 'e4f5a85efe087bd9988bf8f54ff6fb49007f4b026d14bed27d0786183228e232' else 'b4b09f7d27dc9f718606bdc70d37cf3aa3f131b7cc224201bf64c62c96f796f8' end) from pg_proc p where p.pronamespace='lumin'::regnamespace and p.proname in('reserve_capacity_nonplanning','reserve_resource_quantity')),'exact accepted bodies except binding');
select pg_temp.assert((select bool_and(state='draft') from public.bookings),'no confirmation');
select pg_temp.assert((select count(*)=0 from public.payments),'no payment');
rollback;
\echo CRYPTO EXTENSION BINDING TESTS PASS