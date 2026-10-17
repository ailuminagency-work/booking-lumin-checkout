\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('39000000-0000-4000-8000-000000000001','draft-sql-owner@example.test'),('39000000-0000-4000-8000-000000000099','draft-sql-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('39000000-0000-4000-8000-000000000002','Draft SQL','paid-draft-sql','UTC','USD'),('39000000-0000-4000-8000-000000000098','Foreign','paid-draft-foreign','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('39000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000001','BUSINESS_OWNER'),('39000000-0000-4000-8000-000000000098','39000000-0000-4000-8000-000000000099','BUSINESS_OWNER');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('39000000-0000-4000-8000-000000000003','39000000-0000-4000-8000-000000000002','Housekeeping','simple','USD',12500,60);
create function pg_temp.save_draft(a uuid default '39000000-0000-4000-8000-000000000001',t uuid default '39000000-0000-4000-8000-000000000002',r bigint default 0,c text default '#4f46e5',l text default 'stacked') returns jsonb language sql as $$select public.save_paid_simple_draft(a,t,'39000000-0000-4000-8000-000000000004','39000000-0000-4000-8000-000000000003',r,'Draft',c,l)$$;
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_simple_drafts'::regclass),'private table forces RLS');
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
 perform pg_temp.assert(not has_table_privilege(r,'public.paid_simple_drafts','SELECT') and not has_table_privilege(r,'public.paid_simple_drafts','INSERT') and not has_table_privilege(r,'public.paid_simple_drafts','UPDATE') and not has_table_privilege(r,'public.paid_simple_drafts','DELETE'),'no direct draft table authority: '||r);
 if r<>'service_role' then perform pg_temp.assert(not has_function_privilege(r,'public.save_paid_simple_draft(uuid,uuid,uuid,uuid,bigint,text,text,text)','EXECUTE') and not has_function_privilege(r,'public.get_paid_simple_draft(uuid,uuid,uuid)','EXECUTE'),'no browser draft RPC authority: '||r);end if;
end loop;end$$;
set local role anon;
select pg_temp.reject($q$select * from public.paid_simple_drafts$q$,'42501');
select pg_temp.reject($q$select pg_temp.save_draft()$q$,'42501');
reset role;
select pg_temp.reject($q$select pg_temp.save_draft('39000000-0000-4000-8000-000000000099')$q$,'42501');
select pg_temp.reject($q$select pg_temp.save_draft('39000000-0000-4000-8000-000000000099','39000000-0000-4000-8000-000000000098')$q$,'42501');
select pg_temp.reject($q$select pg_temp.save_draft(r=>-1)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_draft(r=>9007199254740991)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_draft(c=>'#ffffff')$q$,'22023');
select pg_temp.reject($q$select pg_temp.save_draft(l=>'grid')$q$,'22023');
update public.services set base_price=0 where id='39000000-0000-4000-8000-000000000003';select pg_temp.reject($q$select pg_temp.save_draft()$q$,'0A000');update public.services set base_price=12500 where id='39000000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.assert(pg_temp.save_draft()=jsonb_build_object('flowId','39000000-0000-4000-8000-000000000004','revision',1),'owner creates first revision');
select pg_temp.assert((public.get_paid_simple_draft('39000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000004')->'presentation')='{"accentColor":"#4f46e5","layout":"stacked"}'::jsonb,'reads exact presentation');
select pg_temp.assert(pg_temp.save_draft(r=>1,c=>'#0e7490',l=>'compact')->>'revision'='2','owner updates next revision');
select pg_temp.reject($q$select pg_temp.save_draft(r=>1)$q$,'40001');select pg_temp.reject($q$select pg_temp.save_draft()$q$,'23505');
reset role;
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='39000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.save_draft(r=>2)$q$,'42501');
update public.tenant_members set role='BUSINESS_OWNER' where tenant_id='39000000-0000-4000-8000-000000000002';update public.tenants set status='suspended' where id='39000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.save_draft(r=>2)$q$,'42501');
update public.tenants set status='active' where id='39000000-0000-4000-8000-000000000002';delete from public.tenant_members where tenant_id='39000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.save_draft(r=>2)$q$,'42501');
select pg_temp.assert((select revision=2 and accent_color='#0e7490' and layout='compact' from public.paid_simple_drafts where flow_id='39000000-0000-4000-8000-000000000004'),'failed updates preserve saved draft');
select pg_temp.assert((select count(*)=0 from public.flows where tenant_id='39000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.flow_versions where tenant_id='39000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.flow_installations where tenant_id='39000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.bookings where tenant_id='39000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.payments where tenant_id='39000000-0000-4000-8000-000000000002'),'draft only creates no publication/customer/financial state');
rollback;
\echo PASS owner paid-simple draft permission/tenant/presentation/revision/eligibility attacks
