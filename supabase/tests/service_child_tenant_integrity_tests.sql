-- Run after 0001..0032 in a disposable database. Fixtures roll back.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111132','child-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency,status) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa32','Child A','child-integrity-a','UTC','USD','active'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','Child B','child-integrity-b','UTC','USD','active');
insert into public.tenant_members(tenant_id,user_id,role) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','11111111-1111-1111-1111-111111111132','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency,active) values
 ('a0000000-0000-0000-0000-000000000032','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa32','simple','A','USD',true),
 ('b0000000-0000-0000-0000-000000000032','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','simple','B','USD',true),
 ('b0000000-0000-0000-0000-000000000033','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','simple','B draft','USD',false);

create function pg_temp.expect_fk(statement text) returns void language plpgsql as $fn$
begin
  begin
    execute statement;
  exception when foreign_key_violation then
    return;
  end;
  raise exception 'FAIL: cross-tenant service child accepted: %', statement;
end;
$fn$;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111132","role":"authenticated"}',true);
set local role authenticated;

-- Positive controls: a member can create ordinary children of its own service.
insert into public.service_items(tenant_id,service_id,item_key,name,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','b0000000-0000-0000-0000-000000000032','own-item','Own item',100);
insert into public.service_addons(tenant_id,service_id,addon_key,name,price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','b0000000-0000-0000-0000-000000000032','own-addon','Own addon',100);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','b0000000-0000-0000-0000-000000000032','own-question','Own question','quantity',100);

-- The same member must receive an FK failure, not a generic permission error,
-- when it uses its own tenant_id with another tenant's known service UUID.
select pg_temp.expect_fk($q$insert into public.service_items(tenant_id,service_id,item_key,name,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','a0000000-0000-0000-0000-000000000032','cross-item','Cross item',100)$q$);
select pg_temp.expect_fk($q$insert into public.service_addons(tenant_id,service_id,addon_key,name,price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','a0000000-0000-0000-0000-000000000032','cross-addon','Cross addon',100)$q$);
select pg_temp.expect_fk($q$insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','a0000000-0000-0000-0000-000000000032','cross-question','Cross question','quantity',100)$q$);
select pg_temp.expect_fk($q$update public.service_items set service_id='a0000000-0000-0000-0000-000000000032' where item_key='own-item'$q$);
select pg_temp.expect_fk($q$update public.service_addons set service_id='a0000000-0000-0000-0000-000000000032' where addon_key='own-addon'$q$);
select pg_temp.expect_fk($q$update public.service_questions set service_id='a0000000-0000-0000-0000-000000000032' where question_key='own-question'$q$);

-- An inactive draft and its children remain absent from the anon catalog.
insert into public.service_items(tenant_id,service_id,item_key,name,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','b0000000-0000-0000-0000-000000000033','draft-item','Draft item',100);
insert into public.service_addons(tenant_id,service_id,addon_key,name,price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','b0000000-0000-0000-0000-000000000033','draft-addon','Draft addon',100);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','b0000000-0000-0000-0000-000000000033','draft-question','Draft question','quantity',100);
reset role;

-- Trusted writers bypass RLS but must still obey storage integrity.
set local role service_role;
select pg_temp.expect_fk($q$insert into public.service_items(tenant_id,service_id,item_key,name,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','a0000000-0000-0000-0000-000000000032','server-cross-item','Cross item',100)$q$);
select pg_temp.expect_fk($q$insert into public.service_addons(tenant_id,service_id,addon_key,name,price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','a0000000-0000-0000-0000-000000000032','server-cross-addon','Cross addon',100)$q$);
select pg_temp.expect_fk($q$insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price) values
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32','a0000000-0000-0000-0000-000000000032','server-cross-question','Cross question','quantity',100)$q$);
select pg_temp.expect_fk($q$update public.service_items set service_id='a0000000-0000-0000-0000-000000000032' where item_key='own-item'$q$);
select pg_temp.expect_fk($q$update public.service_addons set service_id='a0000000-0000-0000-0000-000000000032' where addon_key='own-addon'$q$);
select pg_temp.expect_fk($q$update public.service_questions set service_id='a0000000-0000-0000-0000-000000000032' where question_key='own-question'$q$);
-- A service cannot move to another tenant while linked child rows exist.
select pg_temp.expect_fk($q$update public.services set tenant_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa32'
 where id='b0000000-0000-0000-0000-000000000032'$q$);
reset role;

set local role anon;
do $test$
begin
  if exists(select 1 from public.services where id='b0000000-0000-0000-0000-000000000033')
    or exists(select 1 from public.service_items where item_key='draft-item')
    or exists(select 1 from public.service_addons where addon_key='draft-addon')
    or exists(select 1 from public.service_questions where question_key='draft-question') then
    raise exception 'FAIL: inactive draft leaked to anon catalog';
  end if;
end;
$test$;
reset role;

-- Parent deletion still cascades through all three child collections.
delete from public.services where id='b0000000-0000-0000-0000-000000000032';
do $test$
begin
  if exists(select 1 from public.service_items where item_key='own-item')
    or exists(select 1 from public.service_addons where addon_key='own-addon')
    or exists(select 1 from public.service_questions where question_key='own-question') then
    raise exception 'FAIL: service-child cascade';
  end if;
end;
$test$;

rollback;
\echo ALL SERVICE CHILD TENANT INTEGRITY TESTS PASSED
