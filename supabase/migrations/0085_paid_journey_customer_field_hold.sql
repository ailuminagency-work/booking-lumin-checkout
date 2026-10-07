-- Dedicated V9 request provenance; original capacity and financial writers stay unchanged.
begin;
create table public.paid_journey_customer_field_requests(
 token_hash text primary key references public.paid_journey_customer_field_sessions(token_hash),
 tenant_id uuid not null,flow_id uuid not null,booking_id uuid not null unique,version_id uuid not null,installation_id uuid not null,service_id uuid not null,
 publication_generation bigint not null check(publication_generation>0),
 idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),canonical_payload jsonb not null,published_render jsonb not null,
 foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id),
 foreign key(tenant_id,flow_id,version_id,installation_id) references public.flow_installations(tenant_id,flow_id,version_id,id),
 check(jsonb_typeof(canonical_payload)='object' and octet_length(canonical_payload::text)<=32768),
 check(jsonb_typeof(published_render)='object' and published_render->'renderSchemaVersion'='9'::jsonb)
);
alter table public.paid_journey_customer_field_requests enable row level security;
alter table public.paid_journey_customer_field_requests force row level security;
revoke all on public.paid_journey_customer_field_requests from public,anon,authenticated,service_role;
create trigger journey_customer_field_requests_immutable before update or delete on public.paid_journey_customer_field_requests for each row execute function lumin.reject_flow_version_mutation();
create function lumin.paid_journey_customer_field_request_payload(render jsonb,customer jsonb,answers jsonb,start_at timestamptz) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare payload jsonb;validated jsonb;
begin
 if render is null or render->'renderSchemaVersion' is distinct from '9'::jsonb then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 payload:=lumin.paid_journey_request_payload(customer,'{}',start_at);
 validated:=lumin.conditional_customer_field_answers(render#>'{form,customerFields}',answers);
 payload:=payload||jsonb_build_object('answers',validated);
 if octet_length(payload::text)>32768 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 return payload;
end$$;
revoke all on function lumin.paid_journey_customer_field_request_payload(jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
create function lumin.paid_journey_customer_field_hold_context(hash text,origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- Acquire configuration fences before catalog rows, current flow and session.
 perform lumin.group_prefix(false);
 lock table public.service_resources,public.services,public.availability_rules,public.availability_overrides,public.scheduling_policies in share mode;
 perform public.paid_journey_customer_field_availability_scope(hash,origin);
 return public.resolve_paid_journey_customer_field_session(hash,origin);
end$$;
revoke all on function lumin.paid_journey_customer_field_hold_context(text,text) from public,anon,authenticated,service_role;
create function public.paid_journey_customer_field_hold_target(hash text,origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_customer_field_sessions;r public.paid_journey_customer_field_requests;b public.bookings;ctx jsonb;payload jsonb;finish timestamptz;
begin
 ctx:=lumin.paid_journey_customer_field_hold_context(hash,origin);
 select * into s from public.paid_journey_customer_field_sessions where token_hash=hash for update;
 select * into r from public.paid_journey_customer_field_requests where token_hash=hash for share;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 payload:=lumin.paid_journey_customer_field_request_payload(ctx->'render',r.canonical_payload->'customer',r.canonical_payload->'answers',(r.canonical_payload->>'requestedStart')::timestamptz);
 if r.canonical_payload is distinct from payload or r.published_render is distinct from ctx->'render' or row(r.tenant_id,r.flow_id,r.version_id,r.installation_id,r.service_id,r.publication_generation) is distinct from row(s.tenant_id,s.flow_id,s.version_id,s.installation_id,s.service_id,s.publication_generation) then raise exception 'CONFLICT' using errcode='40001';end if;
 finish:=(payload->>'requestedStart')::timestamptz+make_interval(mins=>(ctx#>>'{render,service,durationMinutes}')::integer);
 select * into b from public.bookings where id=r.booking_id and tenant_id=s.tenant_id for update;
 if not found or b.state<>'draft' or b.payment_id is not null or exists(select 1 from public.payments where booking_id=b.id) or exists(select 1 from public.allocation_group_heads where booking_id=b.id) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if b.selection is distinct from jsonb_build_object('serviceId',s.service_id) or b.pricing is distinct from '{}'::jsonb or b.idempotency_key is distinct from 'paid-journey:fields:'||hash or b.slot_start is distinct from (payload->>'requestedStart')::timestamptz or b.slot_end is distinct from finish or not exists(select 1 from public.customers c where c.id=b.customer_id and c.tenant_id=s.tenant_id and c.email=payload#>>'{customer,email}') then raise exception 'CONFLICT' using errcode='40001';end if;
 if s.expires_at<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('tenantId',s.tenant_id,'sessionExpiresAt',s.expires_at,'publicationGeneration',s.publication_generation,'versionId',s.version_id,'installationId',s.installation_id,'serviceId',s.service_id,'bookingId',b.id,'reference',b.reference,'slot',jsonb_build_object('start',to_char(b.slot_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(b.slot_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'render',ctx->'render');
end$$;
create function public.submit_paid_journey_customer_field_hold_request(hash text,origin text,key text,customer jsonb,answers jsonb,start_at timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.paid_journey_customer_field_sessions;ctx jsonb;payload jsonb;old public.paid_journey_customer_field_requests;booking uuid;cust uuid;ref text;finish timestamptz;replayed boolean:=false;
begin
 ctx:=lumin.paid_journey_customer_field_hold_context(hash,origin);
 select * into s from public.paid_journey_customer_field_sessions where token_hash=hash for update;
 if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 payload:=lumin.paid_journey_customer_field_request_payload(ctx->'render',customer,answers,start_at);
 if key is null or key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into old from public.paid_journey_customer_field_requests where token_hash=hash;
 if found then
  if old.idempotency_key is distinct from key or old.canonical_payload is distinct from payload then raise exception 'CONFLICT' using errcode='40001';end if;replayed:=true;
 else
  if start_at<=clock_timestamp() then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  finish:=start_at+make_interval(mins=>(ctx#>>'{render,service,durationMinutes}')::integer);
  insert into public.customers(tenant_id,name,email) values(s.tenant_id,customer->>'name',customer->>'email') on conflict(tenant_id,email) do nothing returning id into cust;
  if cust is null then select id into cust from public.customers where tenant_id=s.tenant_id and email=customer->>'email';end if;
  booking:=gen_random_uuid();ref:='LMN-'||upper(replace(booking::text,'-',''));
  -- The existing legacy payment exclusion recognizes the reserved paid-journey prefix.
  insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key) values(booking,s.tenant_id,ref,'draft',jsonb_build_object('serviceId',s.service_id),'{}',start_at,finish,cust,'paid-journey:fields:'||hash);
  insert into public.paid_journey_customer_field_requests values(hash,s.tenant_id,s.flow_id,booking,s.version_id,s.installation_id,s.service_id,s.publication_generation,key,payload,ctx->'render');
 end if;
 return public.paid_journey_customer_field_hold_target(hash,origin)||jsonb_build_object('replayed',replayed);
end$$;
revoke all on function public.paid_journey_customer_field_hold_target(text,text),public.submit_paid_journey_customer_field_hold_request(text,text,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.paid_journey_customer_field_hold_target(text,text),public.submit_paid_journey_customer_field_hold_request(text,text,text,jsonb,jsonb,timestamptz) to service_role;
commit;