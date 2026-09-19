-- Synthetic upgrade-only fixture: supervisor runs after 0034, before 0035,
-- in a freshly allocated disposable database. Commit is intentional to prove preservation.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values('99999999-9999-4999-8999-999999999999','field-v3-upgrade-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Synthetic upgrade','field-v3-upgrade-fixture','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','99999999-9999-4999-8999-999999999999','BUSINESS_OWNER');
insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('d0000000-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddddd','simple','Upgrade service','USD',0);
insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000001','count','Count','quantity',true,0,1,5,'[]');
set local role service_role;
select public.save_configurable_flow_draft('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001',0,'Upgrade parent','{"authoringVersion":2,"config":{"key":"upgrade","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]},"questionOverrides":{}}');
select public.save_text_field_draft('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000002',0,1,'{"schemaVersion":1,"fields":[{"key":"legacy_note","kind":"text","required":false,"minLength":0,"maxLength":20,"prompt":" Before upgrade "}]}');
select public.save_text_field_draft('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000002',1,1,'{"schemaVersion":1,"fields":[{"key":"legacy_note","kind":"text","required":false,"minLength":0,"maxLength":20,"prompt":" Before upgrade "}]}');
select public.save_configurable_flow_draft('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001',0,'Upgrade parent','{"authoringVersion":2,"config":{"key":"upgrade","steps":[{"key":"count","questionKey":"count","kind":"question","required":true}]},"questionOverrides":{}}');
select public.save_field_draft_v2('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','d0000000-0000-4000-8000-000000000003',0,1,'{"schemaVersion":2,"fields":[{"key":"old_details","kind":"textarea","required":false,"minLength":0,"maxLength":20,"prompt":" V2 before upgrade "}]}');
commit;
