-- Owner review accountability only. No financial resolution or provider action.
begin;
create table payment_internal.payment_attention_acknowledgments(
 receipt_id uuid primary key references payment_internal.payment_attention(receipt_id),
 reviewed_by uuid not null,
 reviewed_at timestamptz not null default clock_timestamp()
);
alter table payment_internal.payment_attention_acknowledgments enable row level security;
alter table payment_internal.payment_attention_acknowledgments force row level security;
revoke all on payment_internal.payment_attention_acknowledgments from public,anon,authenticated,service_role;
create trigger payment_attention_acknowledgments_immutable before update or delete on payment_internal.payment_attention_acknowledgments
 for each row execute function lumin.guard_payment_source_immutable();
create function payment_internal.acknowledge_payment_attention(p_actor uuid,p_selected_tenant uuid,p_receipt uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare tenant uuid; memberships integer; reviewed timestamptz;
begin
 if p_actor is null or p_selected_tenant is null or p_receipt is null then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'UNSUPPORTED_ISOLATION' using errcode='25001'; end if;
 -- Count ALL memberships, including historical/inactive businesses. No arbitrary pick.
 select count(*),(array_agg(m.tenant_id))[1] into memberships,tenant from public.tenant_members m where m.user_id=p_actor;
 if memberships<>1 or tenant is distinct from p_selected_tenant then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 -- Established tenant -> membership lock order; revocation after these locks waits.
 perform lumin.flow_actor(p_actor,tenant,true);
 select count(*) into memberships from public.tenant_members m where m.user_id=p_actor;
 if memberships<>1 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from payment_internal.payment_attention a
  join public.payments p on p.id=a.payment_id and p.tenant_id=a.tenant_id and p.booking_id=a.booking_id
  join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
  where a.receipt_id=p_receipt and a.tenant_id=tenant) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 insert into payment_internal.payment_attention_acknowledgments(receipt_id,reviewed_by) values(p_receipt,p_actor) on conflict(receipt_id) do nothing;
 -- Fresh READ COMMITTED statement observes the winner after unique-key arbitration.
 select reviewed_at into reviewed from payment_internal.payment_attention_acknowledgments where receipt_id=p_receipt;
 if reviewed is null then raise exception 'ACKNOWLEDGMENT_UNAVAILABLE' using errcode='40001'; end if;
 return jsonb_build_object('tenantId',tenant,'receiptId',p_receipt,'reviewedAt',to_char(reviewed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end$$;
revoke all on function payment_internal.acknowledge_payment_attention(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.acknowledge_payment_attention(uuid,uuid,uuid) to service_role;
comment on function payment_internal.acknowledge_payment_attention(uuid,uuid,uuid) is 'Trusted backend verified actor only; active owner acknowledgment, not financial resolution. Immutable first actor/time. No refund or notification.';
create or replace function payment_internal.list_payment_attention(p_tenant_id uuid,p_before timestamptz,p_receipt_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_tenant_id is null or p_limit is null or p_limit<1 or p_limit>100
  or (p_before is null)<>(p_receipt_id is null) or (p_before is not null and not isfinite(p_before)) then
  raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 with candidates as (
  select a.receipt_id,a.booking_id,b.reference,a.reason,a.created_at,ack.reviewed_at,
   exists(select 1 from payment_internal.event_receipt_conflicts c where c.receipt_id=a.receipt_id) conflict_seen
  from payment_internal.payment_attention a
  left join payment_internal.payment_attention_acknowledgments ack on ack.receipt_id=a.receipt_id
  join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
  join public.payments p on p.id=a.payment_id and p.tenant_id=a.tenant_id and p.booking_id=a.booking_id
  where a.tenant_id=p_tenant_id and (p_before is null or (a.created_at,a.receipt_id)<(p_before,p_receipt_id))
  order by a.created_at desc,a.receipt_id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,receipt_id desc limit p_limit),
 last_row as (select * from page order by created_at,receipt_id limit 1)
 select jsonb_build_object('tenantId',p_tenant_id,'items',coalesce((select jsonb_agg(jsonb_build_object(
  'receiptId',receipt_id,'bookingId',booking_id,'bookingReference',reference,'reason',reason,
  'recordedAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'conflictSeen',conflict_seen,'reviewedAt',to_char(reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 ) order by created_at desc,receipt_id desc) from page),'[]'::jsonb),
 'nextCursor',case when (select count(*) from candidates)>p_limit then
  (select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||receipt_id::text from last_row) else null end)
 into result;
 return result;
end$$;
commit;
