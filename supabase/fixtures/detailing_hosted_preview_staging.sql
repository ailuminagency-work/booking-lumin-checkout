-- Preview-only browser acceptance. This does not certify canonical staging publication.
-- Provision ONLY through the connected isolated child hqgtjztrsizjrsidtlqt.
-- This administrative test fixture is not evidence of owner authentication.
-- Creates no auth users and changes no existing tenant/catalog/payment data.
begin;
set local statement_timeout='15s';
set local lock_timeout='3s';
do $$
declare actor uuid;t uuid;service uuid;flow uuid;profile jsonb;offer jsonb;windows jsonb;
begin
 perform 1 from public.tenants where id='b48d0118-b82f-4ba3-9f32-0f2eedec2d73' for update;
 perform 1 from public.tenant_members where tenant_id='b48d0118-b82f-4ba3-9f32-0f2eedec2d73' order by user_id for share;
 perform 1 from public.business_profiles where tenant_id='b48d0118-b82f-4ba3-9f32-0f2eedec2d73' for share;
 select m.user_id into strict actor from public.tenant_members m join public.tenants x on x.id=m.tenant_id join public.business_profiles p on p.tenant_id=x.id
 where x.id='b48d0118-b82f-4ba3-9f32-0f2eedec2d73' and x.name='Housekeeping Staging Acceptance' and x.status='active' and p.business_type='HOUSEKEEPING' and m.role='BUSINESS_OWNER';
 if not exists(select 1 from pg_proc where oid='public.detailing_payment_target(text,text,jsonb)'::regprocedure) then raise exception 'Migration0062 required';end if;
 profile:=public.create_staging_business(actor,gen_random_uuid(),'STAGING TEST Detailing Preview Certification','staging-test-detailing-preview-0062','UTC','USD','AUTO_DETAILING','hosted_detailing_preview_fixture_0062');
 t:=(profile->>'tenantId')::uuid;
 offer:=public.create_auto_detailing_offer(actor,t,gen_random_uuid(),'{"name":"STAGING TEST Detail package","description":"Fictional controlled preview browser certification only","currency":"USD","durationMinutes":60,"packages":[{"id":"basic","label":"Basic","amount":15000}],"vehicles":[{"id":"suv","label":"SUV","multiplierBp":12500}],"addons":[{"id":"pet-hair","name":"Pet hair","amount":3000}],"locations":[{"id":"mobile","label":"Mobile","amount":2000}],"idempotencyKey":"hosted_detailing_preview_offer_0062"}'::jsonb);
 service:=(offer#>>'{service,id}')::uuid;
 select jsonb_agg(jsonb_build_object('weekday',n,'startMinute',540,'endMinute',1020,'capacity',1) order by n) into windows from generate_series(0,6) n;
 perform public.create_auto_detailing_offer_scheduling(actor,t,service,'UTC',windows,0,30,30,'hosted_detailing_preview_schedule_0062');
 if (select count(*) from public.detailing_drafts where tenant_id=t and actor_id=actor and name='STAGING TEST Detailing Preview flow')>1 then raise exception 'Ambiguous controlled fixture';end if;
 select flow_id into flow from public.detailing_drafts where tenant_id=t and actor_id=actor and name='STAGING TEST Detailing Preview flow';
 if flow is null then
  flow:=gen_random_uuid();
  perform public.save_detailing_draft(actor,t,flow,service,0,'STAGING TEST Detailing Preview flow','#4f46e5','stacked');
 end if;
 perform public.publish_detailing_draft(actor,t,flow,1,gen_random_uuid(),gen_random_uuid(),'["https://deploy-preview-97--booking-lumin-checkout-staging.netlify.app"]'::jsonb);
end$$;
select t.id tenant_id,b.service_id,f.id flow_id,f.published_version_id version_id,i.id installation_id,
 'controlled fixture provisioning, not owner authentication' evidence_scope
from public.tenants t join public.flows f on f.tenant_id=t.id
join public.bound_flow_versions b on b.tenant_id=t.id and b.flow_id=f.id and b.version_id=f.published_version_id
join public.flow_installations i on i.tenant_id=t.id and i.flow_id=f.id and i.version_id=f.published_version_id
where t.slug='staging-test-detailing-preview-0062';
commit;
