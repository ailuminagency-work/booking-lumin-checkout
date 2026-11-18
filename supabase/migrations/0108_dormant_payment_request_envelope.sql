-- Dormant closed request envelope; no dispatch or retry authorization.
begin;
create schema payment_internal;
revoke all on schema payment_internal from public,anon,authenticated,service_role;
grant usage on schema payment_internal to service_role;
create table public.payment_request_envelopes (
 attempt_id uuid primary key references public.payment_attempt_requests(attempt_id),
 api_version text not null check(api_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$' and length(api_version)<=64),
 serializer_version integer not null default 1 check(serializer_version=1),
 created_at timestamptz not null default now()
);
alter table public.payment_request_envelopes enable row level security;
alter table public.payment_request_envelopes force row level security;
revoke all on public.payment_request_envelopes from public,anon,authenticated,service_role;
create trigger payment_request_envelopes_immutable before update or delete on public.payment_request_envelopes
 for each row execute function lumin.guard_payment_source_immutable();

create function public.snapshot_payment_request_envelope(p_tenant_id uuid,p_attempt_id uuid,p_api_version text)
returns public.payment_request_envelopes language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempt_sources; b public.bookings; e public.payment_request_envelopes;
begin
 -- Syntax is not evidence of deployment compatibility. There is no default version.
 if p_api_version is null or p_api_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$' or length(p_api_version)>64
 then raise exception 'INVALID_PAYMENT_ENVELOPE'; end if;
 select * into a from public.booking_payment_attempt_sources where id=p_attempt_id and tenant_id=p_tenant_id;
 if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
 select * into b from public.bookings where id=a.booking_id and tenant_id=a.tenant_id for update;
 if not found or b.idempotency_key is distinct from a.idempotency_key
 or length(a.idempotency_key) not between 16 and 255 or a.idempotency_key !~ '^[!-~]+$'
 then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 if not exists(select 1 from public.payment_attempt_requests where attempt_id=a.id)
 then raise exception 'PAYMENT_REQUEST_REQUIRED'; end if;
 if not exists(select 1 from public.payment_source_scopes where id=a.source_scope_id and tenant_id=a.tenant_id and provider=a.provider)
 then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 select * into e from public.payment_request_envelopes where attempt_id=a.id;
 if found then
  if e.api_version<>p_api_version then raise exception 'PAYMENT_ENVELOPE_CONFLICT'; end if;
  return e;
 end if;
 -- No retrofitting a known provider observation or a terminal/recorded payment.
 if b.payment_id is not null or b.state not in ('draft','pending_payment')
 or exists(select 1 from public.payments where booking_id=b.id)
 or exists(select 1 from public.payment_attempt_intents where attempt_id=a.id)
 then raise exception 'PAYMENT_SOURCE_LEGACY_OR_TERMINAL'; end if;
 insert into public.payment_request_envelopes(attempt_id,api_version) values(a.id,p_api_version) returning * into e;
 return e;
end$$;
revoke all on function public.snapshot_payment_request_envelope(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.snapshot_payment_request_envelope(uuid,uuid,text) to service_role;

-- PRIVILEGED INTERNAL MATERIALIZER. Never expose through public RPC/HTTP, logs,
-- restart facts or clients. Contains the existing booking capability as key.
create function payment_internal.materialize_payment_request_envelope(p_tenant_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare material jsonb; corrupt boolean;
begin
 select jsonb_build_object('serializerVersion',e.serializer_version,'apiVersion',e.api_version,
  'tenantId',a.tenant_id,'bookingId',a.booking_id,'amount',q.amount,'currency',q.currency,
  'idempotencyKey',a.idempotency_key,
  'source',jsonb_build_object('platformAccountId',s.platform_account_id,'accountId',s.connected_account_id,
    'livemode',s.livemode,'chargeModel',s.charge_model)),
  b.id is null or b.tenant_id is distinct from a.tenant_id or b.idempotency_key is distinct from a.idempotency_key
  or q.attempt_id is null or s.id is null or s.tenant_id is distinct from a.tenant_id or s.provider is distinct from a.provider
  or length(a.idempotency_key) not between 16 and 255 or a.idempotency_key !~ '^[!-~]+$'
 into material,corrupt
 from public.payment_request_envelopes e
 join public.booking_payment_attempt_sources a on a.id=e.attempt_id
 left join public.payment_attempt_requests q on q.attempt_id=a.id
 left join public.bookings b on b.id=a.booking_id
 left join public.payment_source_scopes s on s.id=a.source_scope_id
 where a.tenant_id=p_tenant_id and a.id=p_attempt_id;
 if corrupt then raise exception 'PAYMENT_ENVELOPE_CONFLICT'; end if;
 return material;
end$$;
revoke all on function payment_internal.materialize_payment_request_envelope(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.materialize_payment_request_envelope(uuid,uuid) to service_role;
comment on table public.payment_request_envelopes is 'Dormant immutable version envelope referencing original immutable request and source. No dispatch evidence or legacy backfill. API-version syntax is not compatibility approval.';
commit;
