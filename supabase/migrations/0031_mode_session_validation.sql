-- Existing-session validation only: no issuance, mutation or authority extension.
begin;
create function public.mode_validate_existing_flow_session(
 p_token_hash text, p_session_id uuid, p_installation uuid,
 p_renderer_origin text, p_parent_origin text, p_profile_version text,
 p_expected_version uuid, p_expected_target_revision bigint,
 p_expected_policy_revision bigint, p_issued_at timestamptz, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 i public.mode_flow_installations;
 s public.mode_flow_sessions;
 b public.bound_flow_versions;
 r jsonb;
begin
 perform lumin.mode_session_protocol();
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
 or p_session_id is null or p_installation is null or p_expected_version is null
 or p_profile_version is null or p_profile_version !~ '^[a-z][a-z0-9-]{0,63}$'
 or p_expected_target_revision is null or p_expected_target_revision not between 1 and 9007199254740991
 or p_expected_policy_revision is null or p_expected_policy_revision not between 1 and 9007199254740991
 or not lumin.mode_session_time(p_issued_at) or not lumin.mode_session_time(p_expires_at)
 or p_expires_at is distinct from p_issued_at + interval '15 minutes'
 then raise exception 'MODE_SESSION_INVALID' using errcode='22023'; end if;
 if not lumin.mode_origin(p_renderer_origin)
 or (p_parent_origin is not null and not lumin.mode_origin(p_parent_origin))
 then raise exception 'MODE_SESSION_INVALID_ORIGIN' using errcode='22023'; end if;

 -- Discovery grants no authority and never falls back to the creating RPC.
 select * into s from public.mode_flow_sessions
 where token_hash=p_token_hash and id=p_session_id and installation_id=p_installation;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;
 i:=lumin.mode_session_authority(s.tenant_id,s.flow_id,p_installation,p_renderer_origin,p_parent_origin);
 if i.profile_version<>p_profile_version or i.policy_revision<>p_expected_policy_revision
 then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;

 -- Rediscover under source locks; the service is the immutable old pin.
 select * into s from public.mode_flow_sessions
 where token_hash=p_token_hash and id=p_session_id and installation_id=i.id
 and tenant_id=i.tenant_id and flow_id=i.flow_id;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;
 select * into b from public.bound_flow_versions
 where tenant_id=s.tenant_id and flow_id=s.flow_id and version_id=s.version_id;
 if not found or b.service_id is distinct from s.service_id
 then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.services where tenant_id=i.tenant_id and id=b.service_id and active for share;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.mode_flow_sessions
 where token_hash=p_token_hash and id=p_session_id and installation_id=i.id
 and tenant_id=i.tenant_id and flow_id=i.flow_id for share;
 if not found or row(s.version_id,s.service_id,s.target_revision,s.policy_revision,s.mode,
 s.profile_version,s.renderer_origin,s.parent_origin,s.issued_at,s.expires_at)
 is distinct from row(p_expected_version,b.service_id,p_expected_target_revision,
 p_expected_policy_revision,i.mode,p_profile_version,p_renderer_origin,p_parent_origin,p_issued_at,p_expires_at)
 or s.expires_at<=clock_timestamp()
 then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;
 r:=lumin.mode_session_limit(jsonb_build_object(
 'schemaVersion',1,'sessionId',s.id,'installationId',s.installation_id,'mode',s.mode,
 'deploymentProfileVersion',s.profile_version,'rendererOrigin',s.renderer_origin,
 'parentOrigin',s.parent_origin,'versionId',s.version_id,'targetRevision',s.target_revision,
 'policyRevision',s.policy_revision,'issuedAt',lumin.mode_session_stamp(s.issued_at),
 'expiresAt',lumin.mode_session_stamp(s.expires_at),
 'render',lumin.mode_session_render(s.tenant_id,s.flow_id,s.version_id)),1048576);
 if s.expires_at<=clock_timestamp()
 then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501'; end if;
 return r;
end $$;
revoke all on function public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamptz,timestamptz) to service_role;
commit;
