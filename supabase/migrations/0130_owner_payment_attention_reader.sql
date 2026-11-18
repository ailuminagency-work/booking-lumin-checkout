-- Read-only owner-facing projection; no table grants or runtime activation.
begin;
create index payment_attention_tenant_cursor_idx on payment_internal.payment_attention(tenant_id,created_at desc,receipt_id desc);
create function payment_internal.list_payment_attention(p_tenant_id uuid,p_before timestamptz,p_receipt_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_tenant_id is null or p_limit is null or p_limit<1 or p_limit>100
  or (p_before is null)<>(p_receipt_id is null) or (p_before is not null and not isfinite(p_before)) then
  raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 with candidates as (
  select a.receipt_id,a.booking_id,b.reference,a.reason,a.created_at,
   exists(select 1 from payment_internal.event_receipt_conflicts c where c.receipt_id=a.receipt_id) conflict_seen
  from payment_internal.payment_attention a
  join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
  join public.payments p on p.id=a.payment_id and p.tenant_id=a.tenant_id and p.booking_id=a.booking_id
  where a.tenant_id=p_tenant_id and (p_before is null or (a.created_at,a.receipt_id)<(p_before,p_receipt_id))
  order by a.created_at desc,a.receipt_id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,receipt_id desc limit p_limit),
 last_row as (select * from page order by created_at,receipt_id limit 1)
 select jsonb_build_object('tenantId',p_tenant_id,'items',coalesce((select jsonb_agg(jsonb_build_object(
  'receiptId',receipt_id,'bookingId',booking_id,'bookingReference',reference,'reason',reason,
  'recordedAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'conflictSeen',conflict_seen
 ) order by created_at desc,receipt_id desc) from page),'[]'::jsonb),
 'nextCursor',case when (select count(*) from candidates)>p_limit then
  (select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||receipt_id::text from last_row) else null end)
 into result;
 return result;
end$$;
revoke all on function payment_internal.list_payment_attention(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function payment_internal.list_payment_attention(uuid,timestamptz,uuid,integer) to service_role;
comment on function payment_internal.list_payment_attention(uuid,timestamptz,uuid,integer) is 'Trusted backend authenticated tenant only. Historical read-only attention, not unresolved balance or refund authority. No capability/secret/raw payload. No runtime activation.';
commit;
