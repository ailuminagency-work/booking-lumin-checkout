-- S2a only: additive immutable session provenance and draft request acceptance.
-- Raw secrets, HTTP, providers, capacity and payment activation are out of scope.
begin;
create function lumin.mode_session_time(p timestamptz) returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(isfinite(p) and p >= timestamptz '0001-01-01 00:00:00+00' and p < timestamptz '10000-01-01 00:00:00+00',false)
$$;
create function lumin.mode_session_stamp(p timestamptz) returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
 if not lumin.mode_session_time(p) then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 return to_char(p at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
end $$;
create function lumin.mode_session_protocol() returns void language plpgsql set search_path=pg_catalog as $$
declare n text; v interval;
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception 'MODE_SESSION_PROTOCOL' using errcode='55000';end if;
 foreach n in array array['statement_timeout','lock_timeout','idle_in_transaction_session_timeout'] loop
  v:=current_setting(n)::interval;
  if v < interval '1 millisecond' or v > (case when n='idle_in_transaction_session_timeout' then interval '1 second' else interval '5 seconds' end) then raise exception 'MODE_SESSION_PROTOCOL' using errcode='55000';end if;
 end loop;
end $$;
create function lumin.mode_session_limit(p jsonb,n integer) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
begin if p is null or octet_length(convert_to(p::text,'UTF8'))>n then raise exception 'MODE_SESSION_LIMIT' using errcode='54000';end if;return p;end $$;
create table public.mode_flow_sessions(
 id uuid primary key default gen_random_uuid(),token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 tenant_id uuid not null,flow_id uuid not null,installation_id uuid not null,version_id uuid not null,service_id uuid not null,
 mode text not null check(mode in('hosted','iframe')),profile_version text not null references lumin.installation_profiles(version),
 renderer_origin text not null check(lumin.mode_origin(renderer_origin)),parent_origin text,
 target_revision bigint not null check(target_revision between 1 and 9007199254740991),policy_revision bigint not null check(policy_revision between 1 and 9007199254740991),
 issued_history_sequence bigint not null check(issued_history_sequence between 1 and 9007199254740991),
 issued_at timestamptz not null check(lumin.mode_session_time(issued_at)),expires_at timestamptz not null check(lumin.mode_session_time(expires_at)),
 unique(tenant_id,id),foreign key(tenant_id,flow_id,installation_id) references public.mode_flow_installations(tenant_id,flow_id,id),
 foreign key(tenant_id,flow_id,version_id,service_id) references public.bound_flow_versions(tenant_id,flow_id,version_id,service_id),
 foreign key(tenant_id,installation_id,issued_history_sequence) references public.mode_flow_installation_history(tenant_id,installation_id,sequence),
 check(((mode='hosted' and parent_origin is null) or (mode='iframe' and parent_origin is not null and lumin.mode_origin(parent_origin))) is true),
 check(expires_at=issued_at+interval '15 minutes')
);
create index mode_session_installation on public.mode_flow_sessions(tenant_id,flow_id,installation_id);
create index mode_session_expiration on public.mode_flow_sessions(expires_at);
create function lumin.mode_session_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'MODE_SESSION_IMMUTABLE' using errcode='55000';end $$;
create trigger mode_session_immutable before update or delete on public.mode_flow_sessions for each row execute function lumin.mode_session_immutable();
create function lumin.mode_session_insert() returns trigger language plpgsql set search_path=pg_catalog as $$
declare i public.mode_flow_installations;h public.mode_flow_installation_history;p lumin.installation_profiles;
begin
 select * into i from public.mode_flow_installations where tenant_id=new.tenant_id and flow_id=new.flow_id and id=new.installation_id;
 select * into p from lumin.installation_profiles where version=new.profile_version;
 select * into h from public.mode_flow_installation_history where tenant_id=new.tenant_id and installation_id=new.installation_id order by sequence desc limit 1;
 if i.id is null or h.sequence is null or p.version is null or not i.enabled or
 row(new.mode,new.profile_version,new.version_id,new.target_revision,new.policy_revision,new.renderer_origin) is distinct from row(i.mode,i.profile_version,i.current_version_id,i.target_revision,i.policy_revision,p.renderer_origin) or
 row(new.flow_id,new.version_id,new.target_revision,new.policy_revision,new.issued_history_sequence) is distinct from row(h.flow_id,h.version_id,h.target_revision,h.policy_revision,h.sequence) or
 not h.enabled or h.allowed_parent_origins is distinct from i.allowed_parent_origins or
 not coalesce((new.mode='hosted' and new.parent_origin is null) or (new.mode='iframe' and i.allowed_parent_origins ? new.parent_origin and new.parent_origin not in(p.renderer_origin,p.api_origin,p.portal_origin)),false)
 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 return new;
end $$;
create trigger mode_session_insert before insert on public.mode_flow_sessions for each row execute function lumin.mode_session_insert();
create table public.mode_flow_requests(
 tenant_id uuid not null,session_id uuid primary key,booking_id uuid not null unique,
 idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),canonical_payload jsonb not null,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),accepted_receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp() check(lumin.mode_session_time(created_at)),unique(tenant_id,session_id),
 foreign key(tenant_id,session_id) references public.mode_flow_sessions(tenant_id,id),foreign key(tenant_id,booking_id) references public.bookings(tenant_id,id),
 check(jsonb_typeof(canonical_payload)='object' and octet_length(convert_to(canonical_payload::text,'UTF8'))<=32768),
 check(jsonb_typeof(accepted_receipt)='object' and octet_length(convert_to(accepted_receipt::text,'UTF8'))<=2048),
 check(request_hash=encode(sha256(convert_to(canonical_payload::text,'UTF8')),'hex'))
);
create index mode_request_booking on public.mode_flow_requests(tenant_id,booking_id);
create function lumin.mode_session_request_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'MODE_REQUEST_IMMUTABLE' using errcode='55000';end $$;
create trigger mode_request_immutable before update or delete on public.mode_flow_requests for each row execute function lumin.mode_session_request_immutable();
-- Source-first order shared with installation writers. Preliminary identifiers are not authorization.
create function lumin.mode_session_authority(t uuid,f uuid,iid uuid,r text,parent text) returns public.mode_flow_installations language plpgsql set search_path=pg_catalog as $$
declare i public.mode_flow_installations;p lumin.installation_profiles;
begin
 perform 1 from public.tenants where id=t and status='active' for share;if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.flows where tenant_id=t and id=f and status='active' for share;if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 select * into i from public.mode_flow_installations where tenant_id=t and flow_id=f and id=iid for share;
 select * into p from lumin.installation_profiles where version=i.profile_version;
 if i.id is null or not i.enabled or p.version is null or r is distinct from p.renderer_origin or not coalesce((i.mode='hosted' and parent is null) or (i.mode='iframe' and parent is not null and i.allowed_parent_origins ? parent and parent not in(p.renderer_origin,p.api_origin,p.portal_origin)),false) then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 return i;
end $$;
-- V1 preserves the accepted SQL publisher's character-count semantics, including
-- astral text and choice IDs which were never subject to V2 reserved-key rules.
create function lumin.mode_session_v1_catalog(p jsonb) returns void language plpgsql immutable set search_path=pg_catalog as $$
declare q jsonb;c jsonb;seen text[]:=array[]::text[];choices text[];n numeric;lo numeric;hi numeric;
begin
 perform lumin.mode_session_limit(p,131072);
 if not lumin.mode_keys(p,array['id','name','durationMinutes','questions']) or not lumin.mode_uuid(p->'id') or
 jsonb_typeof(p->'name') is distinct from 'string' or length(p->>'name') not between 1 and 200 or
 jsonb_typeof(p->'durationMinutes') is distinct from 'number' or jsonb_typeof(p->'questions') is distinct from 'array'
 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 n:=(p->>'durationMinutes')::numeric;
 if n<>trunc(n) or n not between 5 and 1440 or jsonb_array_length(p->'questions') not between 1 and 50 or octet_length(convert_to((p->'questions')::text,'UTF8'))>126000 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 for q in select value from jsonb_array_elements(p->'questions') loop
  if not lumin.mode_keys(q,case when q->>'kind'='quantity' then array['id','prompt','kind','required','choices','minQty','maxQty'] else array['id','prompt','kind','required','choices'] end) or
   jsonb_typeof(q->'id') is distinct from 'string' or length(q->>'id') not between 1 and 100 or q->>'id' in('__proto__','constructor','prototype') or (q->>'id')=any(seen) or
   jsonb_typeof(q->'prompt') is distinct from 'string' or length(q->>'prompt') not between 1 and 500 or jsonb_typeof(q->'required') is distinct from 'boolean' or
   jsonb_typeof(q->'kind') is distinct from 'string' or q->>'kind' not in('single_choice','multi_choice','quantity') or jsonb_typeof(q->'choices') is distinct from 'array'
  then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
  seen:=array_append(seen,q->>'id');choices:=array[]::text[];
  if jsonb_array_length(q->'choices')>50 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
  for c in select value from jsonb_array_elements(q->'choices') loop
   if not lumin.mode_keys(c,array['id','label']) or jsonb_typeof(c->'id') is distinct from 'string' or length(c->>'id') not between 1 and 100 or (c->>'id')=any(choices) or jsonb_typeof(c->'label') is distinct from 'string' or length(c->>'label') not between 1 and 200 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
   choices:=array_append(choices,c->>'id');
  end loop;
  if q->>'kind'='quantity' then
   if cardinality(choices)<>0 or jsonb_typeof(q->'minQty') is distinct from 'number' or jsonb_typeof(q->'maxQty') is distinct from 'number' then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
   lo:=(q->>'minQty')::numeric;hi:=(q->>'maxQty')::numeric;
   if lo<>trunc(lo) or hi<>trunc(hi) or lo not between 0 and 10000 or hi not between lo and 10000 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
  elsif cardinality(choices)=0 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 end loop;
end $$;
create function lumin.mode_session_render(t uuid,f uuid,v uuid) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare b public.bound_flow_versions;fv public.flow_versions;r jsonb;
begin
 select * into b from public.bound_flow_versions where tenant_id=t and flow_id=f and version_id=v;
 select * into fv from public.flow_versions where tenant_id=t and flow_id=f and id=v;
 if b.version_id is null or fv.id is null or b.service_snapshot->'id' is distinct from to_jsonb(b.service_id::text) then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 begin
  perform lumin.mode_session_limit(b.service_snapshot,131072);
  if fv.render_schema_version=1 then
   perform lumin.mode_session_v1_catalog(b.service_snapshot);perform lumin.bound_flow_config(fv.config,b.service_snapshot);
   r:=jsonb_build_object('versionId',v,'config',fv.config,'service',b.service_snapshot);
  elsif fv.render_schema_version=2 then
   perform lumin.v2_budget(fv.configurable_snapshot);
   if not lumin.mode_keys(fv.configurable_snapshot,array['renderSchemaVersion','config','service','submissionMode']) or fv.configurable_snapshot->'renderSchemaVersion' is distinct from '2'::jsonb or fv.configurable_snapshot->>'submissionMode' is distinct from 'unconfirmed_request' or
    (lumin.normalize_configurable_publication(fv.configurable_snapshot->'service',jsonb_build_object('authoringVersion',2,'config',fv.configurable_snapshot->'config','questionOverrides','{}'::jsonb))->'snapshot') is distinct from fv.configurable_snapshot then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
   if fv.configurable_snapshot->'service' is distinct from b.service_snapshot then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
   r:=fv.configurable_snapshot||jsonb_build_object('versionId',v);
  else raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 exception when sqlstate '22023' or sqlstate '0A000' then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end;
 return r;
end $$;
create function lumin.mode_session_customer(p jsonb) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare n text;e text;
begin
 if p is null then raise exception 'MODE_REQUEST_INVALID_CUSTOMER' using errcode='22023';end if;
 perform lumin.mode_session_limit(p,4096);
 if not lumin.mode_keys(p,array['name','email']) or jsonb_typeof(p->'name') is distinct from 'string' or jsonb_typeof(p->'email') is distinct from 'string' then raise exception 'MODE_REQUEST_INVALID_CUSTOMER' using errcode='22023';end if;
 n:=btrim(p->>'name');e:=btrim(p->>'email');
 if lumin.utf16_length(n) not between 1 and 200 or lumin.utf16_length(e) not between 3 and 254 or e !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'MODE_REQUEST_INVALID_CUSTOMER' using errcode='22023';end if;
 return jsonb_build_object('name',n,'email',e);
end $$;
create function lumin.mode_session_answers(p jsonb,r jsonb,schema integer) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare a jsonb;q jsonb;v jsonb;result jsonb:='{}';chosen jsonb;
begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'MODE_REQUEST_INVALID_ANSWERS' using errcode='22023';end if;
 perform lumin.mode_session_limit(p,16384);
 begin
  perform lumin.v2_budget(p);
  if schema=1 then if not lumin.flow_answers_valid(p,r->'service') then raise exception 'INVALID_ANSWER' using errcode='22023';end if;a:=p;
  else a:=lumin.validate_configurable_answers(r-'versionId',p);end if;
 exception when sqlstate '22023' then
  if sqlerrm in('INVALID_ANSWER','HIDDEN_ANSWER','MISSING_REQUIRED','CONFIG_BUDGET') then raise exception 'MODE_REQUEST_INVALID_ANSWERS' using errcode='22023';end if;
  raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';
 end;
 for q in select value from jsonb_array_elements(r->'service'->'questions') loop
  v:=a->(q->>'id');if v is null then continue;end if;
  if q->>'kind'='quantity' then v:=jsonb_build_object('quantity',(v->>'quantity')::numeric::bigint);
  else select jsonb_agg(c->'id' order by ord) into chosen from jsonb_array_elements(q->'choices') with ordinality as catalog(c,ord) where v->'choiceIds' @> jsonb_build_array(c->'id');v:=jsonb_build_object('choiceIds',chosen);end if;
  result:=result||jsonb_build_object(q->>'id',v);
 end loop;
 if schema=1 then if not lumin.flow_answers_valid(result,r->'service') then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 else perform lumin.validate_configurable_answers(r-'versionId',result);end if;
 return result;
end $$;
create function lumin.mode_session_payload(s public.mode_flow_sessions,r jsonb,a jsonb,c jsonb,start_at timestamptz) returns jsonb language plpgsql set search_path=pg_catalog as $$
declare schema integer;finish_at timestamptz;
begin
 if not lumin.mode_session_time(start_at) then raise exception 'MODE_REQUEST_INVALID_TIME' using errcode='22023';end if;
 finish_at:=start_at+make_interval(mins=>(r->'service'->>'durationMinutes')::integer);
 if not lumin.mode_session_time(finish_at) or finish_at<=start_at then raise exception 'MODE_REQUEST_INVALID_TIME' using errcode='22023';end if;
 select render_schema_version into schema from public.flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and id=s.version_id;
 return lumin.mode_session_limit(jsonb_build_object('schemaVersion',1,'domain','mode-flow-request/v1','tenantId',s.tenant_id,'flowId',s.flow_id,'sessionId',s.id,'installationId',s.installation_id,'versionId',s.version_id,'serviceId',s.service_id,'renderSchemaVersion',schema,'mode',s.mode,'deploymentProfileVersion',s.profile_version,'targetRevision',s.target_revision,'policyRevision',s.policy_revision,'rendererOrigin',s.renderer_origin,'parentOrigin',s.parent_origin,'answers',lumin.mode_session_answers(a,r,schema),'customer',lumin.mode_session_customer(c),'requestedEpochMicros',(extract(epoch from start_at)*1000000)::bigint::text),32768);
end $$;
create function lumin.mode_session_request_insert() returns trigger language plpgsql set search_path=pg_catalog as $$
declare s public.mode_flow_sessions;b public.bookings;c public.customers;r jsonb;p jsonb;
begin
 select * into s from public.mode_flow_sessions where tenant_id=new.tenant_id and id=new.session_id;
 select * into b from public.bookings where tenant_id=new.tenant_id and id=new.booking_id;
 select * into c from public.customers where tenant_id=new.tenant_id and id=b.customer_id;
 if s.id is null or b.id is null or c.id is null then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 r:=lumin.mode_session_render(s.tenant_id,s.flow_id,s.version_id);
 p:=lumin.mode_session_payload(s,r,new.canonical_payload->'answers',new.canonical_payload->'customer',b.slot_start);
 if p is distinct from new.canonical_payload or new.request_hash is distinct from encode(sha256(convert_to(p::text,'UTF8')),'hex') or
 new.accepted_receipt is distinct from jsonb_build_object('schemaVersion',1,'reference',b.reference,'initialState','draft','requestAccepted',true) or
 b.reference is distinct from 'LMN-'||upper(replace(b.id::text,'-','')) or b.state<>'draft' or b.pricing<>'{}' or b.payment_id is not null or
 b.selection is distinct from jsonb_build_object('serviceId',s.service_id,'answers',p->'answers') or c.email is distinct from p->'customer'->>'email' or
 b.slot_end is distinct from b.slot_start+make_interval(mins=>(r->'service'->>'durationMinutes')::integer) or b.idempotency_key is distinct from 'mode-flow-session:v1:'||s.id::text or
 exists(select 1 from public.flow_requests where booking_id=b.id) then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 return new;
end $$;
create trigger mode_request_insert before insert on public.mode_flow_requests for each row execute function lumin.mode_session_request_insert();
create function public.mode_issue_flow_session(p_installation uuid,p_token_hash text,p_renderer_origin text,p_parent_origin text,p_profile_version text,p_expected_version uuid,p_expected_target_revision bigint,p_expected_policy_revision bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i public.mode_flow_installations;s public.mode_flow_sessions;b public.bound_flow_versions;r jsonb;stamp timestamptz;seq bigint;
begin
 perform lumin.mode_session_protocol();
 if p_installation is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_profile_version is null or p_profile_version !~ '^[a-z][a-z0-9-]{0,63}$' or p_expected_version is null or p_expected_target_revision is null or p_expected_target_revision not between 1 and 9007199254740991 or p_expected_policy_revision is null or p_expected_policy_revision not between 1 and 9007199254740991 then raise exception 'MODE_SESSION_INVALID' using errcode='22023';end if;
 if not lumin.mode_origin(p_renderer_origin) or (p_parent_origin is not null and not lumin.mode_origin(p_parent_origin)) then raise exception 'MODE_SESSION_INVALID_ORIGIN' using errcode='22023';end if;
 select * into i from public.mode_flow_installations where id=p_installation;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 i:=lumin.mode_session_authority(i.tenant_id,i.flow_id,i.id,p_renderer_origin,p_parent_origin);
 if i.profile_version<>p_profile_version or i.policy_revision<>p_expected_policy_revision then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 -- Rediscover after authority locks: an earlier absent observation cannot select a new target.
 select * into s from public.mode_flow_sessions where token_hash=p_token_hash;
 if s.id is not null and s.installation_id<>i.id then raise exception 'MODE_SESSION_CONFLICT' using errcode='40001';end if;
 if s.id is null then
  if i.current_version_id<>p_expected_version or i.target_revision<>p_expected_target_revision then raise exception 'MODE_SESSION_CONFLICT' using errcode='40001';end if;
  select * into b from public.bound_flow_versions where tenant_id=i.tenant_id and flow_id=i.flow_id and version_id=i.current_version_id;
 else select * into b from public.bound_flow_versions where tenant_id=s.tenant_id and flow_id=s.flow_id and version_id=s.version_id;end if;
 perform 1 from public.services where tenant_id=i.tenant_id and id=b.service_id and active for share;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 if s.id is null then
  select max(sequence) into seq from public.mode_flow_installation_history where tenant_id=i.tenant_id and installation_id=i.id;
  stamp:=clock_timestamp();
  if not lumin.mode_session_time(stamp+interval '15 minutes') then raise exception 'MODE_SESSION_LIMIT' using errcode='54000';end if;
  insert into public.mode_flow_sessions(token_hash,tenant_id,flow_id,installation_id,version_id,service_id,mode,profile_version,renderer_origin,parent_origin,target_revision,policy_revision,issued_history_sequence,issued_at,expires_at)
  values(p_token_hash,i.tenant_id,i.flow_id,i.id,i.current_version_id,b.service_id,i.mode,i.profile_version,p_renderer_origin,p_parent_origin,i.target_revision,i.policy_revision,seq,stamp,stamp+interval '15 minutes') on conflict(token_hash) do nothing;
 end if;
 -- Only matching installation sessions may be locked. A hash collision must not cross source locks.
 select * into s from public.mode_flow_sessions where token_hash=p_token_hash and installation_id=i.id for update;
 if s.id is null or row(s.version_id,s.target_revision,s.profile_version,s.renderer_origin,s.parent_origin) is distinct from row(p_expected_version,p_expected_target_revision,p_profile_version,p_renderer_origin,p_parent_origin) then raise exception 'MODE_SESSION_CONFLICT' using errcode='40001';end if;
 if s.policy_revision<>i.policy_revision or s.mode<>i.mode or s.expires_at<=clock_timestamp() then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 r:=lumin.mode_session_limit(jsonb_build_object('schemaVersion',1,'sessionId',s.id,'installationId',s.installation_id,'mode',s.mode,'deploymentProfileVersion',s.profile_version,'rendererOrigin',s.renderer_origin,'parentOrigin',s.parent_origin,'versionId',s.version_id,'targetRevision',s.target_revision,'policyRevision',s.policy_revision,'issuedAt',lumin.mode_session_stamp(s.issued_at),'expiresAt',lumin.mode_session_stamp(s.expires_at),'render',lumin.mode_session_render(s.tenant_id,s.flow_id,s.version_id)),1048576);
 if s.expires_at<=clock_timestamp() then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 return r;
end $$;
create function lumin.mode_session_afterstate(s public.mode_flow_sessions,bid uuid) returns void language plpgsql set search_path=pg_catalog as $$
declare req public.mode_flow_requests;b public.bookings;c public.customers;r jsonb;p jsonb;
begin
 select * into req from public.mode_flow_requests where tenant_id=s.tenant_id and session_id=s.id;
 select * into b from public.bookings where tenant_id=s.tenant_id and id=bid;
 select * into c from public.customers where tenant_id=s.tenant_id and id=b.customer_id;
 r:=lumin.mode_session_render(s.tenant_id,s.flow_id,s.version_id);
 p:=lumin.mode_session_payload(s,r,req.canonical_payload->'answers',req.canonical_payload->'customer',b.slot_start);
 if b.id is null or c.id is null or p is distinct from req.canonical_payload or req.request_hash is distinct from encode(sha256(convert_to(p::text,'UTF8')),'hex') or
 req.accepted_receipt is distinct from jsonb_build_object('schemaVersion',1,'reference',b.reference,'initialState','draft','requestAccepted',true) or
 b.reference is distinct from 'LMN-'||upper(replace(b.id::text,'-','')) or b.pricing is distinct from '{}'::jsonb or b.payment_id is not null or
 b.selection is distinct from jsonb_build_object('serviceId',s.service_id,'answers',p->'answers') or c.email is distinct from p->'customer'->>'email' or
 b.slot_end is distinct from b.slot_start+make_interval(mins=>(r->'service'->>'durationMinutes')::integer) or b.idempotency_key is distinct from 'mode-flow-session:v1:'||s.id::text or
 b.address is not null or b.notes is not null or exists(select 1 from public.flow_requests where booking_id=b.id)
 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;

 if req.booking_id is distinct from bid or b.state is distinct from 'draft' or
 (select count(*) from public.booking_state_history where booking_id=bid)<>1 or
 not exists(select 1 from public.booking_state_history where booking_id=bid and from_state is null and to_state='draft') or
 (select count(*) from public.durable_outbox where tenant_id=s.tenant_id and booking_id=bid)<>1 or
 not exists(select 1 from public.durable_outbox where tenant_id=s.tenant_id and booking_id=bid and event_type='booking.requested' and dedup_key=s.id and payload='{}' and state='ready' and attempts=0 and max_attempts=5 and generation=0 and lease_token is null and lease_until is null and completed_at is null and last_failure is null)
 then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
end $$;
create function public.mode_submit_flow_request(p_token_hash text,p_renderer_origin text,p_parent_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.mode_flow_sessions;i public.mode_flow_installations;req public.mode_flow_requests;b public.bookings;r jsonb;p jsonb;h text;cid uuid;inserted_customer uuid;bid uuid;ref text;answer jsonb;customer jsonb;replayed boolean:=false;
begin
 perform lumin.mode_session_protocol();
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'MODE_SESSION_INVALID' using errcode='22023';end if;
 if not lumin.mode_origin(p_renderer_origin) or (p_parent_origin is not null and not lumin.mode_origin(p_parent_origin)) then raise exception 'MODE_SESSION_INVALID_ORIGIN' using errcode='22023';end if;
 select * into s from public.mode_flow_sessions where token_hash=p_token_hash;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 i:=lumin.mode_session_authority(s.tenant_id,s.flow_id,s.installation_id,p_renderer_origin,p_parent_origin);
 if row(s.mode,s.profile_version,s.policy_revision,s.renderer_origin,s.parent_origin) is distinct from row(i.mode,i.profile_version,i.policy_revision,p_renderer_origin,p_parent_origin) then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.services where tenant_id=s.tenant_id and id=s.service_id and active for share;
 if not found then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 select * into s from public.mode_flow_sessions where token_hash=p_token_hash for update;
 if s.expires_at<=clock_timestamp() then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 r:=lumin.mode_session_render(s.tenant_id,s.flow_id,s.version_id);
 p:=lumin.mode_session_payload(s,r,p_answers,p_customer,p_requested_start);h:=encode(sha256(convert_to(p::text,'UTF8')),'hex');
 if s.expires_at<=clock_timestamp() then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 select * into req from public.mode_flow_requests where tenant_id=s.tenant_id and session_id=s.id;
 if found then
  if req.idempotency_key<>p_idempotency_key or req.request_hash<>h or req.canonical_payload<>p then raise exception 'MODE_REQUEST_CONFLICT' using errcode='40001';end if;
  select * into b from public.bookings where tenant_id=s.tenant_id and id=req.booking_id for share;
  if not found or req.accepted_receipt is distinct from jsonb_build_object('schemaVersion',1,'reference',b.reference,'initialState','draft','requestAccepted',true) then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
  replayed:=true;
 else
  if p_requested_start<=clock_timestamp() then raise exception 'MODE_REQUEST_INVALID_TIME' using errcode='22023';end if;
  customer:=p->'customer';answer:=p->'answers';
  insert into public.customers(tenant_id,name,email) values(s.tenant_id,customer->>'name',customer->>'email') on conflict(tenant_id,email) do nothing returning id into inserted_customer;
  select id into cid from public.customers where tenant_id=s.tenant_id and email=customer->>'email' for key share;
  if not found then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
  if s.expires_at<=clock_timestamp() then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
  if p_requested_start<=clock_timestamp() then raise exception 'MODE_REQUEST_INVALID_TIME' using errcode='22023';end if;
  bid:=gen_random_uuid();ref:='LMN-'||upper(replace(bid::text,'-',''));
  insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key)
  values(bid,s.tenant_id,ref,'draft',jsonb_build_object('serviceId',s.service_id,'answers',answer),'{}',p_requested_start,p_requested_start+make_interval(mins=>(r->'service'->>'durationMinutes')::integer),cid,'mode-flow-session:v1:'||s.id::text) returning * into b;
  insert into public.mode_flow_requests(tenant_id,session_id,booking_id,idempotency_key,canonical_payload,request_hash,accepted_receipt)
  values(s.tenant_id,s.id,bid,p_idempotency_key,p,h,jsonb_build_object('schemaVersion',1,'reference',ref,'initialState','draft','requestAccepted',true));
  perform public.outbox_enqueue(s.tenant_id,bid,'booking.requested',s.id,'{}',5);
  perform lumin.mode_session_afterstate(s,bid);
  if inserted_customer is not null and (inserted_customer is distinct from cid or not exists(select 1 from public.customers where tenant_id=s.tenant_id and id=inserted_customer and email=customer->>'email' and name=customer->>'name')) then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
 end if;
 if s.expires_at<=clock_timestamp() then raise exception 'MODE_SESSION_FORBIDDEN' using errcode='42501';end if;
 if not replayed and p_requested_start<=clock_timestamp() then raise exception 'MODE_REQUEST_INVALID_TIME' using errcode='22023';end if;
 return lumin.mode_session_limit(jsonb_build_object('schemaVersion',1,'reference',b.reference,'initialState','draft','state',b.state,'requestAccepted',true,'replayed',replayed),2048);
end $$;
create function public.mode_owner_request_history(p_actor uuid,p_tenant uuid,p_flow uuid,p_before_created_at timestamptz,p_before_booking_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b record;rows jsonb:='[]';cursor jsonb:=null;n integer:=0;last_at timestamptz;last_id uuid;
begin
 perform lumin.mode_session_protocol();
 if p_actor is null or p_tenant is null or p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null)<>(p_before_booking_id is null) or (p_before_created_at is not null and not lumin.mode_session_time(p_before_created_at)) then raise exception 'MODE_SESSION_INVALID' using errcode='22023';end if;
 perform lumin.flow_actor(p_actor,p_tenant,true);
 if p_flow is not null then perform 1 from public.flows where tenant_id=p_tenant and id=p_flow for share;if not found then raise exception 'MODE_REQUEST_NOT_FOUND' using errcode='P0002';end if;end if;
 for b in select bk.id,bk.reference,bk.state,bk.slot_start,bk.created_at from public.bookings bk
 where bk.tenant_id=p_tenant and (p_before_created_at is null or (bk.created_at,bk.id)<(p_before_created_at,p_before_booking_id)) and
 (exists(select 1 from public.flow_requests q join public.flow_sessions s on (s.tenant_id,s.id)=(q.tenant_id,q.session_id) where q.tenant_id=bk.tenant_id and q.booking_id=bk.id and (p_flow is null or s.flow_id=p_flow)) or
 exists(select 1 from public.mode_flow_requests q join public.mode_flow_sessions s on (s.tenant_id,s.id)=(q.tenant_id,q.session_id) where q.tenant_id=bk.tenant_id and q.booking_id=bk.id and (p_flow is null or s.flow_id=p_flow)))
 order by bk.created_at desc,bk.id desc limit p_limit+1 loop
  if lumin.utf16_length(b.reference) not between 6 and 128 or not lumin.mode_session_time(b.slot_start) or not lumin.mode_session_time(b.created_at) then raise exception 'MODE_REQUEST_CORRUPT' using errcode='55000';end if;
  n:=n+1;
  if n>p_limit then cursor:=jsonb_build_object('createdAt',lumin.mode_session_stamp(last_at),'bookingId',last_id);
  else rows:=rows||jsonb_build_array(jsonb_build_object('bookingId',b.id,'reference',b.reference,'state',b.state,'slotStart',lumin.mode_session_stamp(b.slot_start),'createdAt',lumin.mode_session_stamp(b.created_at)));last_at:=b.created_at;last_id:=b.id;end if;
 end loop;
 return lumin.mode_session_limit(jsonb_build_object('schemaVersion',1,'requests',rows,'nextCursor',cursor),1048576);
end $$;
alter table public.mode_flow_sessions enable row level security;
alter table public.mode_flow_sessions force row level security;
alter table public.mode_flow_requests enable row level security;
alter table public.mode_flow_requests force row level security;
revoke all on public.mode_flow_sessions,public.mode_flow_requests from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lumin' and p.proname like 'mode_session\_%' escape '\' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function public.mode_issue_flow_session(uuid,text,text,text,text,uuid,bigint,bigint),public.mode_submit_flow_request(text,text,text,text,jsonb,jsonb,timestamptz),public.mode_owner_request_history(uuid,uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.mode_issue_flow_session(uuid,text,text,text,text,uuid,bigint,bigint),public.mode_submit_flow_request(text,text,text,text,jsonb,jsonb,timestamptz),public.mode_owner_request_history(uuid,uuid,uuid,timestamptz,uuid,integer) to service_role;
commit;
