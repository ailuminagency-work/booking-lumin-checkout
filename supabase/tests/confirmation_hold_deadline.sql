-- Disposable fixtures only. Every synthetic row and trigger rolls back.
\set ON_ERROR_STOP on
begin;
do $$begin if current_user<>'postgres' or not((host(inet_server_addr())='127.0.0.1' and inet_server_port()=59069 and current_database() ~ '^lumin_confirmation_deadline_local_[a-z0-9_]+$') or (inet_server_port()=5432 and current_database()='lumin_confirmation_deadline_ci' and (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16'))) then raise exception 'DISPOSABLE_CONFIRMATION_TARGET_REQUIRED';end if;end$$;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'FAIL accepted forbidden operation: %',statement;
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('87000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values(pg_temp.id(1),'outbox-owner@example.test'),(pg_temp.id(2),'outbox-admin@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(3),'Confirmation outbox','confirmation-deadline-test','UTC','USD'),
 (pg_temp.id(4),'Foreign tenant','confirmation-deadline-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER');
insert into public.platform_admins(user_id) values(pg_temp.id(2));
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,rental) values
 (pg_temp.id(5),pg_temp.id(3),'Simple','simple','USD',100,60,null),
 (pg_temp.id(6),pg_temp.id(3),'Rental','rental','USD',0,60,'{"periodMinutes":60,"pricePerPeriod":100,"minPeriods":1,"maxPeriods":8,"depositAmount":50}');
insert into public.resources(id,tenant_id,name,kind,capacity,active) values(pg_temp.id(7),pg_temp.id(3),'Rental vehicle','vehicle',1,true);
insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values(pg_temp.id(3),pg_temp.id(6),pg_temp.id(7),1);
create function pg_temp.seed(n integer,is_rental boolean,with_payment boolean default true) returns void language plpgsql as $$
declare slot timestamptz:='2035-01-01T10:00Z'::timestamptz+make_interval(days=>n);
begin
 insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end)
 values(pg_temp.id(n),pg_temp.id(3),pg_temp.id(n)::text,pg_temp.id(n)::text,
  case when is_rental then jsonb_build_object('serviceId',pg_temp.id(6),'itemQuantities','{}'::jsonb,'addonIds','[]'::jsonb,'answers','{}'::jsonb,'rentalPeriods',3)
   else jsonb_build_object('serviceId',pg_temp.id(5)) end,
  case when is_rental then '{"total":{"amount":300,"currency":"USD"},"deposit":{"amount":50,"currency":"USD"}}'::jsonb
   else '{"total":{"amount":100,"currency":"USD"}}'::jsonb end,
  slot,slot+make_interval(hours=>case when is_rental then 3 else 1 end));
 if with_payment then
  insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
  values(pg_temp.id(n+100),pg_temp.id(3),pg_temp.id(n),'staging_mock',pg_temp.id(n+100)::text,'succeeded',case when is_rental then 350 else 100 end,'USD');
 end if;
 if is_rental then
  insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity)
  values(pg_temp.id(3),pg_temp.id(7),pg_temp.id(n),slot,slot+interval '3 hours',pg_temp.id(n)::text,'held',clock_timestamp()+interval '5 minutes',1);
 else
  insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
  values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(n),slot,slot+interval '1 hour',pg_temp.id(n)::text,'active',clock_timestamp()+interval '5 minutes');
 end if;
end$$;
create temp table expectation(repaired boolean);
insert into expectation values(true);
create temp table delay_control(booking_id uuid,phase text);
create function pg_temp.whole_rows() returns jsonb language sql as $$
 select jsonb_build_object(
 'bookings',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.bookings t),
 'payments',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.payments t),
 'holds',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.capacity_holds t),
 'resources',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.resource_reservations t),
 'history',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.booking_state_history t),
 'outbox',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.durable_outbox t))
$$;
create function pg_temp.delay_confirmation() returns trigger language plpgsql as $$
declare controlled delay_control;bid uuid;begin
 bid:=(to_jsonb(new)->>(case when TG_TABLE_NAME='bookings' then 'id' else 'booking_id' end))::uuid;
 select * into controlled from delay_control where booking_id=bid;
 if not found then return new;end if;
 if (TG_TABLE_NAME='bookings' and to_jsonb(new)->>'state'='confirmed' and ((controlled.phase='state_before' and TG_WHEN='BEFORE') or (controlled.phase='state_after' and TG_WHEN='AFTER') or (controlled.phase='state_extend' and TG_WHEN='BEFORE'))) or (TG_TABLE_NAME='durable_outbox' and to_jsonb(new)->>'event_type'='booking.confirmed' and ((controlled.phase='outbox_before' and TG_WHEN='BEFORE') or (controlled.phase='outbox_after' and TG_WHEN='AFTER'))) then
  if controlled.phase='state_extend' then
   update public.capacity_holds set expires_at=clock_timestamp()+interval '5 minutes' where booking_id=bid;
   update public.resource_reservations set expires_at=clock_timestamp()+interval '5 minutes' where booking_id=bid;
  end if;
  perform pg_sleep(1.2);
 end if;return new;
end$$;
create trigger deadline_state_before before update of state on public.bookings for each row execute function pg_temp.delay_confirmation();
create trigger deadline_state_after after update of state on public.bookings for each row execute function pg_temp.delay_confirmation();
create trigger deadline_outbox_before before insert on public.durable_outbox for each row execute function pg_temp.delay_confirmation();
create trigger deadline_outbox_after after insert on public.durable_outbox for each row execute function pg_temp.delay_confirmation();
create function pg_temp.attack(n integer,rental boolean,phase text) returns void language plpgsql as $$
declare before_rows jsonb;failed boolean:=false;expect_repaired boolean;begin
 perform pg_temp.seed(n,rental,false);
 insert into delay_control values(pg_temp.id(n),phase);
 update public.capacity_holds set expires_at=clock_timestamp()+interval '0.8 seconds' where booking_id=pg_temp.id(n);
 update public.resource_reservations set expires_at=clock_timestamp()+interval '0.8 seconds' where booking_id=pg_temp.id(n);
 before_rows:=pg_temp.whole_rows();
 begin
  insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values(pg_temp.id(n+100),pg_temp.id(3),pg_temp.id(n),'staging_mock',pg_temp.id(n+100)::text,'succeeded',case when rental then 350 else 100 end,'USD');
  perform public.confirm_succeeded_payment(pg_temp.id(n+100));
 exception when sqlstate '40001' then failed:=true;
 end;
 select repaired into expect_repaired from expectation;
 if expect_repaired then
  perform pg_temp.assert(failed,'expiry rejected: '||phase||' rental='||rental);
  perform pg_temp.assert(pg_temp.whole_rows()=before_rows,'complete row rollback: '||phase||' rental='||rental);
 else
  perform pg_temp.assert(not failed,'baseline gap reproduced: '||phase||' rental='||rental);
  perform pg_temp.assert((select state='confirmed' from public.bookings where id=pg_temp.id(n)),'baseline expired confirmation exists');
 end if;
 delete from delay_control where booking_id=pg_temp.id(n);
end$$;
select pg_temp.attack(10,false,'state_before'),pg_temp.attack(11,true,'state_before');
select pg_temp.attack(12,false,'state_after'),pg_temp.attack(13,true,'state_after');
select pg_temp.attack(14,false,'outbox_before'),pg_temp.attack(15,true,'outbox_before');
select pg_temp.attack(16,false,'outbox_after'),pg_temp.attack(17,true,'outbox_after');
select pg_temp.attack(18,false,'state_extend'),pg_temp.attack(19,true,'state_extend');
drop trigger deadline_state_before on public.bookings;
drop trigger deadline_state_after on public.bookings;
drop trigger deadline_outbox_before on public.durable_outbox;
drop trigger deadline_outbox_after on public.durable_outbox;
select pg_temp.seed(20,false),pg_temp.seed(21,true);
set local role service_role;
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(120))->>'replayed'='false','normal simple confirmation');
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(121))->>'replayed'='false','normal rental confirmation');
reset role;
update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=pg_temp.id(20);
update public.resource_reservations set expires_at=clock_timestamp()-interval '1 second' where booking_id=pg_temp.id(21);
create temp table before_replay as select pg_temp.whole_rows() value;
set local role service_role;
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(120))->>'replayed'='true','expired consumed simple replay');
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(121))->>'replayed'='true','expired consumed rental replay');
reset role;
select pg_temp.assert((select value from before_replay)=pg_temp.whole_rows(),'replay changes no complete rows');
set local role anon;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(120))','42501');
reset role;
set local role authenticated;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(120))','42501');
reset role;
select pg_temp.assert(p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=pg_catalog'],'security definer search path preserved') from pg_proc p where p.oid='public.confirm_succeeded_payment(uuid)'::regprocedure;
select pg_temp.assert(not has_function_privilege('anon','public.confirm_succeeded_payment(uuid)','execute') and not has_function_privilege('authenticated','public.confirm_succeeded_payment(uuid)','execute') and has_function_privilege('service_role','public.confirm_succeeded_payment(uuid)','execute'),'execute grants preserved');
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'outbox forced RLS preserved') from pg_class where oid='public.durable_outbox'::regclass;
rollback;
\echo 'confirmation deadline attacks and whole-row rollback PASS (fixtures rolled back)'
