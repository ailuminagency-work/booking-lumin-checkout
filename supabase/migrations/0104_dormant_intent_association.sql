-- Dormant only: no runtime activation, payment mutation, legacy backfill or ACK change.
-- 0103 attests its own contract, NOT this extension. Witness expansion is deferred.
begin;
create table public.payment_attempt_requests (
 attempt_id uuid primary key references public.booking_payment_attempt_sources(id),
 amount bigint not null check(amount between 1 and 9007199254740991),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 schema_version integer not null default 1 check(schema_version=1),
 created_at timestamptz not null default now()
);
create table public.payment_attempt_intents (
 attempt_id uuid primary key references public.payment_attempt_requests(attempt_id),
 source_scope_id uuid not null references public.payment_source_scopes(id),
 provider_intent_id text not null check(length(provider_intent_id) between 1 and 255 and provider_intent_id=btrim(provider_intent_id) and provider_intent_id !~ '[[:cntrl:]]'),
 created_at timestamptz not null default now(),
 unique(source_scope_id,provider_intent_id)
);
alter table public.payment_attempt_requests enable row level security;
alter table public.payment_attempt_requests force row level security;
alter table public.payment_attempt_intents enable row level security;
alter table public.payment_attempt_intents force row level security;
-- No broad reads, including service_role: scoped RPC return values only.
revoke all on public.payment_attempt_requests,public.payment_attempt_intents from public,anon,authenticated,service_role;
create trigger payment_attempt_requests_immutable before update or delete on public.payment_attempt_requests
 for each row execute function lumin.guard_payment_source_immutable();
create trigger payment_attempt_intents_immutable before update or delete on public.payment_attempt_intents
 for each row execute function lumin.guard_payment_source_immutable();

create function public.snapshot_payment_attempt_request(p_tenant_id uuid,p_attempt_id uuid,p_amount bigint,p_currency text)
returns public.payment_attempt_requests language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempt_sources; b public.bookings; q public.payment_attempt_requests;
begin
 if p_amount is null or p_amount<1 or p_amount>9007199254740991 or p_currency is null or p_currency !~ '^[A-Z]{3}$'
 then raise exception 'INVALID_PAYMENT_REQUEST'; end if;
 select * into a from public.booking_payment_attempt_sources where id=p_attempt_id and tenant_id=p_tenant_id;
 if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
 -- Match existing booking-first lock order, never reverse it.
 select * into b from public.bookings where id=a.booking_id and tenant_id=a.tenant_id for update;
 if not found or b.idempotency_key<>a.idempotency_key then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 select * into q from public.payment_attempt_requests where attempt_id=a.id;
 if found then
  if q.amount<>p_amount or q.currency<>p_currency then raise exception 'PAYMENT_REQUEST_CONFLICT'; end if;
  return q;
 end if;
 if b.payment_id is not null or b.state not in ('draft','pending_payment') or exists(select 1 from public.payments where booking_id=b.id)
 then raise exception 'PAYMENT_SOURCE_LEGACY_OR_TERMINAL'; end if;
 insert into public.payment_attempt_requests(attempt_id,amount,currency) values(a.id,p_amount,p_currency) returning * into q;
 return q;
end$$;

-- All observed inputs are assertions by a trusted server parser/adapter, not proof
-- SQL can verify. Tenant/booking/source authority is never obtained from metadata.
create function public.associate_payment_attempt_intent(
 p_tenant_id uuid,p_attempt_id uuid,p_provider_intent_id text,
 p_platform_account_id text,p_connected_account_id text,p_livemode boolean,
 p_observed_amount bigint,p_observed_currency text)
returns public.payment_attempt_intents language plpgsql security definer set search_path='' as $$
declare a public.booking_payment_attempt_sources; b public.bookings; s public.payment_source_scopes;
 q public.payment_attempt_requests; i public.payment_attempt_intents;
begin
 if p_provider_intent_id is null or length(p_provider_intent_id) not between 1 and 255
 or p_provider_intent_id<>btrim(p_provider_intent_id) or p_provider_intent_id ~ '[[:cntrl:]]'
 then raise exception 'INVALID_PAYMENT_INTENT'; end if;
 select * into a from public.booking_payment_attempt_sources where id=p_attempt_id and tenant_id=p_tenant_id;
 if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
 select * into b from public.bookings where id=a.booking_id and tenant_id=a.tenant_id for update;
 if not found or b.idempotency_key<>a.idempotency_key then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 select * into q from public.payment_attempt_requests where attempt_id=a.id;
 if not found then raise exception 'PAYMENT_REQUEST_REQUIRED'; end if;
 select * into s from public.payment_source_scopes where id=a.source_scope_id and tenant_id=a.tenant_id and provider=a.provider;
 if not found or s.platform_account_id is distinct from p_platform_account_id
 or s.connected_account_id is distinct from p_connected_account_id or s.livemode is distinct from p_livemode
 then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 if q.amount is distinct from p_observed_amount or q.currency is distinct from p_observed_currency
 then raise exception 'PAYMENT_REQUEST_CONFLICT'; end if;
 select * into i from public.payment_attempt_intents where attempt_id=a.id;
 if found then
  if i.source_scope_id<>s.id or i.provider_intent_id<>p_provider_intent_id then raise exception 'PAYMENT_INTENT_CONFLICT'; end if;
  return i;
 end if;
 -- Cross-attempt competitors serialize on the unique scope/intent index.
 begin
  insert into public.payment_attempt_intents(attempt_id,source_scope_id,provider_intent_id)
  values(a.id,s.id,p_provider_intent_id) returning * into i;
 exception when unique_violation then raise exception 'PAYMENT_INTENT_CONFLICT'; end;
 return i;
end$$;
revoke all on function public.snapshot_payment_attempt_request(uuid,uuid,bigint,text),
 public.associate_payment_attempt_intent(uuid,uuid,text,text,text,boolean,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.snapshot_payment_attempt_request(uuid,uuid,bigint,text),
 public.associate_payment_attempt_intent(uuid,uuid,text,text,text,boolean,bigint,text) to service_role;
comment on table public.payment_attempt_requests is 'Dormant immutable pre-provider charge snapshot. Amount/currency are trusted server-pricing assertions, not provider verification. No runtime wiring.';
comment on table public.payment_attempt_intents is 'Dormant source-scoped provider observation association only; not a payment row, webhook authority, financial effect or readiness attestation. No backfill.';
commit;
