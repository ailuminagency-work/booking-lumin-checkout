-- Owner discovery only; preserves closed direct grants on private drafts.
begin;
create function public.owner_paid_simple_drafts(p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.paid_simple_drafts; bounded public.paid_simple_drafts[]; drafts jsonb:='[]'::jsonb;
begin
 perform lumin.flow_actor(p_actor,p_tenant,true);
 select array_agg(entries.row order by (entries.row).flow_id) into bounded from (select row from public.paid_simple_drafts row where tenant_id=p_tenant order by flow_id limit 51) entries;
 if cardinality(bounded)>50 then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 foreach d in array coalesce(bounded,array[]::public.paid_simple_drafts[]) loop
  perform lumin.paid_simple_service(p_tenant,d.service_id);
  drafts:=drafts||jsonb_build_array(jsonb_build_object('flowId',d.flow_id,'name',d.name,'revision',d.revision,'serviceId',d.service_id,
   'presentation',jsonb_build_object('accentColor',d.accent_color,'layout',d.layout)));
 end loop;
 return jsonb_build_object('drafts',drafts);
end $$;
revoke all on function public.owner_paid_simple_drafts(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.owner_paid_simple_drafts(uuid,uuid) to service_role;
commit;
