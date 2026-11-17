\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('41000000-0000-4000-8000-000000000001','draft-list-sql@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('41000000-0000-4000-8000-000000000002','Draft list','draft-list-sql','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','BUSINESS_OWNER');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('41000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000002','Housekeeping','simple','USD',12500,60);
create function pg_temp.list_drafts(a uuid default '41000000-0000-4000-8000-000000000001',t uuid default '41000000-0000-4000-8000-000000000002') returns jsonb language sql as $$select public.owner_paid_simple_drafts(a,t)$$;
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_simple_drafts'::regclass),'RLS still forced');
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
 perform pg_temp.assert(not has_table_privilege(r,'public.paid_simple_drafts','SELECT') and not has_table_privilege(r,'public.paid_simple_drafts','INSERT') and not has_table_privilege(r,'public.paid_simple_drafts','UPDATE') and not has_table_privilege(r,'public.paid_simple_drafts','DELETE'),'no direct draft authority '||r);
 if r<>'service_role' then perform pg_temp.assert(not has_function_privilege(r,'public.owner_paid_simple_drafts(uuid,uuid)','EXECUTE'),'browser read RPC denied');end if;
end loop;end$$;
select pg_temp.assert((select prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid='public.owner_paid_simple_drafts(uuid,uuid)'::regprocedure),'fixed definer search path');
set local role anon;
select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'42501');
reset role;
set local role authenticated;
select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'42501');
reset role;
set local role service_role;
select pg_temp.assert(pg_temp.list_drafts()='{"drafts":[]}'::jsonb,'owner empty list');
select pg_temp.reject($q$select pg_temp.list_drafts('41000000-0000-4000-8000-000000000099')$q$,'42501');
select pg_temp.reject($q$select * from public.paid_simple_drafts$q$,'42501');
reset role;
insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout)
select ('41000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000003',1,'Draft '||n,'#4f46e5','stacked' from generate_series(10,59) n;
select pg_temp.assert(jsonb_array_length(pg_temp.list_drafts()->'drafts')=50,'50 accepted');
select pg_temp.assert(pg_temp.list_drafts()->'drafts'->0->>'flowId'='41000000-0000-4000-8000-000000000010','deterministic UUID order');
insert into public.paid_simple_drafts values('41000000-0000-4000-8000-000000000060','41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000003',1,'Overflow','#4f46e5','stacked');
select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'P0002');
delete from public.paid_simple_drafts where flow_id='41000000-0000-4000-8000-000000000060';
update public.services set base_price=0 where id='41000000-0000-4000-8000-000000000003';select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'0A000');update public.services set base_price=12500 where id='41000000-0000-4000-8000-000000000003';
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='41000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'42501');
update public.tenant_members set role='BUSINESS_OWNER' where tenant_id='41000000-0000-4000-8000-000000000002';update public.tenants set status='inactive' where id='41000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'42501');
update public.tenants set status='active' where id='41000000-0000-4000-8000-000000000002';delete from public.tenant_members where tenant_id='41000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.list_drafts()$q$,'42501');
select pg_temp.assert((select count(*)=50 and min(revision)=1 and max(revision)=1 from public.paid_simple_drafts where tenant_id='41000000-0000-4000-8000-000000000002'),'reads preserve drafts');
select pg_temp.assert((select count(*)=0 from public.flows where tenant_id='41000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.bookings where tenant_id='41000000-0000-4000-8000-000000000002') and (select count(*)=0 from public.payments where tenant_id='41000000-0000-4000-8000-000000000002'),'no publication or financial writes');
rollback;
\echo PASS private draft discovery grants/owner/eligibility/overflow/read-only attacks
