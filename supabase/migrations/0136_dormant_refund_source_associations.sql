-- Dormant evidence associations only. No refund totals, provider calls or financial effects.
begin;
create table payment_internal.charge_anchors(
 id uuid primary key default gen_random_uuid(),
 source_scope_id uuid not null references public.payment_source_scopes(id),
 charge_id text not null check(charge_id ~ '^ch_[A-Za-z0-9]{1,252}$'),
 payment_id uuid not null references public.payments(id),
 attempt_id uuid not null references public.booking_payment_attempt_sources(id),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 origin_receipt_id uuid not null references payment_internal.event_receipts(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(source_scope_id,charge_id)
);
create table payment_internal.refund_anchors(
 id uuid primary key default gen_random_uuid(),
 source_scope_id uuid not null references public.payment_source_scopes(id),
 refund_id text not null check(refund_id ~ '^re_[A-Za-z0-9]{1,252}$'),
 charge_anchor_id uuid not null references payment_internal.charge_anchors(id),
 payment_id uuid not null references public.payments(id),
 amount bigint not null check(amount between 0 and 9007199254740991),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 origin_receipt_id uuid not null references payment_internal.event_receipts(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(source_scope_id,refund_id)
);
create table payment_internal.charge_anchor_conflicts(
 anchor_id uuid primary key references payment_internal.charge_anchors(id),
 receipt_id uuid not null references payment_internal.event_receipts(id),
 reason text not null check(reason='association_conflict'),
 created_at timestamptz not null default clock_timestamp()
);
create table payment_internal.refund_anchor_conflicts(
 anchor_id uuid primary key references payment_internal.refund_anchors(id),
 receipt_id uuid not null references payment_internal.event_receipts(id),
 reason text not null check(reason='association_conflict'),
 created_at timestamptz not null default clock_timestamp()
);
alter table payment_internal.charge_anchors enable row level security;
alter table payment_internal.charge_anchors force row level security;
revoke all on payment_internal.charge_anchors from public,anon,authenticated,service_role;
create trigger charge_anchors_immutable before update or delete on payment_internal.charge_anchors for each row execute function lumin.guard_payment_source_immutable();
alter table payment_internal.refund_anchors enable row level security;
alter table payment_internal.refund_anchors force row level security;
revoke all on payment_internal.refund_anchors from public,anon,authenticated,service_role;
create trigger refund_anchors_immutable before update or delete on payment_internal.refund_anchors for each row execute function lumin.guard_payment_source_immutable();
alter table payment_internal.charge_anchor_conflicts enable row level security;
alter table payment_internal.charge_anchor_conflicts force row level security;
revoke all on payment_internal.charge_anchor_conflicts from public,anon,authenticated,service_role;
create trigger charge_anchor_conflicts_immutable before update or delete on payment_internal.charge_anchor_conflicts for each row execute function lumin.guard_payment_source_immutable();
alter table payment_internal.refund_anchor_conflicts enable row level security;
alter table payment_internal.refund_anchor_conflicts force row level security;
revoke all on payment_internal.refund_anchor_conflicts from public,anon,authenticated,service_role;
create trigger refund_anchor_conflicts_immutable before update or delete on payment_internal.refund_anchor_conflicts for each row execute function lumin.guard_payment_source_immutable();

create function payment_internal.associate_refund_receipt(p_receipt_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r payment_internal.event_receipts; original payment_internal.event_receipts; s public.payment_source_scopes; p public.payments;
 c payment_internal.charge_anchors; f payment_internal.refund_anchors; canonical boolean:=false; charge_usable boolean:=false;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'UNSUPPORTED_ISOLATION' using errcode='25001';end if;
 select * into r from payment_internal.event_receipts where id=p_receipt_id for update;
 if not found then return jsonb_build_object('status','quarantined','reason','unmatched');end if;
 if exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id) then return jsonb_build_object('status','quarantined','reason','receipt_conflict');end if;
 if r.schema_version<>3 or r.parser_version<>3 or r.object_type not in ('charge','refund') then return jsonb_build_object('status','quarantined','reason','unsupported_type');end if;
 select * into s from public.payment_source_scopes where provider=r.provider and platform_account_id=r.platform_account_id and connected_account_id=r.connected_account_id and livemode=r.livemode and charge_model='direct';
 if not found then return jsonb_build_object('status','quarantined','reason','unmatched');end if;
 -- Unknown pointers never authorize a new binding. Known contradictory facts
 -- still invalidate an existing entity without chasing any financial/other receipt lock.
 if r.intent_id is null or (r.object_type='refund' and r.charge_id is null) then
  if r.object_type='refund' then
   select * into f from payment_internal.refund_anchors where source_scope_id=s.id and refund_id=r.refund_id for update;
   if found then
    select * into original from payment_internal.event_receipts where id=f.origin_receipt_id;
    if r.refund_amount is distinct from f.amount or r.currency is distinct from f.currency
     or (r.intent_id is not null and r.intent_id is distinct from original.intent_id)
     or (r.charge_id is not null and r.charge_id is distinct from original.charge_id) then
     insert into payment_internal.refund_anchor_conflicts(anchor_id,receipt_id,reason) values(f.id,r.id,'association_conflict') on conflict(anchor_id) do nothing;
    end if;
    if exists(select 1 from payment_internal.refund_anchor_conflicts where anchor_id=f.id)
     or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=f.origin_receipt_id) then return jsonb_build_object('status','quarantined','reason','association_conflict');end if;
   end if;
  else
   select * into c from payment_internal.charge_anchors where source_scope_id=s.id and charge_id=r.charge_id for update;
   if found then
    if r.currency is distinct from c.currency then insert into payment_internal.charge_anchor_conflicts(anchor_id,receipt_id,reason) values(c.id,r.id,'association_conflict') on conflict(anchor_id) do nothing;end if;
    if exists(select 1 from payment_internal.charge_anchor_conflicts where anchor_id=c.id)
     or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=c.origin_receipt_id) then return jsonb_build_object('status','quarantined','reason','association_conflict');end if;
   end if;
  end if;
  return jsonb_build_object('status','quarantined','reason','unresolved_pointer');
 end if;
 -- Candidate payment only. Never chase another anchor's payment or lock a second receipt.
 select * into p from public.payments where source_scope_id=s.id and provider=r.provider and provider_intent_id=r.intent_id for update;
 if found then
  perform 1 from public.bookings where id=p.booking_id and tenant_id=p.tenant_id for share;
  select exists(select 1 from public.booking_payment_attempt_sources a
   join public.payment_attempt_requests q on q.attempt_id=a.id
   join public.payment_attempt_intents i on i.attempt_id=a.id
   join public.payment_request_envelopes e on e.attempt_id=a.id
   join public.bookings b on b.id=a.booking_id and b.tenant_id=a.tenant_id
   where a.id=p.attempt_id and a.source_scope_id=s.id and a.tenant_id=s.tenant_id and p.tenant_id=s.tenant_id
    and a.provider=p.provider and a.booking_id=p.booking_id and b.idempotency_key=a.idempotency_key
    and i.source_scope_id=s.id and i.provider_intent_id=p.provider_intent_id
    and q.amount=p.amount and q.currency=p.currency::text and r.currency=p.currency::text)
  into canonical;
 end if;
 if r.object_type='charge' then
  if canonical then
   insert into payment_internal.charge_anchors(source_scope_id,charge_id,payment_id,attempt_id,currency,origin_receipt_id)
   values(s.id,r.charge_id,p.id,p.attempt_id,r.currency,r.id) on conflict(source_scope_id,charge_id) do nothing;
  end if;
  select * into c from payment_internal.charge_anchors where source_scope_id=s.id and charge_id=r.charge_id for update;
  if not found then return jsonb_build_object('status','quarantined','reason','authority_unmatched');end if;
  select * into original from payment_internal.event_receipts where id=c.origin_receipt_id;
  if r.intent_id is distinct from original.intent_id or r.currency is distinct from c.currency
   or (p.id is not null and (c.payment_id is distinct from p.id or c.attempt_id is distinct from p.attempt_id)) then
   insert into payment_internal.charge_anchor_conflicts(anchor_id,receipt_id,reason) values(c.id,r.id,'association_conflict') on conflict(anchor_id) do nothing;
   return jsonb_build_object('status','quarantined','reason','association_conflict');
  end if;
  -- Fresh committed provenance/conflict checks, never a claim about future conflicts.
  if exists(select 1 from payment_internal.charge_anchor_conflicts where anchor_id=c.id)
   or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=c.origin_receipt_id) then return jsonb_build_object('status','quarantined','reason','association_conflict');end if;
  if not canonical then return jsonb_build_object('status','quarantined','reason','authority_unmatched');end if;
  return jsonb_build_object('status','associated_observation','entityType','charge','associationId',c.id);
 end if;
 -- Candidate financial rows precede charge anchor, then refund anchor. No reverse graph chase.
 select * into c from payment_internal.charge_anchors where source_scope_id=s.id and charge_id=r.charge_id for update;
 if found then
  select * into original from payment_internal.event_receipts where id=c.origin_receipt_id;
  charge_usable:=canonical and c.payment_id=p.id and c.attempt_id=p.attempt_id and c.currency=r.currency and original.intent_id=r.intent_id
   and not exists(select 1 from payment_internal.charge_anchor_conflicts where anchor_id=c.id)
   and not exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=c.origin_receipt_id);
 end if;
 if charge_usable then
  insert into payment_internal.refund_anchors(source_scope_id,refund_id,charge_anchor_id,payment_id,amount,currency,origin_receipt_id)
  values(s.id,r.refund_id,c.id,p.id,r.refund_amount,r.currency,r.id) on conflict(source_scope_id,refund_id) do nothing;
 end if;
 select * into f from payment_internal.refund_anchors where source_scope_id=s.id and refund_id=r.refund_id for update;
 if not found then return jsonb_build_object('status','quarantined','reason','charge_unmatched');end if;
 select * into original from payment_internal.event_receipts where id=f.origin_receipt_id;
 if r.intent_id is distinct from original.intent_id or r.charge_id is distinct from original.charge_id
  or r.refund_amount is distinct from f.amount or r.currency is distinct from f.currency
  or (p.id is not null and f.payment_id is distinct from p.id) then
  insert into payment_internal.refund_anchor_conflicts(anchor_id,receipt_id,reason) values(f.id,r.id,'association_conflict') on conflict(anchor_id) do nothing;
  return jsonb_build_object('status','quarantined','reason','association_conflict');
 end if;
 if exists(select 1 from payment_internal.refund_anchor_conflicts where anchor_id=f.id)
  or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=f.origin_receipt_id) then return jsonb_build_object('status','quarantined','reason','association_conflict');end if;
 -- Reread origin conflicts after both anchor locks; do not lock another receipt.
 if not charge_usable or f.charge_anchor_id is distinct from c.id
  or exists(select 1 from payment_internal.charge_anchor_conflicts where anchor_id=c.id)
  or exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=c.origin_receipt_id) then return jsonb_build_object('status','quarantined','reason','charge_unmatched');end if;
 return jsonb_build_object('status','associated_observation','entityType','refund','associationId',f.id);
end$$;
revoke all on function payment_internal.associate_refund_receipt(uuid) from public,anon,authenticated,service_role;
grant execute on function payment_internal.associate_refund_receipt(uuid) to service_role;
comment on function payment_internal.associate_refund_receipt(uuid) is 'Dormant receipt-derived evidence association only. No financial permission, refund total, state winner, ACK or runtime activation. Later provenance conflicts invalidate prospective usability, not immutable history.';
commit;
