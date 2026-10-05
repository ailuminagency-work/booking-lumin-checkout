-- Confirmation delivery foundation only. No provider, worker activation or backfill.
begin;
create table public.confirmation_delivery_receipts (
 tenant_id uuid not null,
 booking_id uuid not null,
 channel text not null check(channel in ('email','sms')),
 delivered_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,booking_id,channel),
 foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id)
);
alter table public.confirmation_delivery_receipts enable row level security;
alter table public.confirmation_delivery_receipts force row level security;
revoke all on public.confirmation_delivery_receipts from public,anon,authenticated,service_role;
create function public.outbox_lease_confirmed(p_tenant uuid,p_limit integer default 10,p_lease_seconds integer default 60)
returns setof public.durable_outbox language plpgsql security definer set search_path=pg_catalog as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if p_tenant is null or p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 1 and 300 then
  raise exception 'OUTBOX_INVALID_LEASE' using errcode='22023';
 end if;
 -- Exhausted crashed workers are terminal, not silently reclaimable forever.
 with exhausted as (
  select id from public.durable_outbox where tenant_id=p_tenant and event_type='booking.confirmed' and state='leased'
  and lease_until<=stamp and attempts>=max_attempts order by lease_until,id limit 100 for update skip locked
 ) update public.durable_outbox o set state='dead',lease_until=null,last_failure='lease_expired'
 from exhausted e where o.id=e.id;
 return query with candidates as (
  select id from public.durable_outbox where tenant_id=p_tenant and event_type='booking.confirmed' and attempts<max_attempts
  and ((state='ready' and available_at<=stamp) or (state='leased' and lease_until<=stamp))
  order by available_at,id limit p_limit for update skip locked
 ) update public.durable_outbox o set state='leased',attempts=o.attempts+1,generation=o.generation+1,
 lease_token=gen_random_uuid(),lease_until=stamp+make_interval(secs=>p_lease_seconds)
 from candidates c where o.id=c.id returning o.*;
end $$;
create function public.outbox_confirmation_current(p_tenant uuid,p_booking uuid,p_id uuid,p_token uuid,p_generation bigint)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.durable_outbox where tenant_id=p_tenant and booking_id=p_booking and id=p_id
 and event_type='booking.confirmed' and dedup_key=booking_id and payload='{}'::jsonb
 and state='leased' and lease_token=p_token and generation=p_generation and lease_until>clock_timestamp())
$$;
create function public.outbox_confirmation_delivered(p_tenant uuid,p_booking uuid,p_channel text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or p_booking is null or p_channel is null or p_channel not in ('email','sms') then
  raise exception 'CONFIRMATION_DELIVERY_INVALID' using errcode='22023';
 end if;
 return exists(select 1 from public.confirmation_delivery_receipts where tenant_id=p_tenant and booking_id=p_booking and channel=p_channel);
end$$;
create function public.outbox_confirmation_record(p_tenant uuid,p_booking uuid,p_id uuid,p_token uuid,p_generation bigint,p_channel text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare item public.durable_outbox;
begin
 if p_channel is null or p_channel not in ('email','sms') then raise exception 'CONFIRMATION_DELIVERY_INVALID' using errcode='22023';end if;
 select * into item from public.durable_outbox where tenant_id=p_tenant and booking_id=p_booking and id=p_id for update;
 -- Evaluate the deadline AFTER obtaining the lock, including lock-wait time.
 if not found or item.event_type<>'booking.confirmed' or item.dedup_key<>item.booking_id or item.payload<>'{}'::jsonb
 or p_token is null or p_generation is null or item.lease_token is distinct from p_token or item.generation<>p_generation
 or item.state<>'leased' or item.lease_until<=clock_timestamp() then return false;end if;
 -- The FK insertion can itself wait on a booking KEY SHARE lock. Roll back
 -- this subtransaction if any insertion wait carried us beyond the deadline.
 begin
  insert into public.confirmation_delivery_receipts(tenant_id,booking_id,channel)
  values(item.tenant_id,item.booking_id,p_channel) on conflict(tenant_id,booking_id,channel) do nothing;
  if item.lease_until<=clock_timestamp() then
   raise exception 'CONFIRMATION_DELIVERY_LEASE_EXPIRED' using errcode='P6401';
  end if;
 exception when sqlstate 'P6401' then return false;
 end;
 return true;
end$$;
revoke all on function public.outbox_lease_confirmed(uuid,integer,integer),public.outbox_confirmation_current(uuid,uuid,uuid,uuid,bigint),public.outbox_confirmation_delivered(uuid,uuid,text),public.outbox_confirmation_record(uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.outbox_lease_confirmed(uuid,integer,integer),public.outbox_confirmation_current(uuid,uuid,uuid,uuid,bigint),public.outbox_confirmation_delivered(uuid,uuid,text),public.outbox_confirmation_record(uuid,uuid,uuid,uuid,bigint,text) to service_role;
comment on table public.confirmation_delivery_receipts is 'Immutable per tenant/booking/confirmed/channel successful send receipts. No payload, recipient, provider identifiers, errors or credentials. At-least-once external effects; not delivery certification.';
comment on function public.outbox_lease_confirmed(uuid,integer,integer) is 'Confirmed-only lease and exhausted-expiry processing. Requested/changed rows remain untouched. Existing ack/retry RPC authority retained.';
commit;
