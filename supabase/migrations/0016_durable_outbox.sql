-- Foundation only: future domain writers MUST enqueue in the same transaction as
-- their mutation. No trigger/consumer or external delivery is installed here.
-- At-least-once delivery: consumers must deduplicate external side effects.
-- Payload v1 is exactly {}; typed tenant/booking/event IDs are the entire envelope.
-- No customer details, provider credentials, arbitrary errors or URLs are stored.
begin;
create table public.durable_outbox (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 booking_id uuid not null,
 event_type text not null check(event_type in ('booking.requested','booking.changed')),
 dedup_key uuid not null,
 payload jsonb not null default '{}' check(payload = '{}'::jsonb),
 state text not null default 'ready' check(state in ('ready','leased','completed','dead')),
 attempts integer not null default 0 check(attempts between 0 and 10),
 max_attempts integer not null default 5 check(max_attempts between 1 and 10),
 available_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 generation bigint not null default 0 check(generation >= 0),
 lease_until timestamptz,
 last_failure text check(last_failure in ('transient','rate_limited','permanent','lease_expired')),
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id),
 unique(tenant_id,dedup_key),
 check(attempts <= max_attempts),
 check((state = 'leased') = (lease_until is not null)),
 check(state <> 'leased' or lease_token is not null),
 check((state = 'completed') = (completed_at is not null))
);
create index durable_outbox_ready on public.durable_outbox(tenant_id,available_at,id) where state='ready';
create index durable_outbox_expired on public.durable_outbox(tenant_id,lease_until,id) where state='leased';
alter table public.durable_outbox enable row level security;
alter table public.durable_outbox force row level security;
-- No browser or platform policy. Even service_role uses RPCs rather than raw DML.
revoke all on public.durable_outbox from public,anon,authenticated,service_role;

create function public.outbox_enqueue(p_tenant uuid,p_booking uuid,p_event text,p_dedup uuid,p_payload jsonb default '{}',p_max_attempts integer default 5)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare result public.durable_outbox;
begin
 if p_tenant is null or p_booking is null or p_dedup is null or p_event is null
 or p_event not in ('booking.requested','booking.changed') or p_payload is null or p_payload <> '{}'::jsonb
 or p_max_attempts is null or p_max_attempts not between 1 and 10 then
  raise exception 'OUTBOX_INVALID_ENVELOPE' using errcode='22023';
 end if;
 insert into public.durable_outbox(tenant_id,booking_id,event_type,dedup_key,payload,max_attempts)
 values(p_tenant,p_booking,p_event,p_dedup,p_payload,p_max_attempts)
 on conflict(tenant_id,dedup_key) do nothing returning * into result;
 if result.id is null then
  select * into strict result from public.durable_outbox where tenant_id=p_tenant and dedup_key=p_dedup;
  if result.booking_id <> p_booking or result.event_type <> p_event or result.payload <> p_payload or result.max_attempts <> p_max_attempts then
   raise exception 'OUTBOX_DEDUP_CONFLICT' using errcode='22023';
  end if;
 end if;
 return result.id;
end $$;

create function public.outbox_lease(p_tenant uuid,p_limit integer default 10,p_lease_seconds integer default 60)
returns setof public.durable_outbox language plpgsql security definer set search_path=pg_catalog,public as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if p_tenant is null or p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 1 and 300 then
  raise exception 'OUTBOX_INVALID_LEASE' using errcode='22023';
 end if;
 -- Exhausted crashed workers are terminal, not silently reclaimable forever.
 with exhausted as (
  select id from public.durable_outbox where tenant_id=p_tenant and state='leased'
  and lease_until<=stamp and attempts>=max_attempts order by lease_until,id limit 100 for update skip locked
 ) update public.durable_outbox o set state='dead',lease_until=null,last_failure='lease_expired'
 from exhausted e where o.id=e.id;
 return query with candidates as (
  select id from public.durable_outbox where tenant_id=p_tenant and attempts<max_attempts
  and ((state='ready' and available_at<=stamp) or (state='leased' and lease_until<=stamp))
  order by available_at,id limit p_limit for update skip locked
 ) update public.durable_outbox o set state='leased',attempts=o.attempts+1,generation=o.generation+1,
 lease_token=gen_random_uuid(),lease_until=stamp+make_interval(secs=>p_lease_seconds)
 from candidates c where o.id=c.id returning o.*;
end $$;

create function public.outbox_ack(p_tenant uuid,p_id uuid,p_token uuid,p_generation bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare item public.durable_outbox;
begin
 select * into item from public.durable_outbox where tenant_id=p_tenant and id=p_id for update;
 if not found or p_token is null or p_generation is null or item.lease_token is distinct from p_token or item.generation<>p_generation then return false; end if;
 if item.state='completed' then return true; end if;
 if item.state<>'leased' or item.lease_until<=clock_timestamp() then return false; end if;
 update public.durable_outbox set state='completed',lease_until=null,completed_at=clock_timestamp() where id=p_id;
 return true;
end $$;

create function public.outbox_retry(p_tenant uuid,p_id uuid,p_token uuid,p_generation bigint,p_reason text default 'transient')
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare item public.durable_outbox;
begin
 if p_reason is null or p_reason not in ('transient','rate_limited','permanent') then raise exception 'OUTBOX_INVALID_REASON' using errcode='22023'; end if;
 select * into item from public.durable_outbox where tenant_id=p_tenant and id=p_id for update;
 if not found or p_token is null or p_generation is null or item.lease_token is distinct from p_token or item.generation<>p_generation
 or item.state<>'leased' or item.lease_until<=clock_timestamp() then return false; end if;
 update public.durable_outbox set state=case when attempts>=max_attempts or p_reason='permanent' then 'dead' else 'ready' end,
 lease_until=null,last_failure=p_reason,
 available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,item.attempts)::integer)) where id=p_id;
 return true;
end $$;
revoke all on function public.outbox_enqueue(uuid,uuid,text,uuid,jsonb,integer), public.outbox_lease(uuid,integer,integer), public.outbox_ack(uuid,uuid,uuid,bigint), public.outbox_retry(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.outbox_enqueue(uuid,uuid,text,uuid,jsonb,integer), public.outbox_lease(uuid,integer,integer), public.outbox_ack(uuid,uuid,uuid,bigint), public.outbox_retry(uuid,uuid,uuid,bigint,text) to service_role;
comment on table public.durable_outbox is 'Service RPC-only booking outbox v1. Empty payload; no secrets/PII. Future writer must enqueue in domain transaction. At-least-once, not exactly-once external effects. No live consumer.';
commit;
