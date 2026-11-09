-- Read an existing V8 hold under narrow row locks. No lifecycle writer.
begin;
create function public.get_paid_journey_hold(hash text,origin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare target jsonb;final jsonb;h public.capacity_holds;expiry timestamptz;
begin
 target:=public.paid_journey_hold_target(hash,origin);
 select * into h from public.capacity_holds where booking_id=(target->>'bookingId')::uuid for share;
 if not found or h.status<>'active' or row(h.tenant_id,h.service_id,h.booking_id) is distinct from row((target->>'tenantId')::uuid,(target->>'serviceId')::uuid,(target->>'bookingId')::uuid) or h.slot_start is distinct from (target#>>'{slot,start}')::timestamptz or h.slot_end is distinct from (target#>>'{slot,end}')::timestamptz then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 final:=public.paid_journey_hold_target(hash,origin);
 expiry:=(final->>'sessionExpiresAt')::timestamptz;
 if final is distinct from target then raise exception 'CONFLICT' using errcode='40001';end if;
 if expiry<=clock_timestamp() or h.expires_at<=clock_timestamp() or not isfinite(h.expires_at) or h.expires_at>clock_timestamp()+interval '5 minutes 1 second' then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 return (target-array['tenantId','sessionExpiresAt'])||jsonb_build_object('schemaVersion',1,'state','draft','confirmed',false,'paymentMode','unavailable','holdId',h.id,'status','active','expiresAt',to_char(h.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'replayed',true);
end$$;
revoke all on function public.get_paid_journey_hold(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_paid_journey_hold(text,text) to service_role;
commit;
