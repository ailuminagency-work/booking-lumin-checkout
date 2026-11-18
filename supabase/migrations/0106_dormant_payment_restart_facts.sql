-- Dormant observation only. Missing facts never prove a provider request was not sent.
begin;
create function public.read_payment_attempt_restart(p_tenant_id uuid,p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare facts jsonb; corrupt boolean;
begin
 -- One statement, one MVCC snapshot. No row locks or recovery authorization.
 select jsonb_build_object(
  'attempt_id',a.id,'booking_id',a.booking_id,'source_bound',true,
  'source',jsonb_build_object('scope_id',s.id,'provider',s.provider,
    'platform_account_id',s.platform_account_id,'connected_account_id',s.connected_account_id,
    'livemode',s.livemode,'charge_model',s.charge_model),
  'request_recorded',q.attempt_id is not null,
  'request',case when q.attempt_id is not null then jsonb_build_object(
    'amount',q.amount,'currency',q.currency,'schema_version',q.schema_version) else null end,
  'intent_associated',i.attempt_id is not null,
  'intent',case when i.attempt_id is not null then jsonb_build_object(
    'provider_intent_id',i.provider_intent_id) else null end),
  b.id is null or b.tenant_id is distinct from a.tenant_id
   or b.idempotency_key is distinct from a.idempotency_key
   or s.id is null or s.tenant_id is distinct from a.tenant_id or s.provider is distinct from a.provider
   or (i.attempt_id is not null and (q.attempt_id is null or i.source_scope_id is distinct from s.id))
 into facts,corrupt
 from public.booking_payment_attempt_sources a
 left join public.bookings b on b.id=a.booking_id
 left join public.payment_source_scopes s on s.id=a.source_scope_id
 left join public.payment_attempt_requests q on q.attempt_id=a.id
 left join public.payment_attempt_intents i on i.attempt_id=a.id
 where a.tenant_id=p_tenant_id and a.booking_id=p_booking_id and a.provider='stripe_connect';
 if corrupt then raise exception 'PAYMENT_RESTART_FACTS_CONFLICT'; end if;
 return facts;
end$$;
revoke all on function public.read_payment_attempt_restart(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_payment_attempt_restart(uuid,uuid) to service_role;
comment on function public.read_payment_attempt_restart(uuid,uuid) is 'Dormant scoped immutable restart facts; NULL for unknown/cross-tenant/unbound. Not retry permission, dispatch evidence or provider verification. No runtime caller.';
commit;
