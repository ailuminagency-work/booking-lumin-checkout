-- Historical successful-send receipt metadata only; not customer delivery proof.
-- Owner authorization belongs to the trusted API adapter, never browser RPC access.
begin;
create function public.outbox_confirmation_receipt_history(p_tenant uuid,p_booking uuid)
returns table(channel text,recorded_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or p_booking is null then
  raise exception 'CONFIRMATION_RECEIPT_INVALID' using errcode='22023';
 end if;
 if not exists (
  select 1 from public.bookings b join public.tenants t on t.id=b.tenant_id
  where b.tenant_id=p_tenant and b.id=p_booking and t.status='active'
 ) then
  raise exception 'CONFIRMATION_RECEIPT_NOT_AVAILABLE' using errcode='P0002';
 end if;
 -- The existing primary key bounds this to one first-recorded receipt per channel.
 -- Do not filter by today's booking state: cancellation does not erase history.
 return query select r.channel,r.delivered_at
 from public.confirmation_delivery_receipts r
 where r.tenant_id=p_tenant and r.booking_id=p_booking and r.channel in ('email','sms')
 order by case r.channel when 'email' then 0 else 1 end
 limit 2;
end$$;
revoke all on function public.outbox_confirmation_receipt_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.outbox_confirmation_receipt_history(uuid,uuid) to service_role;
comment on function public.outbox_confirmation_receipt_history(uuid,uuid) is
 'Service-only, snapshot read of at most email and SMS first-recorded successful-send receipts for an active exact tenant/booking. recorded_at aliases the existing ledger timestamp; no delivery, provider activation, recipient or external exactly-once proof. Trusted API must separately verify fresh owner authorization. No writes or raw ledger grants.';
commit;
