-- Synthetic local DB contract/attack suite. All fixture changes rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q; exception when others then if sqlstate=code then return; end if; raise; end; raise exception 'FAIL accepted %',q;end$$;
create temp table flow_results(key text primary key,v jsonb);
grant all on flow_results to service_role;
insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','owner@example.test'),('22222222-2222-4222-8222-222222222222','staff@example.test'),('33333333-3333-4333-8333-333333333333','other@example.test'),('44444444-4444-4444-8444-444444444444','admin@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A','w3-a','UTC','USD'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B','w3-b','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','BUSINESS_OWNER'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','BUSINESS_STAFF'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','BUSINESS_OWNER');
insert into public.platform_admins(user_id) values('44444444-4444-4444-8444-444444444444');
insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','simple','A service','USD',0),('b0000000-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','simple','B service','USD',0);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','count','How many?','quantity',0,1,5,'[]'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','type','Which type?','single_choice',null,null,null,'[{"id":"old","label":"Original","priceDelta":0}]');
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b0000000-0000-4000-8000-000000000001','count','How many?','quantity',0,1,5,'[]'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b0000000-0000-4000-8000-000000000001','type','Which type?','single_choice',null,null,null,'[{"id":"old","label":"Original","priceDelta":0}]');
create function pg_temp.policy(actor uuid default '11111111-1111-4111-8111-111111111111',tenant uuid default 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',service uuid default 'a0000000-0000-4000-8000-000000000001',revision bigint default 0) returns jsonb language sql as $$select public.save_allocation_policy(actor,tenant,service,revision,0,15,120,'none')$$;
create function pg_temp.booking(service text,state text default 'draft',tenant uuid default 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') returns uuid language plpgsql as $$declare id uuid:=gen_random_uuid();begin insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,idempotency_key) values(id,tenant,id::text,state,jsonb_build_object('serviceId',service),'{}','2099-01-01T10:00Z','2099-01-01T11:00Z',id::text);return id;end$$;
set local role service_role;
select pg_temp.reject($q$select pg_temp.policy('22222222-2222-4222-8222-222222222222')$q$,'42501');
select pg_temp.reject($q$select pg_temp.policy('44444444-4444-4444-8444-444444444444')$q$,'42501');
select pg_temp.reject($q$select pg_temp.policy('33333333-3333-4333-8333-333333333333')$q$,'42501');
select pg_temp.reject($q$select pg_temp.policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','b0000000-0000-4000-8000-000000000001')$q$,'P0002');
do $$declare col text;args text[];v text;begin
 foreach col in array array['setup','cleanup','ttl','mode','revision'] loop
  args:=array['0','0','0','30',$m$'none'$m$];
  args[case col when 'revision' then 1 when 'setup' then 2 when 'cleanup' then 3 when 'ttl' then 4 else 5 end]:='null';
  perform pg_temp.reject('select public.save_allocation_policy(''11111111-1111-4111-8111-111111111111'',''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''a0000000-0000-4000-8000-000000000001'','||array_to_string(args,',')||')','22023');
 end loop;
end$$;
select pg_temp.reject($q$select public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001',0,-1,0,30,'none')$q$,'22023');
select pg_temp.reject($q$select public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001',0,0,1441,30,'none')$q$,'22023');
select pg_temp.reject($q$select public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001',0,0,0,29,'none')$q$,'22023');
select pg_temp.reject($q$select public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001',0,0,0,901,'none')$q$,'22023');
select pg_temp.reject($q$select public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001',0,0,0,30,'linked')$q$,'22023');
reset role;
-- Each preexisting consuming state, including alternate UUID syntax, blocks opt-in.
do $$declare st text;booking_key uuid;begin foreach st in array array['pending_payment','confirmed','completed'] loop
 booking_key:=pg_temp.booking('{A0000000-0000-4000-8000-000000000001}',st);
 perform pg_temp.reject('select pg_temp.policy()','40001');delete from public.bookings where bookings.id=booking_key;
end loop;end$$;
insert into flow_results values('booking',to_jsonb(pg_temp.booking('a0000000-0000-4000-8000-000000000001')));
insert into public.capacity_holds(tenant_id,service_id,slot_start,slot_end,booking_id,hold_key,status,expires_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','2099-01-01T10:00Z','2099-01-01T11:00Z',(select (v#>>'{}')::uuid from flow_results where key='booking'),'test','active',clock_timestamp()+interval '5 minutes');
select pg_temp.reject('select pg_temp.policy()','40001');
update public.capacity_holds set status='consumed',expires_at=clock_timestamp()-interval '1 second';select pg_temp.reject('select pg_temp.policy()','40001');
-- A legacy mismatched hold tuple must still block opting in its actual booking.
update public.capacity_holds set tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',service_id='b0000000-0000-4000-8000-000000000001';
select pg_temp.reject('select pg_temp.policy()','40001');
update public.capacity_holds set tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',service_id='a0000000-0000-4000-8000-000000000001',status='released';
set local role service_role;
select pg_temp.assert(pg_temp.policy()->'planningOnly'='true','explicit opt-in');
select pg_temp.reject('select pg_temp.policy()','23505');
select pg_temp.assert(pg_temp.policy(revision=>1)->'revision'='2','CAS revision');
select pg_temp.reject('select pg_temp.policy(revision=>1)','40001');
select pg_temp.reject($q$select public.reserve_capacity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','2099-01-01T10:00Z','2099-01-01T11:00Z',(select (v#>>'{}')::uuid from flow_results where key='booking'),10,interval '5 minutes')$q$,'0A000');
select pg_temp.reject($q$select lumin.reserve_capacity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','2099-01-01T10:00Z','2099-01-01T11:00Z',(select (v#>>'{}')::uuid from flow_results where key='booking'),10,interval '5 minutes')$q$,'0A000');
select pg_temp.reject($q$select public.reserve_capacity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','a0000000-0000-4000-8000-000000000001','2099-01-01T10:00Z','2099-01-01T11:00Z',(select (v#>>'{}')::uuid from flow_results where key='booking'),10,interval '5 minutes')$q$,'0A000');
select pg_temp.reject($q$select public.reserve_capacity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','b0000000-0000-4000-8000-000000000001','2099-01-01T10:00Z','2099-01-01T11:00Z',(select (v#>>'{}')::uuid from flow_results where key='booking'),10,interval '5 minutes')$q$,'0A000');
select pg_temp.reject($q$select lumin.reserve_capacity_nonplanning('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000001','2099-01-01T10:00Z','2099-01-01T11:00Z',(select (v#>>'{}')::uuid from flow_results where key='booking'),10,interval '5 minutes')$q$,'42501');
select pg_temp.reject($q$select pg_temp.booking('{A0000000-0000-4000-8000-000000000001}','confirmed')$q$,'0A000');
select pg_temp.reject($q$update public.bookings set state='pending_payment' where id=(select (v#>>'{}')::uuid from flow_results where key='booking')$q$,'0A000');
select pg_temp.booking('a0000000-0000-4000-8000-000000000001','draft');
select pg_temp.booking('not-a-uuid','draft');
select pg_temp.booking('not-a-uuid','confirmed');
reset role;
-- Moving a consuming booking from another tenant/service into opted identity denies.
insert into flow_results values('foreignbooking',to_jsonb(pg_temp.booking('b0000000-0000-4000-8000-000000000001','confirmed','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')));
select pg_temp.reject($q$update public.bookings set tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',selection='{"serviceId":"{A0000000-0000-4000-8000-000000000001}"}',slot_start='2099-01-02T10:00Z',slot_end='2099-01-02T11:00Z' where id=(select (v#>>'{}')::uuid from flow_results where key='foreignbooking')$q$,'0A000');
select pg_temp.reject('delete from public.allocation_policies','0A000');
select pg_temp.reject($q$update public.allocation_policies set service_id='b0000000-0000-4000-8000-000000000001'$q$,'0A000');
select pg_temp.reject('update public.allocation_policies set ttl_seconds=null','23502');
select pg_temp.reject('update public.allocation_policies set setup_minutes=1441','23514');
-- PG15 reports foreign_key_violation; PG18 reports restrict_violation.
-- Accept only this exact restrictive policy FK, never an unrelated denial.
do $$declare violation_constraint text;begin
 begin
  delete from public.services where id='a0000000-0000-4000-8000-000000000001';
  raise exception 'FAIL service deletion accepted';
 exception when foreign_key_violation or restrict_violation then
  get stacked diagnostics violation_constraint=constraint_name;
  if violation_constraint is distinct from 'allocation_policies_tenant_id_service_id_fkey' then raise;end if;
 end;
 perform pg_temp.assert(exists(select 1 from public.services where id='a0000000-0000-4000-8000-000000000001')
  and exists(select 1 from public.allocation_policies where service_id='a0000000-0000-4000-8000-000000000001'),'restrictive FK retains service and policy');
end$$;
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.allocation_policies'::regclass),'forced RLS');
do $$declare role_name text;verb text;begin foreach role_name in array array['anon','authenticated','service_role'] loop
 foreach verb in array array['SELECT','INSERT','UPDATE','DELETE'] loop perform pg_temp.assert(not has_table_privilege(role_name,'public.allocation_policies',verb),'raw ACL '||role_name||verb);end loop;
 perform pg_temp.assert(not has_function_privilege(role_name,'lumin.reserve_capacity_nonplanning(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)','EXECUTE'),'private bypass '||role_name);
end loop;end$$;
select pg_temp.assert(has_function_privilege('service_role','public.reserve_capacity(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)','EXECUTE'),'public legacy ACL retained');
insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('a0000000-0000-4000-8000-000000000009','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','simple','Linked policy','USD',0);
insert into public.resources(id,tenant_id,name,capacity) values('a0000000-0000-4000-8000-000000000008','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Equipment',3);
insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000009','a0000000-0000-4000-8000-000000000008',2);
set local role service_role;
select pg_temp.reject($q$select public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000009',0,0,0,30,'none')$q$,'22023');
select pg_temp.assert(public.save_allocation_policy('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0000000-0000-4000-8000-000000000009',0,1440,1440,900,'linked')->>'resourceMode'='linked','explicit upper bounds and linked declaration');
reset role;
select pg_temp.assert(not exists(select 1 from pg_attrdef where adrelid='public.allocation_policies'::regclass),'no silent column defaults');
update public.tenants set status='suspended' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';select pg_temp.reject('select pg_temp.policy(revision=>2)','42501');
rollback;
\echo PLANNING POLICY SQL TESTS PASS
