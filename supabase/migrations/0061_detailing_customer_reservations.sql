-- Dedicated schema7 request provenance; canonical booking and capacity writers remain sole authorities.
begin;
create table public.detailing_request_receipts(
 tenant_id uuid not null,session_id uuid primary key references public.flow_requests(session_id),booking_id uuid not null unique references public.flow_requests(booking_id),
 canonical_payload jsonb not null,accepted_receipt jsonb not null,
 foreign key(tenant_id,session_id) references public.flow_sessions(tenant_id,id),foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id),
 check(jsonb_typeof(canonical_payload)='object' and octet_length(canonical_payload::text)<=16384),check(jsonb_typeof(accepted_receipt)='object' and octet_length(accepted_receipt::text)<=16384));
alter table public.detailing_request_receipts enable row level security;alter table public.detailing_request_receipts force row level security;
revoke all on public.detailing_request_receipts from public,anon,authenticated,service_role;
create trigger detailing_request_receipts_immutable before update or delete on public.detailing_request_receipts for each row execute function lumin.reject_flow_version_mutation();

-- Verifies the unchanged core package/add-on/location then vehicle-multiplier model.
-- The API computes the price with core; this private check rejects a substituted quote.
create function lumin.detailing_request_model(service jsonb,choice jsonb,customer jsonb,start_at timestamptz) returns jsonb
language plpgsql immutable security definer set search_path=pg_catalog as $$
declare package jsonb;vehicle jsonb;location jsonb;addon jsonb;addons jsonb:='[]';answers jsonb;selection jsonb;lines jsonb:='[]';subtotal numeric:=0;next numeric;scaled double precision;delta numeric;currency text:=service->>'currency';amount numeric;pricing jsonb;finish timestamptz;
begin
 if choice is null or jsonb_typeof(choice)<>'object' or choice-array['packageId','vehicleId','addonIds','locationId']<>'{}' or not(choice ?& array['packageId','vehicleId','addonIds']) or jsonb_typeof(choice->'packageId') is distinct from 'string' or jsonb_typeof(choice->'vehicleId') is distinct from 'string' or jsonb_typeof(choice->'addonIds') is distinct from 'array' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if jsonb_array_length(choice->'addonIds')>5 or exists(select 1 from jsonb_array_elements(choice->'addonIds') v where jsonb_typeof(v)<>'string') or (select count(distinct v) from jsonb_array_elements(choice->'addonIds') v)<>jsonb_array_length(choice->'addonIds') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select v into package from jsonb_array_elements(service#>'{questions,0,choices}') v where v->>'id'=choice->>'packageId';
 select v into vehicle from jsonb_array_elements(service#>'{questions,1,choices}') v where v->>'id'=choice->>'vehicleId';
 if package is null or vehicle is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if jsonb_array_length(service->'questions')=3 then
  if jsonb_typeof(choice->'locationId') is distinct from 'string' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  select v into location from jsonb_array_elements(service#>'{questions,2,choices}') v where v->>'id'=choice->>'locationId';if location is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 elsif choice ? 'locationId' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements_text(choice->'addonIds') v where not exists(select 1 from jsonb_array_elements(service->'addons') a where a->>'id'=v)) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 for addon in select v from jsonb_array_elements(service->'addons') v loop
  if choice->'addonIds' ? (addon->>'id') then
   addons:=addons||jsonb_build_array(addon->>'id');amount:=(addon->>'price')::numeric;subtotal:=subtotal+amount;
   lines:=lines||jsonb_build_array(jsonb_build_object('code','addon:'||(addon->>'id'),'label',addon->>'name','amount',jsonb_build_object('amount',amount,'currency',currency),'quantity',1));
  end if;
 end loop;
 amount:=(package->>'priceDelta')::numeric;subtotal:=subtotal+amount;
 if amount<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','question:package:'||(package->>'id'),'label','Detail package: '||(package->>'label'),'amount',jsonb_build_object('amount',amount,'currency',currency),'quantity',1));end if;
 if location is not null then
  amount:=(location->>'priceDelta')::numeric;subtotal:=subtotal+amount;
  if amount<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','question:location:'||(location->>'id'),'label','Service location: '||(location->>'label'),'amount',jsonb_build_object('amount',amount,'currency',currency),'quantity',1));end if;
 end if;
 if subtotal<0 or subtotal>9007199254740991 or subtotal*(vehicle->>'priceMultiplierBp')::numeric>9007199254740991 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 -- Match core Math.round of the IEEE double quotient, including fractional discount rates.
 scaled:=(subtotal*(vehicle->>'priceMultiplierBp')::numeric)::double precision/10000::double precision;
 next:=floor(scaled)::numeric+case when scaled-floor(scaled)>=0.5 then 1 else 0 end;delta:=next-subtotal;
 if delta<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','multiplier:vehicle:'||(vehicle->>'id'),'label','Vehicle type: '||(vehicle->>'label'),'amount',jsonb_build_object('amount',delta,'currency',currency),'quantity',1));end if;subtotal:=next;
 if subtotal<0 or subtotal>9007199254740991 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 pricing:=jsonb_build_object('lines',lines,'subtotal',jsonb_build_object('amount',subtotal,'currency',currency),'total',jsonb_build_object('amount',subtotal,'currency',currency),'tax',jsonb_build_object('amount',0,'currency',currency),'deposit',jsonb_build_object('amount',0,'currency',currency));
 answers:=jsonb_build_object('package',jsonb_build_object('choiceIds',jsonb_build_array(package->>'id')),'vehicle',jsonb_build_object('choiceIds',jsonb_build_array(vehicle->>'id')));
 choice:=jsonb_build_object('packageId',package->>'id','vehicleId',vehicle->>'id','addonIds',addons);
 if location is not null then choice:=choice||jsonb_build_object('locationId',location->>'id');answers:=answers||jsonb_build_object('location',jsonb_build_object('choiceIds',jsonb_build_array(location->>'id')));end if;
 selection:=jsonb_build_object('serviceId',service->>'id','itemQuantities','{}'::jsonb,'addonIds',addons,'answers',answers);
 if customer is null or jsonb_typeof(customer)<>'object' or customer-array['name','email']<>'{}' or not(customer ?& array['name','email']) or not lumin.detailing_text(customer->'name',200,false) or not lumin.detailing_text(customer->'email',254,false) or customer->>'email'<>btrim(customer->>'email') or length(customer->>'email') not between 3 and 254 or customer->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if start_at is null or not isfinite(start_at) or start_at<>date_trunc('milliseconds',start_at) then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 finish:=start_at+make_interval(mins=>(service->>'durationMinutes')::integer);
 return jsonb_build_object('payload',jsonb_build_object('selection',choice,'customer',customer,'requestedStart',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'selection',selection,'pricing',pricing,'slot',jsonb_build_object('start',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(finish at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
end$$;

create function public.detailing_reservation_context(hash text,origin text,approved jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- Acquire the existing planning prefix before session -> tenant -> service -> version locks.
 perform lumin.group_prefix(false);
 perform 1 from public.flow_sessions where token_hash=hash for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return public.resolve_detailing_flow_session(hash,origin,approved);
end$$;
create function public.detailing_reservation_target(hash text,origin text,approved jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions;r public.flow_requests;d public.detailing_request_receipts;b public.bookings;ctx jsonb;model jsonb;receipt jsonb;
begin
 perform lumin.group_prefix(false);
 select * into s from public.flow_sessions where token_hash=hash for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 ctx:=public.resolve_detailing_flow_session(hash,origin,approved);
 select * into r from public.flow_requests where tenant_id=s.tenant_id and session_id=s.id for share;if not found then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 select * into d from public.detailing_request_receipts where tenant_id=s.tenant_id and session_id=s.id and booking_id=r.booking_id for share;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 model:=lumin.detailing_request_model(ctx->'service',d.canonical_payload->'selection',d.canonical_payload->'customer',(d.canonical_payload->>'requestedStart')::timestamptz);
 if model->'payload' is distinct from d.canonical_payload or r.request_hash is distinct from encode(sha256(convert_to(d.canonical_payload::text,'UTF8')),'hex') or r.customer_answers is distinct from '{}'::jsonb or r.customer_payload is distinct from d.canonical_payload->'customer' then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into b from public.bookings where tenant_id=s.tenant_id and id=r.booking_id for update;
 if not found or b.state<>'draft' or b.payment_id is not null or exists(select 1 from public.payments where booking_id=b.id) or exists(select 1 from public.allocation_group_heads where booking_id=b.id) then raise exception 'NOT_AVAILABLE' using errcode='P0002';end if;
 if b.idempotency_key is distinct from 'flow-session:'||s.id::text or b.selection is distinct from model->'selection' or b.pricing is distinct from model->'pricing' or b.slot_start is distinct from (model#>>'{slot,start}')::timestamptz or b.slot_end is distinct from (model#>>'{slot,end}')::timestamptz or not exists(select 1 from public.customers c where c.id=b.customer_id and c.tenant_id=s.tenant_id and c.email=d.canonical_payload#>>'{customer,email}') then raise exception 'CONFLICT' using errcode='40001';end if;
 receipt:=jsonb_build_object('schemaVersion',1,'versionId',s.version_id,'installationId',s.installation_id,'serviceId',s.service_id,'bookingId',b.id,'reference',b.reference,'selection',d.canonical_payload->'selection','pricing',model->'pricing','slot',model->'slot','state','draft','confirmed',false,'paymentMode','unavailable');
 if receipt is distinct from d.accepted_receipt or s.expires_at<=clock_timestamp() then raise exception 'CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('context',ctx,'receipt',receipt);
end$$;

create function public.submit_detailing_reservation(hash text,origin text,approved jsonb,key text,choice jsonb,customer jsonb,start_at timestamptz,server_pricing jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.flow_sessions;ctx jsonb;model jsonb;old public.flow_requests;d public.detailing_request_receipts;bk record;receipt jsonb;
begin
 perform set_config('statement_timeout','5s',true);perform set_config('lock_timeout','3s',true);perform lumin.group_prefix(false);
 select * into s from public.flow_sessions where token_hash=hash for update;if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 ctx:=public.resolve_detailing_flow_session(hash,origin,approved);model:=lumin.detailing_request_model(ctx->'service',choice,customer,start_at);
 if key is null or length(key) not between 16 and 128 or key !~ '^[A-Za-z0-9_-]+$' or server_pricing is distinct from model->'pricing' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into old from public.flow_requests where session_id=s.id;
 if found then
  select * into d from public.detailing_request_receipts where tenant_id=s.tenant_id and session_id=s.id and booking_id=old.booking_id;
  if not found or old.idempotency_key is distinct from key or d.canonical_payload is distinct from model->'payload' then raise exception 'CONFLICT' using errcode='40001';end if;
  return jsonb_build_object('receipt',public.detailing_reservation_target(hash,origin,approved)->'receipt','replayed',true);
 end if;
 if exists(select 1 from public.bookings where tenant_id=s.tenant_id and idempotency_key='flow-session:'||s.id::text) then raise exception 'CONFLICT' using errcode='40001';end if;
 if start_at<=clock_timestamp() then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select * into bk from public.create_booking_draft(s.tenant_id,'flow-session:'||s.id::text,model->'selection',start_at,(model#>>'{slot,end}')::timestamptz,customer,null,null);
 update public.bookings set pricing=model->'pricing' where tenant_id=s.tenant_id and id=bk.booking_id and state='draft';if not found then raise exception 'CONFLICT' using errcode='40001';end if;
 receipt:=jsonb_build_object('schemaVersion',1,'versionId',s.version_id,'installationId',s.installation_id,'serviceId',s.service_id,'bookingId',bk.booking_id,'reference',bk.reference,'selection',model#>'{payload,selection}','pricing',model->'pricing','slot',model->'slot','state','draft','confirmed',false,'paymentMode','unavailable');
 insert into public.flow_requests(tenant_id,session_id,booking_id,idempotency_key,request_hash,customer_answers,customer_payload) values(s.tenant_id,s.id,bk.booking_id,key,encode(sha256(convert_to((model->'payload')::text,'UTF8')),'hex'),'{}',customer);
 insert into public.detailing_request_receipts values(s.tenant_id,s.id,bk.booking_id,model->'payload',receipt);
 perform public.outbox_enqueue(s.tenant_id,bk.booking_id,'booking.requested',s.id);
 perform public.detailing_reservation_target(hash,origin,approved);return jsonb_build_object('receipt',receipt,'replayed',false);
end$$;
revoke all on function lumin.detailing_request_model(jsonb,jsonb,jsonb,timestamptz),public.detailing_reservation_context(text,text,jsonb),public.detailing_reservation_target(text,text,jsonb),public.submit_detailing_reservation(text,text,jsonb,text,jsonb,jsonb,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.detailing_reservation_context(text,text,jsonb),public.detailing_reservation_target(text,text,jsonb),public.submit_detailing_reservation(text,text,jsonb,text,jsonb,jsonb,timestamptz,jsonb) to service_role;
commit;
