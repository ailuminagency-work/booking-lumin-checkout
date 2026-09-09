-- Disposable synthetic fixtures; no live data. All changes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted forbidden operation';end$$;
insert into public.tenants(id,name,slug,timezone,currency) values
 ('a2000000-0000-4000-8000-000000000001','A','quantity-a','UTC','USD'),('b2000000-0000-4000-8000-000000000001','B','quantity-fixture-b','UTC','USD');
insert into public.resources(id,tenant_id,name,capacity) values
 ('a2000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','Pooled equipment',3),
 ('b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','Foreign',3);
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key)
 select ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a2000000-0000-4000-8000-000000000001','QUANTITY-'||n,'2035-01-01T10:00Z','2035-01-01T11:00Z','quantity-fixture-'||n from generate_series(10,14) n;
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values
 ('b2000000-0000-4000-8000-000000000010','b2000000-0000-4000-8000-000000000001','FOREIGN-Q','2035-01-01T10:00Z','2035-01-01T11:00Z','quantity-fixture-b');
-- Test wrappers remain invoker functions so grants are exercised as the caller.
create function pg_temp.reserve(n integer,units integer default null) returns text language plpgsql as $$declare r text;begin
 if units is null then select result into r from public.reserve_resource('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z',('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,interval '15 minutes');
 else select result into r from lumin.reserve_resource_quantity('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z',('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,interval '15 minutes',units);end if;return r;end$$;
set local role anon;
select pg_temp.reject('select pg_temp.reserve(10,2)','42501');
reset role;
set local role authenticated;
select pg_temp.reject('select pg_temp.reserve(10,2)','42501');
select pg_temp.reject('select * from public.resource_reservations','42501');
reset role;
set local role service_role;
select pg_temp.assert(pg_temp.reserve(10)='GRANTED','legacy one unit');
select pg_temp.assert(pg_temp.reserve(11,2)='GRANTED','new two units sees old one');
select pg_temp.assert((select sum(quantity)=3 from public.resource_reservations),'three persisted units');
select pg_temp.assert(pg_temp.reserve(12)='NO_CAPACITY','legacy sees quantity two');
select pg_temp.assert(pg_temp.reserve(11,2)='GRANTED','same tuple retry');
select pg_temp.reject('select pg_temp.reserve(11)','40001');
select pg_temp.reject('select pg_temp.reserve(11,3)','40001');
select pg_temp.reject($q$select * from lumin.reserve_resource_quantity('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','2035-01-01T10:30Z','2035-01-01T11:30Z','a2000000-0000-4000-8000-000000000011',interval '15 minutes',2)$q$,'40001');
select pg_temp.reject('select pg_temp.reserve(12,0)','22023');
select pg_temp.reject('select pg_temp.reserve(12,-1)','22023');
select pg_temp.assert(pg_temp.reserve(12,2147483647)='NO_CAPACITY','overflow safe sum');
select pg_temp.reject($q$select * from lumin.reserve_resource_quantity('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z','b2000000-0000-4000-8000-000000000010',interval '15 minutes',1)$q$,'23503');
select pg_temp.assert((select result='NO_CAPACITY' from lumin.reserve_resource_quantity('a2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','2035-01-01T10:00Z','2035-01-01T11:00Z','a2000000-0000-4000-8000-000000000012',interval '15 minutes',1)),'foreign resource');
update public.resource_reservations set status='released' where booking_id='a2000000-0000-4000-8000-000000000010';
update public.resource_reservations set status='consumed' where booking_id='a2000000-0000-4000-8000-000000000011';
select pg_temp.assert(pg_temp.reserve(12,2)='NO_CAPACITY','consumed quantity counted');
select pg_temp.assert(pg_temp.reserve(12)='GRANTED','remaining one unit');
-- Adjacent interval does not overlap consumed capacity.
select pg_temp.assert((select result='GRANTED' from lumin.reserve_resource_quantity('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','2035-01-01T11:00Z','2035-01-01T12:00Z','a2000000-0000-4000-8000-000000000013',interval '15 minutes',3)),'half-open adjacency');
update public.resource_reservations set status='held',expires_at=clock_timestamp()-interval '1 second' where booking_id='a2000000-0000-4000-8000-000000000011';
select pg_temp.assert(pg_temp.reserve(11)='GRANTED','expired quantity row reused by old caller');
select pg_temp.assert((select quantity=1 from public.resource_reservations where booking_id='a2000000-0000-4000-8000-000000000011'),'old caller resets reused quantity');
select pg_temp.assert((select bool_and(state='draft') from public.bookings),'no confirmation');
select pg_temp.assert((select count(*)=0 from public.payments),'no payment');
reset role;
rollback;
\echo 'RESOURCE QUANTITY TESTS PASS'
