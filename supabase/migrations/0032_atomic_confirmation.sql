-- Provider-neutral confirmation of persisted, server-verified succeeded payments.
-- No browser grant, provider I/O, payment-state input or financial-state mutation.
begin;
create function public.confirm_succeeded_payment(p_payment_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare p public.payments%rowtype;b public.bookings%rowtype;h public.capacity_holds%rowtype;sid uuid;was_active boolean;
begin
 perform lumin.group_prefix(false);
 -- Freeze source/resource scope and refund absence before touching mutable rows.
 lock table public.service_resources,public.refunds in share mode;
 if p_payment_id is null then raise exception 'CONFIRMATION_INVALID' using errcode='22023';end if;
 select * into p from public.payments where id=p_payment_id for update;
 if not found then raise exception 'CONFIRMATION_NOT_FOUND' using errcode='P0002';end if;
 perform 1 from public.tenants where id=p.tenant_id and status='active' for share;
 if not found then raise exception 'CONFIRMATION_FORBIDDEN' using errcode='42501';end if;
 select * into b from public.bookings where id=p.booking_id for update;
 if not found or b.tenant_id<>p.tenant_id then raise exception 'CONFIRMATION_MISMATCH' using errcode='22023';end if;
 sid:=lumin.planning_service_id(b.selection);
 if sid is null or not exists(select 1 from public.services where id=sid and tenant_id=b.tenant_id) then raise exception 'CONFIRMATION_MISMATCH' using errcode='22023';end if;
 if exists(select 1 from public.allocation_group_heads where booking_id=b.id)
 or exists(select 1 from public.allocation_policies where service_id=sid)
 or exists(select 1 from public.service_resources where service_id=sid) then raise exception 'CONFIRMATION_UNSUPPORTED' using errcode='0A000';end if;
 if p.state<>'succeeded' or p.amount<=0 or p.amount>9007199254740991
 or jsonb_typeof(b.pricing#>'{total,amount}') is distinct from 'number'
 or jsonb_typeof(b.pricing#>'{total,currency}') is distinct from 'string' then raise exception 'CONFIRMATION_PAYMENT_INVALID' using errcode='22023';end if;
 if (b.pricing#>>'{total,amount}')::numeric<>p.amount or b.pricing#>>'{total,currency}'<>p.currency::text
 or (b.payment_id is not null and b.payment_id<>p.id)
 or exists(select 1 from public.refunds where booking_id=b.id or payment_id=p.id) then raise exception 'CONFIRMATION_MISMATCH' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||b.tenant_id::text||':'||sid::text,0));
 select * into h from public.capacity_holds where booking_id=b.id for update;
 if not found or h.tenant_id<>b.tenant_id or h.service_id<>sid or h.slot_start<>b.slot_start or h.slot_end<>b.slot_end or h.group_id is not null then raise exception 'CONFIRMATION_HOLD_INVALID' using errcode='40001';end if;
 if b.state='confirmed' then
  if b.payment_id is distinct from p.id or h.status<>'consumed' then raise exception 'CONFIRMATION_MISMATCH' using errcode='22023';end if;
  return jsonb_build_object('bookingId',b.id,'paymentId',p.id,'state','confirmed','replayed',true);
 end if;
 if b.state not in('draft','pending_payment') then raise exception 'CONFIRMATION_STATE_INVALID' using errcode='40001';end if;
 was_active:=h.status='active';
 if not(was_active or h.status='consumed') or(was_active and (not isfinite(h.expires_at) or h.expires_at<=clock_timestamp())) then raise exception 'CONFIRMATION_HOLD_INVALID' using errcode='40001';end if;
 if was_active then
  if not public.consume_hold(b.id) then raise exception 'CONFIRMATION_HOLD_INVALID' using errcode='40001';end if;
 end if;
 if b.state='draft' then update public.bookings set state='pending_payment' where id=b.id;end if;
 update public.bookings set payment_id=p.id,state='confirmed' where id=b.id;
 -- A delayed trigger must not turn a hold that expired during this call into success.
 if was_active and h.expires_at<=clock_timestamp() then raise exception 'CONFIRMATION_HOLD_INVALID' using errcode='40001';end if;
 return jsonb_build_object('bookingId',b.id,'paymentId',p.id,'state','confirmed','replayed',false);
end$$;
revoke all on function public.confirm_succeeded_payment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_succeeded_payment(uuid) to service_role;
comment on function public.confirm_succeeded_payment(uuid) is 'Trusted provider-verified server invocation only. Reads persisted succeeded payment; never accepts caller payment state. Browser confirmation endpoint remains closed. Resource-linked/planning services unsupported.';
commit;
