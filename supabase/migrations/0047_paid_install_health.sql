-- Owner evidence-only diagnostics. No new table grants or customer authority.
begin;
create function public.owner_paid_install_health(p_actor uuid,p_tenant uuid,p_flow uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f public.flows;v public.flow_versions;b public.bound_flow_versions;flow_service uuid;catalog jsonb;catalog_status text:='available';installs jsonb;session_count integer;booking_count integer;last_confirmation timestamptz;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select * into f from public.flows where tenant_id=p_tenant and id=p_flow and status='active' for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into v from public.flow_versions where tenant_id=p_tenant and flow_id=p_flow and id=f.published_version_id;
 if not found or v.render_schema_version not in(3,4) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into b from public.bound_flow_versions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id;
 select service_id into flow_service from public.bound_flow_services where tenant_id=p_tenant and flow_id=p_flow;
 if b.service_id is null or flow_service is distinct from b.service_id then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 begin
  catalog:=case when v.render_schema_version=3 then lumin.paid_simple_service(p_tenant,b.service_id) else lumin.paid_option_service(p_tenant,b.service_id) end;
 exception when sqlstate '42501' then catalog_status:='unavailable';when sqlstate '0A000' then catalog_status:='incompatible';end;
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into installs from(select id,jsonb_build_object('installationId',id,'allowedOrigins',allowed_origins) row from public.flow_installations where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id order by id limit 2)x;
 select count(*) into session_count from(select 1 from public.flow_sessions where tenant_id=p_tenant and flow_id=p_flow and version_id=v.id and service_id=b.service_id limit 1000001)x;
 -- Confirmed evidence is pinned to this version, not to arbitrary tenant bookings.
 -- No active-capability checks: expired sessions can still prove historical work.
 select count(*),max(x.confirmed_at) into booking_count,last_confirmation from(
  select (select max(h.at) from public.booking_state_history h where h.booking_id=bk.id and h.to_state='confirmed') confirmed_at
  from public.flow_sessions s
  join public.flow_requests r on r.tenant_id=s.tenant_id and r.session_id=s.id
  join public.bookings bk on bk.tenant_id=r.tenant_id and bk.id=r.booking_id
  join public.payments p on p.tenant_id=bk.tenant_id and p.booking_id=bk.id and p.id=bk.payment_id
  join public.capacity_holds h on h.tenant_id=bk.tenant_id and h.booking_id=bk.id and h.service_id=s.service_id and h.slot_start=bk.slot_start and h.slot_end=bk.slot_end and h.status='consumed'
  join public.flow_installations i on i.tenant_id=s.tenant_id and i.flow_id=s.flow_id and i.version_id=s.version_id and i.id=s.installation_id
  where s.tenant_id=p_tenant and s.flow_id=p_flow and s.version_id=v.id and s.service_id=b.service_id and i.allowed_origins ? s.origin
   and bk.state='confirmed' and p.provider='staging_mock' and p.provider_intent_id='staging_mock:'||bk.id::text and p.state='succeeded'
   and p.amount=(b.service_snapshot->'price'->>'amount')::bigint and p.currency=b.service_snapshot->'price'->>'currency'
   and bk.pricing->'total'=b.service_snapshot->'price'
   and bk.selection->>'serviceId'=b.service_id::text
   and ((v.render_schema_version=3 and r.option_answers is null and bk.selection=jsonb_build_object('serviceId',b.service_id))
     or(v.render_schema_version=4 and r.option_answers is not null and bk.selection=jsonb_build_object('serviceId',b.service_id,'answers',r.option_answers)
      and lumin.flow_answers_valid(r.option_answers,b.service_snapshot)))
   and exists(select 1 from public.booking_state_history h where h.booking_id=bk.id and h.to_state='confirmed')
  order by confirmed_at desc,bk.id limit 1000001
 )x;
 return jsonb_build_object('tenantId',p_tenant,'flowId',p_flow,'versionId',v.id,'sourceRevision',v.source_revision::text,'renderSchemaVersion',v.render_schema_version,'snapshot',v.paid_snapshot,'config',v.config,'serviceId',b.service_id,'flowServiceId',flow_service,'boundSnapshot',b.service_snapshot,'installations',installs,'catalogStatus',catalog_status,'catalogSnapshot',catalog,'issuedSessionCount',session_count,'confirmedStagingBookingCount',booking_count,'lastConfirmedStagingBookingAt',last_confirmation);
end $$;
revoke all on function public.owner_paid_install_health(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_paid_install_health(uuid,uuid,uuid) to service_role;
commit;
