-- Narrow owner-only historical informational answer projection. No table grants or writers.
begin;
create function public.owner_booking_form_answers(p_actor uuid,p_tenant uuid,p_booking uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare b public.bookings;r public.flow_requests;s public.flow_sessions;v public.flow_versions;bound public.bound_flow_versions;
 n integer;validated jsonb;fields jsonb;answer jsonb;result jsonb:='[]';f jsonb;shown boolean;visible text[]:=array[]::text[];
begin
 if p_actor is null or p_tenant is null or p_booking is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into b from public.bookings where id=p_booking and tenant_id=p_tenant for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select count(*) into n from public.flow_requests where booking_id=b.id;
 if n=0 then return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'bookingId',p_booking,'status','not_recorded','provenance',null,'answers','[]'::jsonb);end if;
 if n<>1 then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 select * into r from public.flow_requests where booking_id=b.id for share;
 if r.tenant_id is distinct from p_tenant then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 select * into s from public.flow_sessions where id=r.session_id and tenant_id=r.tenant_id for share;
 if not found or s.service_id is distinct from (b.selection->>'serviceId')::uuid then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 select * into v from public.flow_versions where id=s.version_id and tenant_id=s.tenant_id and flow_id=s.flow_id for share;
 if not found then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 if v.render_schema_version not in(5,6) then return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'bookingId',p_booking,'status','unsupported','provenance',null,'answers','[]'::jsonb);end if;
 select * into bound from public.bound_flow_versions where version_id=v.id and tenant_id=v.tenant_id and flow_id=v.flow_id for share;
 if not found or bound.service_id is distinct from s.service_id or bound.service_snapshot is distinct from v.paid_snapshot->'service'
  or v.paid_snapshot#>>'{service,id}' is distinct from s.service_id::text
  or r.option_answers is not null or r.customer_payload is null or r.customer_answers is null then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 fields:=v.paid_snapshot->'customerFields';
 if v.render_schema_version=5 then
  if lumin.customer_field_snapshot_valid(v.paid_snapshot,v.source_revision) is not true then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
  validated:=lumin.customer_field_answers(fields,r.customer_answers);
 else
  if lumin.conditional_customer_field_snapshot_valid(v.paid_snapshot,v.source_revision) is not true then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
  validated:=lumin.conditional_customer_field_answers(fields,r.customer_answers);
 end if;
 if b.selection is distinct from jsonb_build_object('serviceId',s.service_id) or b.idempotency_key is distinct from 'flow-session:'||s.id::text
  or b.slot_end is distinct from b.slot_start+make_interval(mins=>(v.paid_snapshot#>>'{service,durationMinutes}')::integer) then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 if r.request_hash is distinct from lumin.customer_field_request_hash(validated,r.customer_payload,b.slot_start) then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';end if;
 -- Iterate immutable authoring order; conditional descendants of hidden fields remain hidden.
 for f in select value from jsonb_array_elements(fields) loop
  shown:=not(f ? 'when') or ((f#>>'{when,fieldId}')=any(visible) and validated ? (f#>>'{when,fieldId}') and validated->(f#>>'{when,fieldId}')=f#>'{when,equals}');
  if not shown then continue;end if;
  visible:=array_append(visible,f->>'id');
  if validated ? (f->>'id') then result:=result||jsonb_build_array(jsonb_build_object('fieldId',f->>'id','label',f->>'label','value',validated->(f->>'id')));end if;
 end loop;
 return jsonb_build_object('schemaVersion',1,'tenantId',p_tenant,'bookingId',p_booking,'status','recorded',
  'provenance',jsonb_build_object('flowId',v.flow_id,'versionId',v.id,'renderSchemaVersion',v.render_schema_version,'draftRevision',v.source_revision),'answers',result);
exception when sqlstate '22023' then raise exception 'UNVERIFIED_REQUEST' using errcode='P0002';
end $$;
revoke all on function public.owner_booking_form_answers(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_booking_form_answers(uuid,uuid,uuid) to service_role;
commit;
