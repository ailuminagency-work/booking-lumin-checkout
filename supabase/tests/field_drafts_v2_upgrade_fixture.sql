-- Synthetic upgrade-only fixture: supervisor runs after 0033, before 0034,
-- in a freshly allocated disposable database. Commit is intentional for backfill.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values('88888888-8888-4888-8888-888888888888','field-upgrade-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Synthetic upgrade','field-upgrade-fixture','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','88888888-8888-4888-8888-888888888888','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('c0000000-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','simple','Upgrade service','USD',0);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','c0000000-0000-4000-8000-000000000001','count','Count','quantity',true,0,1,5,'[]');
set local role service_role;
select public.save_configurable_flow_draft('88888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001',0,'Upgrade parent','{"authoringVersion":2,"config":{"key":"upgrade","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]},"questionOverrides":{}}');
select public.save_text_field_draft('88888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','c0000000-0000-4000-8000-000000000002',0,1,'{"schemaVersion":1,"fields":[{"key":"legacy_note","kind":"text","required":false,"minLength":0,"maxLength":20,"prompt":" Before upgrade "}]}');
select public.save_text_field_draft('88888888-8888-4888-8888-888888888888','cccccccc-cccc-4ccc-8ccc-cccccccccccc','c0000000-0000-4000-8000-000000000002',1,1,'{"schemaVersion":1,"fields":[{"key":"legacy_note","kind":"text","required":false,"minLength":0,"maxLength":20,"prompt":" Before upgrade "}]}');
commit;
