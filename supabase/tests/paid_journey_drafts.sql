\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(q text,code text) returns void language plpgsql as $$begin begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;raise exception 'FAIL accepted %',q;end$$;
insert into auth.users(id,email) values('69000000-0000-4000-8000-000000000001','journey-owner@example.test'),('69000000-0000-4000-8000-000000000099','journey-other@example.test');
select public.create_staging_business('69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000002','Journey','journey-sql','UTC','USD','HOUSEKEEPING','journey_fixture_01');
select public.create_staging_business('69000000-0000-4000-8000-000000000099','69000000-0000-4000-8000-000000000098','Foreign','journey-foreign','UTC','USD','HOUSEKEEPING','journey_fixture_02');
select public.create_staging_business('69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000097','Detailing','journey-detailing','UTC','USD','AUTO_DETAILING','journey_fixture_03');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values
('69000000-0000-4000-8000-000000000003','69000000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60),
('69000000-0000-4000-8000-000000000096','69000000-0000-4000-8000-000000000097','Detailing','simple','USD',12500,60);
create function pg_temp.journey(reordered boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('schemaVersion',1,'stages',jsonb_agg(jsonb_build_object('id',kind,'kind',kind,'label',kind,'enabled',kind<>'options') order by n)) from unnest(case when reordered then array['service','options','information','schedule','review_payment','confirmation'] else array['service','options','schedule','information','review_payment','confirmation'] end) with ordinality s(kind,n)
$$;
create function pg_temp.save(r bigint default 0,j jsonb default pg_temp.journey(),a uuid default '69000000-0000-4000-8000-000000000001',t uuid default '69000000-0000-4000-8000-000000000002',f uuid default '69000000-0000-4000-8000-000000000004',s uuid default '69000000-0000-4000-8000-000000000003',p jsonb default '{"accentColor":"#4f46e5","layout":"stacked"}') returns jsonb language sql as $$
 select public.save_paid_journey_draft(a,t,f,s,r,'Journey',p,j)
$$;
select pg_temp.assert(lumin.paid_journey_valid(pg_temp.journey()) and lumin.paid_journey_valid(pg_temp.journey(true)),'both meaningful orders valid');
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.paid_journey_drafts'::regclass),'RLS enabled and forced');
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
 perform pg_temp.assert(not has_table_privilege(r,'public.paid_journey_drafts','SELECT') and not has_table_privilege(r,'public.paid_journey_drafts','INSERT') and not has_table_privilege(r,'public.paid_journey_drafts','UPDATE') and not has_table_privilege(r,'public.paid_journey_drafts','DELETE'),'no table authority '||r);
 if r<>'service_role' then perform pg_temp.assert(not has_function_privilege(r,'public.save_paid_journey_draft(uuid,uuid,uuid,uuid,bigint,text,jsonb,jsonb)','EXECUTE') and not has_function_privilege(r,'public.get_paid_journey_draft(uuid,uuid,uuid)','EXECUTE'),'no browser RPC '||r);end if;
end loop;end$$;
set local role anon;
select pg_temp.reject($q$select * from public.paid_journey_drafts$q$,'42501');
select pg_temp.reject($q$select pg_temp.save()$q$,'42501');
reset role;
select pg_temp.reject($q$select pg_temp.save(a=>'69000000-0000-4000-8000-000000000099')$q$,'42501');
select pg_temp.reject($q$select pg_temp.save(t=>'69000000-0000-4000-8000-000000000098',a=>'69000000-0000-4000-8000-000000000099')$q$,'42501');
select pg_temp.reject($q$select pg_temp.save(t=>'69000000-0000-4000-8000-000000000097',s=>'69000000-0000-4000-8000-000000000096')$q$,'0A000');
select pg_temp.reject($q$select pg_temp.save(r=>-1)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save(r=>9007199254740991)$q$,'22023');
select pg_temp.reject($q$select pg_temp.save(p=>'{"accentColor":"#4f46e5","layout":"stacked","price":1}')$q$,'22023');
do $$declare bad jsonb;k text;idx integer;begin
 foreach bad in array array['null'::jsonb,'1'::jsonb,'[]'::jsonb,'{}'::jsonb] loop
  perform pg_temp.assert(not lumin.paid_journey_valid(bad),'reject malformed root');
 end loop;
 perform pg_temp.assert(not lumin.paid_journey_valid(jsonb_set(pg_temp.journey(),'{schemaVersion}','2')),'version is exact');
 perform pg_temp.assert(not lumin.paid_journey_valid(jsonb_set(pg_temp.journey(),'{stages,2,kind}','"information"')),'primary kind/id mismatch rejected');
 perform pg_temp.assert(not lumin.paid_journey_valid(jsonb_set(pg_temp.journey(),'{stages}',(pg_temp.journey()->'stages')||(pg_temp.journey()->'stages')||(pg_temp.journey()->'stages'))),'bounded stage count');
 foreach k in array array['price','amount','paymentMode','tenantId','actorId','provider','hold','confirmationAuthority'] loop
  perform pg_temp.assert(not lumin.paid_journey_valid(pg_temp.journey()||jsonb_build_object(k,1)),'reject root authority '||k);
  bad:=jsonb_set(pg_temp.journey(),'{stages,2}',(pg_temp.journey()#>'{stages,2}')||jsonb_build_object(k,1));
  perform pg_temp.assert(not lumin.paid_journey_valid(bad),'reject stage authority '||k);
 end loop;
 foreach idx in array array[0,2,3,4,5] loop
  perform pg_temp.assert(not lumin.paid_journey_valid(jsonb_set(pg_temp.journey(),array['stages',idx::text,'enabled'],'false')),'mandatory cannot disable');
  perform pg_temp.assert(not lumin.paid_journey_valid(jsonb_set(pg_temp.journey(),'{stages}',(pg_temp.journey()->'stages')-idx)),'mandatory cannot omit');
 end loop;
 bad:=jsonb_set(pg_temp.journey(),'{stages,2}',pg_temp.journey()#>'{stages,3}');perform pg_temp.assert(not lumin.paid_journey_valid(bad),'duplicates rejected');
 bad:=jsonb_set(pg_temp.journey(),'{stages,0,label}',to_jsonb(repeat('🧹',41)));perform pg_temp.assert(not lumin.paid_journey_valid(bad),'UTF16 label bound');
 bad:=jsonb_set(pg_temp.journey(),'{stages,0,label}',to_jsonb(' Service 🧹 '::text));perform pg_temp.assert(lumin.paid_journey_valid(bad),'emoji preserved');
 bad:=jsonb_set(pg_temp.journey(),'{stages,0,label}',to_jsonb(chr(10)));perform pg_temp.assert(not lumin.paid_journey_valid(bad),'controls rejected');
 bad:=jsonb_set(pg_temp.journey(),'{stages,0,label}',to_jsonb(U&'\00a0\feff'::text));perform pg_temp.assert(not lumin.paid_journey_valid(bad),'JS whitespace-only label rejected');
 bad:=jsonb_set(pg_temp.journey(),'{stages,2,enabled}','"true"');perform pg_temp.assert(not lumin.paid_journey_valid(bad),'boolean types exact');
 bad:=jsonb_set(pg_temp.journey(),'{stages,0,id}','"__proto__"');perform pg_temp.assert(not lumin.paid_journey_valid(bad),'prototype identifier rejected');
 bad:=jsonb_set(pg_temp.journey(),'{stages}',jsonb_build_array(pg_temp.journey()#>'{stages,0}',pg_temp.journey()#>'{stages,1}',pg_temp.journey()#>'{stages,4}',pg_temp.journey()#>'{stages,3}',pg_temp.journey()#>'{stages,2}',pg_temp.journey()#>'{stages,5}'));perform pg_temp.assert(not lumin.paid_journey_valid(bad),'payment cannot precede schedule');
end$$;
-- PostgreSQL rejects invalid surrogate JSON before it can reach the validator.
select pg_temp.reject($q$select '{"label":"\ud800"}'::jsonb$q$,'22P02');
select pg_temp.reject($q$select '{"label":"\udfff"}'::jsonb$q$,'22P02');
select pg_temp.reject($q$select pg_temp.save(j=>jsonb_set(pg_temp.journey(),'{stages}',(pg_temp.journey()->'stages')||'[{"id":"informational_consent","kind":"informational","label":"Consent","enabled":true}]'))$q$,'22023');
select pg_temp.reject($q$select pg_temp.save(j=>jsonb_set(pg_temp.journey(),'{stages}',jsonb_build_array(pg_temp.journey()#>'{stages,0}',pg_temp.journey()#>'{stages,1}',pg_temp.journey()#>'{stages,2}',pg_temp.journey()#>'{stages,3}','{"id":"informational_consent","kind":"informational","label":"Consent","enabled":true}'::jsonb,pg_temp.journey()#>'{stages,4}',pg_temp.journey()#>'{stages,5}')))$q$,'0A000');
update public.services set tax_rate_bp=100 where id='69000000-0000-4000-8000-000000000003';select pg_temp.reject($q$select pg_temp.save()$q$,'0A000');update public.services set tax_rate_bp=0 where id='69000000-0000-4000-8000-000000000003';
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values('69000000-0000-4000-8000-000000000002','69000000-0000-4000-8000-000000000003','qty','Priced quantity','quantity',100,1,5,'[]');
select pg_temp.reject($q$select pg_temp.save()$q$,'0A000');
delete from public.service_questions where service_id='69000000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.assert(pg_temp.save()->>'revision'='1','first CAS save');
select pg_temp.assert(pg_temp.save(r=>1,j=>pg_temp.journey(true))->>'revision'='2','CAS preserves reordered journey');
select pg_temp.assert(public.get_paid_journey_draft('69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000002','69000000-0000-4000-8000-000000000004')->'journey'=pg_temp.journey(true),'exact loaded saved order');
select pg_temp.reject($q$select pg_temp.save(r=>1)$q$,'40001');
select pg_temp.reject($q$select pg_temp.save()$q$,'23505');
select pg_temp.reject($q$select public.get_paid_journey_draft('69000000-0000-4000-8000-000000000099','69000000-0000-4000-8000-000000000098','69000000-0000-4000-8000-000000000004')$q$,'P0002');
reset role;
update public.tenant_members set role='BUSINESS_STAFF' where tenant_id='69000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.save(r=>2)$q$,'42501');
update public.tenant_members set role='BUSINESS_OWNER' where tenant_id='69000000-0000-4000-8000-000000000002';update public.tenants set status='suspended' where id='69000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.save(r=>2)$q$,'42501');
update public.tenants set status='active' where id='69000000-0000-4000-8000-000000000002';delete from public.tenant_members where tenant_id='69000000-0000-4000-8000-000000000002';select pg_temp.reject($q$select pg_temp.save(r=>2)$q$,'42501');
select pg_temp.assert((select revision=2 and journey=pg_temp.journey(true) from public.paid_journey_drafts where flow_id='69000000-0000-4000-8000-000000000004'),'failed writes retain exact saved state');
select pg_temp.assert(not exists(select 1 from public.bookings where tenant_id='69000000-0000-4000-8000-000000000002') and not exists(select 1 from public.payments where tenant_id='69000000-0000-4000-8000-000000000002') and not exists(select 1 from public.flows where tenant_id='69000000-0000-4000-8000-000000000002'),'no booking/payment/publication writers');
rollback;
\echo PASS journey draft structural/CAS/privilege/tenant/profile/dependency attacks
