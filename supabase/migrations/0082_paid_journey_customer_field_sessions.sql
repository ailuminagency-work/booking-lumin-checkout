-- Separate V9 presentation sessions; no reservation, customer-answer or financial writer.
begin;
create function lumin.paid_journey_customer_field_session_context(p_installation uuid,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r jsonb;i public.flow_installations;service jsonb;generation bigint;
begin
 r:=public.get_paid_journey_customer_field_render(p_installation,p_origin);
 select * into i from public.flow_installations where id=p_installation;
 perform 1 from public.tenants where id=i.tenant_id and status='active' for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 -- Publication uses catalog/profile before flow; session issuance follows that order.
 perform lumin.paid_journey_customer_field_catalog(i.tenant_id,(r#>>'{service,id}')::uuid);
 service:=lumin.paid_simple_service(i.tenant_id,(r#>>'{service,id}')::uuid);
 if service is distinct from r->'service' then raise exception 'CONFLICT' using errcode='40001';end if;
 perform 1 from public.flows where tenant_id=i.tenant_id and id=i.flow_id and published_version_id=i.version_id and status='active' for share;
 if not found or public.get_paid_journey_customer_field_render(p_installation,p_origin) is distinct from r then raise exception 'CONFLICT' using errcode='40001';end if;
 select g.generation into generation from public.paid_journey_publication_generations g where g.tenant_id=i.tenant_id and g.flow_id=i.flow_id;
 if not found then raise exception 'PROVENANCE_MISSING' using errcode='55000';end if;
 return jsonb_build_object('tenantId',i.tenant_id,'flowId',i.flow_id,'installationId',i.id,'versionId',i.version_id,'serviceId',service->>'id','generation',generation,'render',r);
end$$;
revoke all on function lumin.paid_journey_customer_field_session_context(uuid,text) from public,anon,authenticated,service_role;
create table public.paid_journey_customer_field_sessions(
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),tenant_id uuid not null,flow_id uuid not null,version_id uuid not null,installation_id uuid not null,service_id uuid not null,
 publication_generation bigint not null check(publication_generation>0),origin text not null check(lumin.flow_origins_storage_valid(jsonb_build_array(origin))),
 issued_at timestamptz not null check(isfinite(issued_at)),expires_at timestamptz not null check(isfinite(expires_at)),check(expires_at=issued_at+interval '15 minutes'),
 foreign key(tenant_id,flow_id,version_id,installation_id) references public.flow_installations(tenant_id,flow_id,version_id,id),
 foreign key(tenant_id,flow_id,version_id,service_id) references public.bound_flow_versions(tenant_id,flow_id,version_id,service_id)
);
create index journey_customer_field_session_expiry on public.paid_journey_customer_field_sessions(expires_at);
alter table public.paid_journey_customer_field_sessions enable row level security;
alter table public.paid_journey_customer_field_sessions force row level security;
revoke all on public.paid_journey_customer_field_sessions from public,anon,authenticated,service_role;
create trigger journey_customer_field_session_immutable before update or delete on public.paid_journey_customer_field_sessions for each row execute function lumin.reject_flow_version_mutation();
create function lumin.guard_paid_journey_customer_field_session() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare c jsonb;
begin
 c:=lumin.paid_journey_customer_field_session_context(new.installation_id,new.origin);
 if new.issued_at>clock_timestamp() or row(new.tenant_id,new.flow_id,new.version_id,new.service_id,new.publication_generation) is distinct from row((c->>'tenantId')::uuid,(c->>'flowId')::uuid,(c->>'versionId')::uuid,(c->>'serviceId')::uuid,(c->>'generation')::bigint) then raise exception 'SESSION_PROVENANCE_INVALID' using errcode='55000';end if;
 return new;
end$$;
revoke all on function lumin.guard_paid_journey_customer_field_session() from public,anon,authenticated,service_role;
create trigger journey_customer_field_session_insert before insert on public.paid_journey_customer_field_sessions for each row execute function lumin.guard_paid_journey_customer_field_session();
create function public.issue_paid_journey_customer_field_session(p_installation uuid,p_hash text,p_origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_customer_field_sessions;c jsonb;stamp timestamptz;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);
 if p_installation is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or not lumin.flow_origins_storage_valid(jsonb_build_array(p_origin)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 c:=lumin.paid_journey_customer_field_session_context(p_installation,p_origin);
 select * into s from public.paid_journey_customer_field_sessions where token_hash=p_hash;
 if found and (s.installation_id<>p_installation or s.origin<>p_origin) then raise exception 'CONFLICT' using errcode='40001';end if;
 if not found then
  stamp:=clock_timestamp();
  insert into public.paid_journey_customer_field_sessions(token_hash,tenant_id,flow_id,version_id,installation_id,service_id,publication_generation,origin,issued_at,expires_at)
  values(p_hash,(c->>'tenantId')::uuid,(c->>'flowId')::uuid,(c->>'versionId')::uuid,p_installation,(c->>'serviceId')::uuid,(c->>'generation')::bigint,p_origin,stamp,stamp+interval '15 minutes') on conflict(token_hash) do nothing;
 end if;
 select * into s from public.paid_journey_customer_field_sessions where token_hash=p_hash;
 if not found or s.installation_id<>p_installation or s.origin<>p_origin then raise exception 'CONFLICT' using errcode='40001';end if;
 if row(s.tenant_id,s.flow_id,s.version_id,s.service_id,s.publication_generation) is distinct from row((c->>'tenantId')::uuid,(c->>'flowId')::uuid,(c->>'versionId')::uuid,(c->>'serviceId')::uuid,(c->>'generation')::bigint) or s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('schemaVersion',2,'installationId',s.installation_id,'expiresAt',s.expires_at,'render',c->'render');
end$$;
revoke all on function public.issue_paid_journey_customer_field_session(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.issue_paid_journey_customer_field_session(uuid,text,text) to service_role;
commit;
