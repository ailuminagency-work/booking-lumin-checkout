begin;
do $$
declare fields jsonb:='[{"id":"custom_access","kind":"text","label":"Access","required":true,"maxLength":20},{"id":"custom_code","kind":"text","label":"Code","required":true,"maxLength":4,"when":{"fieldId":"custom_access","equals":"gate"}},{"id":"custom_note","kind":"text","label":"Note","required":false,"maxLength":10,"when":{"fieldId":"custom_code","equals":"1234"}}]';bad jsonb;value jsonb;name text;
begin
 if not lumin.conditional_customer_fields_valid(fields) then raise exception 'valid ordered conditional fields rejected';end if;
 if lumin.conditional_customer_field_answers(fields,'{"custom_access":"door"}')<>'{"custom_access":"door"}' then raise exception 'hidden required field incorrectly enforced';end if;
 if lumin.conditional_customer_field_answers(fields,'{"custom_access":"gate","custom_code":"1234","custom_note":" exact "}')<>'{"custom_access":"gate","custom_code":"1234","custom_note":" exact "}' then raise exception 'exact valid values changed';end if;
 if lumin.conditional_customer_field_answers(fields,'{"custom_access":"Gate"}')<>'{"custom_access":"Gate"}' then raise exception 'condition equality was coerced';end if;
 foreach bad in array array[
  jsonb_set(fields,'{0,when}','{"fieldId":"custom_code","equals":"gate"}'),
  jsonb_set(fields,'{1,when,fieldId}','"custom_code"'),
  jsonb_set(fields,'{1,when,fieldId}','"custom_missing"'),
  jsonb_set(fields,'{1,when,equals}','" "'),
  jsonb_set(fields,'{1,when}','{"fieldId":"custom_access","equals":"gate","price":1}'),
  jsonb_set(fields,'{1,id}','"custom_price"'),
  jsonb_set(fields,'{1,id}','"custom_actor_id"'),
  jsonb_set(fields,'{1,maxLength}','1.5'),
  jsonb_set(fields,'{1,label}',to_jsonb(E'bad\nlabel'::text)),
  fields||jsonb_build_array(fields->0)
 ] loop
  if lumin.conditional_customer_fields_valid(bad) then raise exception 'invalid conditional definitions accepted';end if;
 end loop;
 foreach value in array array['{}'::jsonb,'{"custom_access":"gate"}','{"custom_access":"gate","custom_code":" "}','{"custom_access":"gate","custom_code":"12345"}','{"custom_access":"door","custom_code":""}','{"custom_access":"door","custom_note":"hidden"}','{"custom_access":"door","custom_unknown":"x"}','{"custom_access":"door","price":"1"}','{"custom_access":1}'] loop
  begin perform lumin.conditional_customer_field_answers(fields,value);raise exception 'invalid conditional answer accepted';exception when sqlstate '22023' then null;end;
 end loop;
 -- Astral text uses the same UTF-16 bound as the shared contract.
 perform lumin.conditional_customer_field_answers(fields,'{"custom_access":"gate","custom_code":"😀😀"}');
 begin perform lumin.conditional_customer_field_answers(fields,'{"custom_access":"gate","custom_code":"😀😀x"}');raise exception 'UTF16 overflow accepted';exception when sqlstate '22023' then null;end;
 foreach name in array array[
 'public.save_paid_conditional_customer_field_draft(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb)',
 'public.publish_paid_conditional_customer_field_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb)',
 'public.submit_conditional_customer_field_request(text,text,text,jsonb,jsonb,timestamptz)',
 'public.owner_conditional_customer_field_publication(uuid,uuid,uuid)'
 ] loop
  if has_function_privilege('anon',name,'EXECUTE') or has_function_privilege('authenticated',name,'EXECUTE') or not has_function_privilege('service_role',name,'EXECUTE') then raise exception 'conditional RPC ACL violation';end if;
  if not exists(select 1 from pg_proc where oid=name::regprocedure and prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'fixed security definer missing';end if;
 end loop;
 if has_function_privilege('service_role','lumin.conditional_customer_field_answers(jsonb,jsonb)','EXECUTE') or has_function_privilege('anon','lumin.conditional_customer_fields_valid(jsonb)','EXECUTE') then raise exception 'private helper exposed';end if;
 if has_table_privilege('service_role','public.paid_simple_drafts','INSERT') or has_table_privilege('service_role','public.bound_flow_versions','SELECT') then raise exception 'private table grants weakened';end if;
 if not exists(select 1 from pg_class where oid='public.paid_simple_drafts'::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'draft RLS weakened';end if;
end $$;

-- Upgrade one existing V2 draft while preserving its immutable V5 installation.
insert into auth.users(id,email) values('57000000-0000-4000-8000-000000000001','conditional-sql-owner@example.test'),('57000000-0000-4000-8000-000000000009','conditional-sql-foreign@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values('57000000-0000-4000-8000-000000000002','Conditional SQL','conditional-sql-fixture','UTC','USD');
insert into public.tenant_members values('57000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000001','BUSINESS_OWNER',now());
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values('57000000-0000-4000-8000-000000000003','57000000-0000-4000-8000-000000000002','Cleaning','simple','USD',12500,60);
do $$
declare actor uuid:='57000000-0000-4000-8000-000000000001';tenant uuid:='57000000-0000-4000-8000-000000000002';flow uuid:='57000000-0000-4000-8000-000000000004';service uuid:='57000000-0000-4000-8000-000000000003';fields jsonb:='[{"id":"custom_access","kind":"text","label":"Access","required":true,"maxLength":20}]';old_snapshot jsonb;receipt jsonb;
begin
 perform public.save_paid_customer_field_draft(actor,tenant,flow,service,0,'Saved','#0e7490','compact',fields);
 perform public.publish_paid_customer_field_draft(actor,tenant,flow,1,'57000000-0000-4000-8000-000000000005','57000000-0000-4000-8000-000000000006','["https://checkout.example.test"]');
 select paid_snapshot into old_snapshot from public.flow_versions where id='57000000-0000-4000-8000-000000000005';
 fields:=fields||'[{"id":"custom_code","kind":"text","label":"Code","required":true,"maxLength":4,"when":{"fieldId":"custom_access","equals":"gate"}}]';
 receipt:=public.save_paid_conditional_customer_field_draft(actor,tenant,flow,service,1,'Conditional','#0e7490','compact',fields);
 if receipt->'schemaVersion'<>'3' or receipt->'revision'<>'2' then raise exception 'conditional upgrade receipt mismatch';end if;
 if public.get_paid_simple_draft(actor,tenant,flow)->'customerFields' is distinct from fields or public.owner_paid_simple_drafts(actor,tenant)#>'{drafts,0,customerFields}' is distinct from fields then raise exception 'read/list stripped conditional fields';end if;
 begin perform public.save_paid_conditional_customer_field_draft(actor,tenant,flow,service,1,'Stale','#0e7490','compact',fields);raise exception 'stale CAS accepted';exception when sqlstate '40001' then null;end;
 begin perform public.save_paid_customer_field_draft(actor,tenant,flow,service,2,'Downgrade','#0e7490','compact',old_snapshot->'customerFields');raise exception 'V2 writer downgrade accepted';exception when sqlstate '0A000' then null;end;
 begin perform public.publish_paid_customer_field_draft(actor,tenant,flow,2,'57000000-0000-4000-8000-000000000007','57000000-0000-4000-8000-000000000008','["https://checkout.example.test"]');raise exception 'legacy publisher accepted conditional fields';exception when sqlstate '0A000' then null;end;
 perform public.publish_paid_conditional_customer_field_draft(actor,tenant,flow,2,'57000000-0000-4000-8000-000000000007','57000000-0000-4000-8000-000000000008','["https://checkout.example.test"]');
 if (select paid_snapshot from public.flow_versions where id='57000000-0000-4000-8000-000000000005') is distinct from old_snapshot then raise exception 'V5 immutable snapshot rewritten';end if;
 begin perform public.get_paid_simple_draft('57000000-0000-4000-8000-000000000009',tenant,flow);raise exception 'foreign read accepted';exception when sqlstate '42501' then null;end;
 if exists(select 1 from public.bookings where tenant_id=tenant) or exists(select 1 from public.payments where tenant_id=tenant) or exists(select 1 from public.flow_sessions where tenant_id=tenant) then raise exception 'authoring crossed customer financial authority';end if;
end $$;
rollback;
