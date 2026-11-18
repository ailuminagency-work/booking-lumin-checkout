-- Dormant foundation only. No runtime caller, activation, backfill, or inbox ACK.
-- 0099/0100/0101 are reserved independent candidates, intentionally not copied.
begin;
create table public.payment_source_scopes (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null,
 provider text not null default 'stripe_connect' check(provider='stripe_connect'),
 platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]{8,64}$'),
 connected_account_id text not null check(connected_account_id ~ '^acct_[A-Za-z0-9]{8,64}$'),
 livemode boolean not null,
 charge_model text not null default 'direct' check(charge_model='direct'),
 created_at timestamptz not null default now(),
 foreign key(connection_id,tenant_id) references public.payment_connections(id,tenant_id),
 unique(provider,platform_account_id,connected_account_id,livemode,charge_model),
 unique(id,tenant_id,provider)
);
create table public.booking_payment_attempt_sources (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 booking_id uuid not null references public.bookings(id),
 provider text not null default 'stripe_connect' check(provider='stripe_connect'),
 source_scope_id uuid not null,
 idempotency_key text not null check(length(idempotency_key)>=16),
 created_at timestamptz not null default now(),
 foreign key(source_scope_id,tenant_id,provider) references public.payment_source_scopes(id,tenant_id,provider),
 unique(booking_id,provider),
 unique(source_scope_id,idempotency_key)
);
-- No client policies; even trusted runtime cannot directly mutate these ledgers.
alter table public.payment_source_scopes enable row level security;
alter table public.payment_source_scopes force row level security;
alter table public.booking_payment_attempt_sources enable row level security;
alter table public.booking_payment_attempt_sources force row level security;
revoke all on public.payment_source_scopes,public.booking_payment_attempt_sources from public,anon,authenticated,service_role;
grant select on public.payment_source_scopes,public.booking_payment_attempt_sources to service_role;
create function lumin.guard_payment_source_immutable() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'PAYMENT_SOURCE_IMMUTABLE' using errcode='P0001';
end$$;
revoke all on function lumin.guard_payment_source_immutable() from public,anon,authenticated,service_role;
create trigger payment_source_scopes_immutable before update or delete on public.payment_source_scopes
 for each row execute function lumin.guard_payment_source_immutable();
create trigger booking_payment_attempt_sources_immutable before update or delete on public.booking_payment_attempt_sources
 for each row execute function lumin.guard_payment_source_immutable();

-- platform/mode are TRUSTED DEPLOYMENT ASSERTIONS, not provider verification.
-- Account and connection are always derived from canonical tenant connection.
create function public.register_payment_source_scope(p_tenant_id uuid,p_platform_account_id text,p_livemode boolean)
returns public.payment_source_scopes language plpgsql security definer set search_path='' as $$
declare c public.payment_connections; s public.payment_source_scopes;
begin
 if p_tenant_id is null or p_platform_account_id is null or p_livemode is null
 or p_platform_account_id !~ '^acct_[A-Za-z0-9]{8,64}$' then raise exception 'INVALID_PAYMENT_SOURCE'; end if;
 select * into c from public.payment_connections where tenant_id=p_tenant_id and provider='stripe_connect' for update;
 if not found or c.status<>'connected' or not c.charges_enabled or c.account_id is null
 or c.account_id !~ '^acct_[A-Za-z0-9]{8,64}$' then raise exception 'PAYMENT_CONNECTION_UNAVAILABLE'; end if;
 insert into public.payment_source_scopes(tenant_id,connection_id,platform_account_id,connected_account_id,livemode)
 values(p_tenant_id,c.id,p_platform_account_id,c.account_id,p_livemode) on conflict do nothing;
 select * into s from public.payment_source_scopes where provider='stripe_connect'
 and platform_account_id=p_platform_account_id and connected_account_id=c.account_id and livemode=p_livemode and charge_model='direct';
 if not found or s.tenant_id<>p_tenant_id or s.connection_id<>c.id then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 return s;
end$$;

-- NULL expected source is a read-existing-only retry; first bind requires scope.
-- Return immutable original before checking current connection, including revoked.
-- One attempt per booking/provider; replacement attempt policy deliberately absent.
create function public.bind_booking_payment_source(p_tenant_id uuid,p_booking_id uuid,p_expected_source_scope_id uuid default null)
returns public.booking_payment_attempt_sources language plpgsql security definer set search_path='' as $$
declare b public.bookings; a public.booking_payment_attempt_sources;
 s public.payment_source_scopes; c public.payment_connections;
begin
 select * into b from public.bookings where id=p_booking_id and tenant_id=p_tenant_id for update;
 if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
 select * into a from public.booking_payment_attempt_sources where booking_id=b.id and provider='stripe_connect';
 if found then
  if a.tenant_id<>b.tenant_id or a.idempotency_key<>b.idempotency_key
   or (p_expected_source_scope_id is not null and a.source_scope_id<>p_expected_source_scope_id)
   then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
  return a;
 end if;
 -- Never retrofit a source onto recorded payments (including staging_mock).
 -- Absence of a row does NOT prove no historical provider call: future wiring
 -- must invoke this only before a new attempt, never as legacy reconstruction.
 if b.payment_id is not null or b.state not in ('draft','pending_payment')
 or exists(select 1 from public.payments where booking_id=b.id)
 then raise exception 'PAYMENT_SOURCE_LEGACY_OR_TERMINAL'; end if;
 if p_expected_source_scope_id is null then raise exception 'PAYMENT_SOURCE_REQUIRED'; end if;
 select * into s from public.payment_source_scopes where id=p_expected_source_scope_id and tenant_id=b.tenant_id and provider='stripe_connect';
 if not found then raise exception 'PAYMENT_SOURCE_CONFLICT'; end if;
 select * into c from public.payment_connections where tenant_id=b.tenant_id and provider='stripe_connect' for update;
 if not found or c.id<>s.connection_id or c.account_id is distinct from s.connected_account_id
 or c.status<>'connected' or not c.charges_enabled then raise exception 'PAYMENT_CONNECTION_UNAVAILABLE'; end if;
 insert into public.booking_payment_attempt_sources(tenant_id,booking_id,source_scope_id,idempotency_key)
 values(b.tenant_id,b.id,s.id,b.idempotency_key) returning * into a;
 return a;
end$$;
revoke all on function public.register_payment_source_scope(uuid,text,boolean),public.bind_booking_payment_source(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_payment_source_scope(uuid,text,boolean),public.bind_booking_payment_source(uuid,uuid,uuid) to service_role;
comment on table public.payment_source_scopes is 'Dormant immutable direct-charge routing context; platform/mode are trusted deployment assertions, not provider verification. No credentials or legacy backfill.';
comment on table public.booking_payment_attempt_sources is 'Dormant pre-provider attempt-source binding only. No payment/intent/event authority or replacement attempt policy. Runtime remains unwired.';
commit;
