-- Dormant quarantine only: no parser, routing, ACK, financial effects or consumers.
begin;
create table payment_internal.event_receipts (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider='stripe_connect'),
 platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]{8,64}$'),
 connected_account_id text not null check(connected_account_id ~ '^acct_[A-Za-z0-9]{8,64}$'),
 livemode boolean not null,
 event_id text not null check(length(event_id) between 1 and 255 and event_id=btrim(event_id) and event_id !~ '[[:cntrl:]]'),
 object_type text not null check(object_type='payment_intent'),
 event_type text not null check(event_type in ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled')),
 event_created bigint not null check(event_created between 0 and 253402300799),
 event_api_version text check(event_api_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$' and length(event_api_version)<=64),
 parser_version integer not null check(parser_version=1),
 schema_version integer not null check(schema_version=1),
 intent_id text not null check(length(intent_id) between 1 and 255 and intent_id=btrim(intent_id) and intent_id !~ '[[:cntrl:]]'),
 intent_amount bigint not null check(intent_amount between 1 and 9007199254740991),
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 quarantine_state text not null default 'quarantined' check(quarantine_state='quarantined'),
 received_at timestamptz not null default now(),
 unique(provider,platform_account_id,connected_account_id,livemode,event_id)
);
create table payment_internal.event_receipt_conflicts (
 receipt_id uuid primary key references payment_internal.event_receipts(id),
 first_seen_at timestamptz not null default now()
);
alter table payment_internal.event_receipts enable row level security;
alter table payment_internal.event_receipts force row level security;
alter table payment_internal.event_receipt_conflicts enable row level security;
alter table payment_internal.event_receipt_conflicts force row level security;
revoke all on payment_internal.event_receipts,payment_internal.event_receipt_conflicts from public,anon,authenticated,service_role;
create trigger event_receipts_immutable before update or delete on payment_internal.event_receipts
 for each row execute function lumin.guard_payment_source_immutable();
create trigger event_receipt_conflicts_immutable before update or delete on payment_internal.event_receipt_conflicts
 for each row execute function lumin.guard_payment_source_immutable();

create function payment_internal.record_quarantined_event(p_facts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r payment_internal.event_receipts; original jsonb; outcome text; inserted boolean;
begin
 -- Explicit trusted-server assertions only. SQL does not verify signatures or
 -- authenticate ingress/platform identity. All fields required; no extras accepted.
 if jsonb_typeof(p_facts) is distinct from 'object' then raise exception 'INVALID_PAYMENT_RECEIPT'; end if;
 if not p_facts ?& array['provider','platformAccountId','accountId','livemode','eventId','objectType','eventType','eventCreated','eventApiVersion','parserVersion','schemaVersion','intentId','intentAmount','currency']
 or (select count(*) from jsonb_object_keys(p_facts))<>14
 or exists(select 1 from unnest(array['provider','platformAccountId','accountId','eventId','objectType','eventType','intentId','currency']) k where jsonb_typeof(p_facts->k) is distinct from 'string')
 or jsonb_typeof(p_facts->'livemode') is distinct from 'boolean'
 or exists(select 1 from unnest(array['eventCreated','parserVersion','schemaVersion','intentAmount']) k where jsonb_typeof(p_facts->k) is distinct from 'number' or (p_facts->>k) !~ '^[0-9]+$')
 or jsonb_typeof(p_facts->'eventApiVersion') not in ('null','string')
 then raise exception 'INVALID_PAYMENT_RECEIPT'; end if;
 begin
  insert into payment_internal.event_receipts(provider,platform_account_id,connected_account_id,livemode,event_id,object_type,event_type,event_created,event_api_version,parser_version,schema_version,intent_id,intent_amount,currency)
  values(p_facts->>'provider',p_facts->>'platformAccountId',p_facts->>'accountId',(p_facts->>'livemode')::boolean,p_facts->>'eventId',p_facts->>'objectType',p_facts->>'eventType',(p_facts->>'eventCreated')::bigint,p_facts->>'eventApiVersion',(p_facts->>'parserVersion')::integer,(p_facts->>'schemaVersion')::integer,p_facts->>'intentId',(p_facts->>'intentAmount')::bigint,p_facts->>'currency')
  on conflict(provider,platform_account_id,connected_account_id,livemode,event_id) do nothing returning * into r;
  inserted:=found;
 exception when check_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then
  raise exception 'INVALID_PAYMENT_RECEIPT';
 end;
 if not inserted then
  -- INSERT's unique arbitration waits for the winner; this volatile statement
  -- sees its committed immutable row. No receipt can be deleted or rewritten.
  select * into r from payment_internal.event_receipts where provider=p_facts->>'provider'
   and platform_account_id=p_facts->>'platformAccountId' and connected_account_id=p_facts->>'accountId'
   and livemode=(p_facts->>'livemode')::boolean and event_id=p_facts->>'eventId';
  if not found then raise exception 'PAYMENT_RECEIPT_UNAVAILABLE'; end if;
 end if;
 original:=jsonb_build_object('provider',r.provider,'platformAccountId',r.platform_account_id,'accountId',r.connected_account_id,
  'livemode',r.livemode,'eventId',r.event_id,'objectType',r.object_type,'eventType',r.event_type,'eventCreated',r.event_created,'eventApiVersion',r.event_api_version,
  'parserVersion',r.parser_version,'schemaVersion',r.schema_version,'intentId',r.intent_id,'intentAmount',r.intent_amount,'currency',r.currency);
 if original is distinct from p_facts then
  insert into payment_internal.event_receipt_conflicts(receipt_id) values(r.id) on conflict(receipt_id) do nothing;
  outcome:='conflict';
 else outcome:=case when inserted then 'inserted' else 'duplicate' end;
 end if;
 return jsonb_build_object('receiptId',r.id,'facts',original,'quarantineState','quarantined','outcome',outcome,
  'conflictSeen',exists(select 1 from payment_internal.event_receipt_conflicts where receipt_id=r.id));
end$$;
revoke all on function payment_internal.record_quarantined_event(jsonb) from public,anon,authenticated,service_role;
grant execute on function payment_internal.record_quarantined_event(jsonb) to service_role;
comment on table payment_internal.event_receipts is 'Dormant trusted-server observations only, always quarantined. intent_amount is requested amount, not paid/captured. No tenant/routing authority, signature verification, raw payload or refund support.';
comment on table payment_internal.event_receipt_conflicts is 'Bounded immutable one-per-receipt marker. Original facts preserved; no conflicting payload stored. Caller transaction must commit to retain receipt/marker.';
commit;
