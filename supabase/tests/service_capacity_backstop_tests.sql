-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against
-- hosted/parent/live databases. Every fixture row rolls back.
--
-- R1b proof for migration 0095: a scheduled service cannot be confirmed by a
-- privileged direct INSERT/UPDATE without a matching consumed capacity hold;
-- the legitimate reserve -> consume -> confirm path still succeeds; rental and
-- unscheduled simple services retain their separate authorities.

\set ON_ERROR_STOP on
begin;

create function pg_temp.assert(ok boolean, label text) returns void
  language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

create function pg_temp.reject(q text, code text, label text) returns void
  language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate = code then raise notice 'PASS: %', label; return; end if;
    raise exception 'FAIL: % — wrong error % (expected %)', label, sqlstate, code;
  end;
  raise exception 'FAIL: % — statement was accepted (expected % rejection)', label, code;
end $$;

insert into public.tenants (id, name, slug, timezone, currency, status)
values ('c2000000-0000-4000-8000-000000000001', 'Capacity backstop',
        'service-capacity-backstop', 'UTC', 'USD', 'active');

insert into public.services (id, tenant_id, archetype, name, currency, base_price, duration_minutes)
values
  ('c2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001',
   'simple', 'Scheduled service', 'USD', 1000, 60),
  ('c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001',
   'simple', 'Unscheduled service', 'USD', 1000, 60),
  ('c2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000001',
   'rental', 'Rental service', 'USD', 1000, 60,
   '{"periodMinutes":60,"pricePerPeriod":1000,"minPeriods":1,"maxPeriods":2,"depositAmount":0}');

insert into public.availability_rules
  (tenant_id, service_id, weekday, start_minute, end_minute, capacity)
values
  ('c2000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000002', 1, 0, 1440, 1);

insert into public.resources (id, tenant_id, name, kind, capacity, active)
values ('c2000000-0000-4000-8000-000000000006',
        'c2000000-0000-4000-8000-000000000001', 'Rental vehicle', 'vehicle', 1, true);
insert into public.service_resources (tenant_id, service_id, resource_id, quantity_required)
values ('c2000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000004',
        'c2000000-0000-4000-8000-000000000006', 1);

insert into public.customers (id, tenant_id, name, email)
values ('c2000000-0000-4000-8000-000000000005',
        'c2000000-0000-4000-8000-000000000001', 'Capacity customer',
        'capacity-backstop@example.test');

-- Direct INSERT is the privileged caller-independent attack. A row cannot
-- have a hold yet because capacity_holds.booking_id references bookings.
select pg_temp.reject($q$
  insert into public.bookings
    (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
     customer_id, idempotency_key)
  values
    ('c2000000-0000-4000-8000-000000000010',
     'c2000000-0000-4000-8000-000000000001', 'LMN-CB001', 'confirmed',
     '{"serviceId":"c2000000-0000-4000-8000-000000000002"}',
     '{"total":{"amount":1000,"currency":"USD"}}',
     '2041-01-01T10:00Z', '2041-01-01T11:00Z',
     'c2000000-0000-4000-8000-000000000005', 'capacity-backstop-insert-0001')
$q$, '40001', 'direct confirmed INSERT for scheduled service requires a hold');

-- A direct state transition is blocked independently of the INSERT path.
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
   customer_id, idempotency_key)
values
  ('c2000000-0000-4000-8000-000000000011',
   'c2000000-0000-4000-8000-000000000001', 'LMN-CB002', 'draft',
   '{"serviceId":"c2000000-0000-4000-8000-000000000002"}', '{}',
   '2041-01-01T12:00Z', '2041-01-01T13:00Z',
   'c2000000-0000-4000-8000-000000000005', 'capacity-backstop-update-0001');
update public.bookings
   set state = 'pending_payment'
 where id = 'c2000000-0000-4000-8000-000000000011';
select pg_temp.reject($q$
  update public.bookings set state = 'confirmed'
   where id = 'c2000000-0000-4000-8000-000000000011'
$q$, '40001', 'direct transition to confirmed without a hold is rejected');
select pg_temp.assert(
  (select state = 'pending_payment' from public.bookings
    where id = 'c2000000-0000-4000-8000-000000000011'),
  'rejected confirmation leaves the booking pending');

-- Legitimate service-role path: reserve creates the hold, consume makes the
-- authority durable, and only then may the booking enter confirmed.
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
   customer_id, idempotency_key)
values
  ('c2000000-0000-4000-8000-000000000012',
   'c2000000-0000-4000-8000-000000000001', 'LMN-CB003', 'draft',
   '{"serviceId":"c2000000-0000-4000-8000-000000000002"}',
   '{"total":{"amount":1000,"currency":"USD"}}',
   '2041-01-01T14:00Z', '2041-01-01T15:00Z',
   'c2000000-0000-4000-8000-000000000005', 'capacity-backstop-legit-0001');

select pg_temp.assert(
  (select result = 'GRANTED' from lumin.reserve_capacity(
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000002',
    '2041-01-01T14:00Z', '2041-01-01T15:00Z',
    'c2000000-0000-4000-8000-000000000012', 1, interval '15 minutes')),
  'reserve_capacity grants the legitimate scheduled hold');
select pg_temp.assert(
  lumin.consume_hold('c2000000-0000-4000-8000-000000000012'),
  'consume_hold marks the legitimate hold consumed');
update public.bookings set state = 'pending_payment'
 where id = 'c2000000-0000-4000-8000-000000000012';
update public.bookings set state = 'confirmed'
 where id = 'c2000000-0000-4000-8000-000000000012';
select pg_temp.assert(
  (select state = 'confirmed' from public.bookings
    where id = 'c2000000-0000-4000-8000-000000000012')
  and (select status = 'consumed' from public.capacity_holds
        where booking_id = 'c2000000-0000-4000-8000-000000000012'),
  'matching consumed hold permits the legitimate confirmation');
select pg_temp.reject($q$
  update public.bookings
     set selection = '{"serviceId":"c2000000-0000-4000-8000-000000000003"}'
   where id = 'c2000000-0000-4000-8000-000000000012'
$q$, '40001', 'same-state simple service mutation is rejected');
select pg_temp.reject($q$
  update public.bookings
     set slot_start = '2041-01-01T15:00Z'
   where id = 'c2000000-0000-4000-8000-000000000012'
$q$, '40001', 'same-state simple slot mutation is rejected');

-- A rental direct write without its resource authority is rejected too.
select pg_temp.reject($q$
  insert into public.bookings
    (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
     customer_id, idempotency_key)
  values
    ('c2000000-0000-4000-8000-000000000013',
     'c2000000-0000-4000-8000-000000000001', 'LMN-CB004', 'confirmed',
     '{"serviceId":"c2000000-0000-4000-8000-000000000004"}',
     '{"total":{"amount":1000,"currency":"USD"}}',
     '2041-01-01T16:00Z', '2041-01-01T17:00Z',
     'c2000000-0000-4000-8000-000000000005', 'capacity-backstop-rental-0001')
$q$, '40001', 'rental direct confirmation requires consumed resource reservations');

-- Rental services retain the resource-reservation authority from 0033.
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
   customer_id, idempotency_key)
values
  ('c2000000-0000-4000-8000-000000000015',
   'c2000000-0000-4000-8000-000000000001', 'LMN-CB004', 'draft',
   '{"serviceId":"c2000000-0000-4000-8000-000000000004"}',
   '{"total":{"amount":1000,"currency":"USD"}}',
   '2041-01-01T16:00Z', '2041-01-01T17:00Z',
   'c2000000-0000-4000-8000-000000000005', 'capacity-backstop-rental-0002');
select pg_temp.assert(
  (select result = 'GRANTED' from lumin.reserve_resource(
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000006',
    '2041-01-01T16:00Z', '2041-01-01T17:00Z',
    'c2000000-0000-4000-8000-000000000015', interval '15 minutes')),
  'reserve_resource grants the legitimate rental hold');
select pg_temp.assert(
  lumin.consume_resource_holds('c2000000-0000-4000-8000-000000000015') = 1,
  'consume_resource_holds consumes the legitimate rental hold');
update public.bookings set state = 'pending_payment'
 where id = 'c2000000-0000-4000-8000-000000000015';
update public.bookings set state = 'confirmed'
 where id = 'c2000000-0000-4000-8000-000000000015';
select pg_temp.assert(
  (select state = 'confirmed' from public.bookings
    where id = 'c2000000-0000-4000-8000-000000000015')
  and (select status = 'consumed' from public.resource_reservations
        where booking_id = 'c2000000-0000-4000-8000-000000000015'),
  'matching consumed resource reservation permits the legitimate rental confirmation');
update public.resources set active = false
 where id = 'c2000000-0000-4000-8000-000000000006';
select pg_temp.reject($q$
  update public.bookings set notes = 'resource was invalidated'
   where id = 'c2000000-0000-4000-8000-000000000015'
$q$, '40001', 'same-state rental update rejects invalidated resource');

-- Unscheduled simple services retain compatibility with non-scheduling
-- bookkeeping fixtures; they have no capacity schedule to enforce here.
insert into public.bookings
  (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end,
   customer_id, idempotency_key)
values
  ('c2000000-0000-4000-8000-000000000014',
   'c2000000-0000-4000-8000-000000000001', 'LMN-CB005', 'confirmed',
   '{"serviceId":"c2000000-0000-4000-8000-000000000003"}',
   '{"total":{"amount":1000,"currency":"USD"}}',
   '2041-01-01T18:00Z', '2041-01-01T19:00Z',
   'c2000000-0000-4000-8000-000000000005', 'capacity-backstop-unscheduled-0001');
select pg_temp.assert(
  (select state = 'confirmed' from public.bookings
    where id = 'c2000000-0000-4000-8000-000000000014'),
  'unscheduled simple service remains compatible');

rollback;

\echo 'ALL SERVICE CAPACITY BACKSTOP TESTS PASSED'

