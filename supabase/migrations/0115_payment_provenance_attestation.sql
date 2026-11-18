-- Additive witness expansion through dormant provenance 0114, preserving all 0113 checks.
-- This bounded contract is NOT full historical-chain or provider verification.
-- Fingerprints describe this bounded catalog/body contract, NOT historical-chain
-- or provider verification. A later legitimate definition change must update it.
begin;
create or replace function lumin.payment_readiness_contract()
returns boolean language sql stable security definer set search_path = '' as $contract$
select coalesce(
 not exists (
  select 1 from (values
   ('lumin.guard_payment_review_writer()', '54e41597367506447d0ebd87bdb3610c',true,false,'trigger'),
   ('public.succeed_payment_webhook(uuid,bigint)','1ae87d6c2b45aad337ed0894bb22dc1a',true,true,'jsonb'),
   ('public.fail_payment_webhook(uuid)','75fe18b2ca362fb69822f5af0d621f2c',true,true,'jsonb'),
   ('public.park_payment_webhook(uuid,text,bigint)','df838528f3933ab3c19166b71131f0fd',true,true,'jsonb'),
   ('lumin.guard_payment_source_immutable()','564d3e7fa80bcff18182f7bab4a73689',false,false,'trigger'),
   ('public.register_payment_source_scope(uuid,text,boolean)','dc54b871d17c465aa7cfd7b441a21c27',true,true,'public.payment_source_scopes'),
   ('public.bind_booking_payment_source(uuid,uuid,uuid)','895361bce9f92b3e11eb9db477327e5c',true,true,'public.booking_payment_attempt_sources'),
   ('public.snapshot_payment_attempt_request(uuid,uuid,bigint,text)','15e9a78800b9b509c410d78de863ce69',true,true,'public.payment_attempt_requests'),
   ('public.associate_payment_attempt_intent(uuid,uuid,text,text,text,boolean,bigint,text)','2beb5b9f43b2c74df3ed21f9f84d13eb',true,true,'public.payment_attempt_intents'),
   ('public.read_payment_attempt_restart(uuid,uuid)','97f19c33ac0dd23e857ee192632479f9',true,true,'jsonb'),
   ('public.snapshot_payment_request_envelope(uuid,uuid,text)','84ba3a22321049b5db22a7b0a945418e',true,true,'public.payment_request_envelopes'),
   ('payment_internal.materialize_payment_request_envelope(uuid,uuid)','bea7b992e7cd40df605f3a4fe8d03f9d',true,true,'jsonb')
,
   ('payment_internal.record_quarantined_event(jsonb)','22dd7cec041ed8a4e8e2b8f8e5305812',true,true,'jsonb')
,
   ('public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text)','dcf6fe6ff4200f443b78aa5d5861272d',true,true,'jsonb')
,
   ('lumin.guard_payment_provenance()','36526198fb449727b32fb94fd1f425bd',true,false,'trigger'),
   ('payment_internal.record_scoped_payment_observation(uuid,text)','8973c59919b62a783dec8d2232923f0a',true,true,'jsonb'),
   ('payment_internal.resolve_quarantined_payment_receipt(uuid)','a235dc50c7f163b7e2f1d37474dba086',true,true,'jsonb')
  ) expected(signature,body_hash,definer,callable,result_type)
  left join pg_catalog.pg_proc p on p.oid=to_regprocedure(expected.signature)
  left join pg_catalog.pg_language l on l.oid=p.prolang
  where p.oid is null or md5(replace(p.prosrc,chr(13),'')) is distinct from body_hash
   or p.prosecdef is distinct from definer or p.prorettype is distinct from to_regtype(result_type)
   or l.lanname is distinct from 'plpgsql' or p.provolatile is distinct from case when expected.signature in ('public.read_payment_attempt_restart(uuid,uuid)','payment_internal.materialize_payment_request_envelope(uuid,uuid)','payment_internal.resolve_quarantined_payment_receipt(uuid)') then 's'::"char" else 'v'::"char" end
   or p.prokind<>'f' or p.proretset or p.proisstrict or p.proleakproof
   or pg_get_expr(p.proargdefaults,0) is distinct from
       case when expected.signature='public.bind_booking_payment_source(uuid,uuid,uuid)' then 'NULL::uuid' else null end
   or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE')
   or has_function_privilege('authenticated',p.oid,'EXECUTE')
   or has_function_privilege('service_role',p.oid,'EXECUTE') is distinct from callable
 )
 and not exists (
  select 1 from (values
   ('public.payment_reviews','8b562116a3e7adf936412067079410e0','b2fb849820e41b56c513c86673c4dd66',true,true),
   ('public.payment_source_scopes','96e48352c93b624ea052b3a504ab13d1','84624bd36f97fbeb9b4ccefa1bab27f2',false,true),
   ('public.booking_payment_attempt_sources','bce2ef71457770c4d35af77f30b47153','76853adecba0ee6c786470d8677ee97f',false,true),
   ('public.payment_attempt_requests','5db031fb03010cb550d4d845d4512b60','3d50be9625422227dd27d95eabc522ea',false,false),
   ('public.payment_attempt_intents','1d21391177c75b2ff03c4cadbe9a85bb','ae693d0d2ae8b537ce28aa53d8275f88',false,false),
   ('public.payment_request_envelopes','9b067f2c3c65dbc8badbb1831e596f32','e77717aaefb57e32ce2d768acae5c936',false,false)
,
   ('payment_internal.event_receipts','a4ab207363c984a7468011344a2dfeb4','743dde15cda69ca24fe33820c1dc9c46',false,false)
,
   ('payment_internal.event_receipt_conflicts','c6a44eb2d328f7bc9d8c16f4f157b4d9','69a5136618c862ae46f6db45b1f63179',false,false)
  ) expected(name,columns_hash,constraints_hash,review_writes,service_reads)
  left join pg_catalog.pg_class c on c.oid=to_regclass(expected.name)
  where c.oid is null or c.relkind<>'r' or not c.relrowsecurity or not c.relforcerowsecurity
   or exists(select 1 from pg_catalog.pg_policy where polrelid=c.oid)
   or (select md5(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum))
       from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) is distinct from columns_hash
   -- PG18 adds NOT NULL catalog constraints; attnotnull above covers these on
   -- all supported versions, so exclude their representation from this digest.
   -- Pin bytewise ordering: default linguistic collation reorders identical
   -- definitions and otherwise changes this fingerprint across databases.
   or (select md5(string_agg(pg_get_constraintdef(k.oid),',' order by pg_get_constraintdef(k.oid) collate "C"))
       from pg_catalog.pg_constraint k where k.conrelid=c.oid and k.contype<>'n') is distinct from constraints_hash
   or exists(select 1 from pg_catalog.pg_constraint k where k.conrelid=c.oid and not k.convalidated)
   or exists(select 1 from unnest(array['anon','authenticated']) r,
       unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v
       where has_table_privilege(r,c.oid,v))
   -- Table ACLs alone miss column-only grants. Check effective privileges
   -- (including inherited/PUBLIC grants) for every forbidden column verb.
   or exists(select 1 from unnest(array['anon','authenticated']) r,
       unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) v
       where has_any_column_privilege(r,c.oid,v))
   or has_any_column_privilege('service_role',c.oid,'REFERENCES')
   or (not review_writes and
       (has_any_column_privilege('service_role',c.oid,'INSERT')
        or has_any_column_privilege('service_role',c.oid,'UPDATE')))
   or has_table_privilege('service_role',c.oid,'SELECT') is distinct from service_reads
   or (not service_reads and has_any_column_privilege('service_role',c.oid,'SELECT'))
   or has_table_privilege('service_role',c.oid,'INSERT') is distinct from review_writes
   or has_table_privilege('service_role',c.oid,'UPDATE') is distinct from review_writes
   or has_table_privilege('service_role',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )
 and not exists (
  -- New ledgers also pin defaults/identity/generated expressions. This avoids
  -- an added default silently altering the immutable snapshot or observation.
  select 1 from (values
   ('public.payment_attempt_requests','152fed2d788febb7e7f46c1abe9a5c83'),
   ('public.payment_attempt_intents','e2f0e51df5caa2f76bddee84e53e2e73'),
   ('public.payment_request_envelopes','fe82cd4d92264ab165815f3efb915f92')
,
   ('payment_internal.event_receipts','c016cdbdc358a1b924cb26fc2bcdd137')
,
   ('payment_internal.event_receipt_conflicts','4af9cd5b24189d38189191d950549072')
  ) expected(name,defaults_hash)
  where (select md5(string_agg(a.attname||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'<none>')||':'||a.attidentity::text||':'||a.attgenerated::text,',' order by a.attnum))
   from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=to_regclass(expected.name) and a.attnum>0 and not a.attisdropped) is distinct from defaults_hash
 )
 and not exists (
  select 1 from (values
   ('public.payment_reviews','payment_review_writer_guard','lumin.guard_payment_review_writer()',31),
   ('public.payment_source_scopes','payment_source_scopes_immutable','lumin.guard_payment_source_immutable()',27),
   ('public.booking_payment_attempt_sources','booking_payment_attempt_sources_immutable','lumin.guard_payment_source_immutable()',27),
   ('public.payment_attempt_requests','payment_attempt_requests_immutable','lumin.guard_payment_source_immutable()',27),
   ('public.payment_attempt_intents','payment_attempt_intents_immutable','lumin.guard_payment_source_immutable()',27),
   ('public.payment_request_envelopes','payment_request_envelopes_immutable','lumin.guard_payment_source_immutable()',27)
,
   ('payment_internal.event_receipts','event_receipts_immutable','lumin.guard_payment_source_immutable()',27)
,
   ('payment_internal.event_receipt_conflicts','event_receipt_conflicts_immutable','lumin.guard_payment_source_immutable()',27)
,
   ('public.payments','payment_provenance_guard','lumin.guard_payment_provenance()',31)
  ) expected(relation,name,signature,event_bits)
  left join pg_catalog.pg_trigger t on t.tgrelid=to_regclass(relation) and t.tgname=name
  where t.oid is null or t.tgenabled<>'O' or t.tgfoid is distinct from to_regprocedure(signature)
   or t.tgtype<>event_bits or t.tgqual is not null or t.tgnargs<>0 or t.tgisinternal
 )
 and exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_index i on i.indexrelid=c.conindid where c.conrelid='public.payments'::regclass and c.contype='u' and c.convalidated and not c.condeferrable and i.indisunique and i.indisvalid and i.indisready and pg_get_constraintdef(c.oid)='UNIQUE (provider, provider_intent_id)')
 and exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_index i on i.indexrelid=c.conindid where c.conrelid='public.payments'::regclass and c.conname='payments_attempt_unique' and not c.condeferrable and i.indisunique and i.indisvalid and i.indisready)
 and (select md5(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum)) from pg_catalog.pg_attribute a where a.attrelid='public.payments'::regclass and a.attnum>0 and not a.attisdropped)='5f2b2eac3f4a51720519c39da560f1ad'
 and (select md5(string_agg(pg_get_constraintdef(k.oid),',' order by pg_get_constraintdef(k.oid) collate "C")) from pg_catalog.pg_constraint k where k.conrelid='public.payments'::regclass and k.contype<>'n')='badcd4f67ce631ea726a576e918d81ea'
 and not exists(select 1 from pg_catalog.pg_constraint k where k.conrelid='public.payments'::regclass and not k.convalidated)
 and not exists(select 1 from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.payments'::regclass and a.attname in ('source_scope_id','attempt_id') and (d.oid is not null or a.attidentity<>'' or a.attgenerated<>''))
 and exists(select 1 from pg_catalog.pg_namespace where nspname='payment_internal')
 and not has_schema_privilege('anon','payment_internal','USAGE,CREATE')
 and not has_schema_privilege('authenticated','payment_internal','USAGE,CREATE')
 and has_schema_privilege('service_role','payment_internal','USAGE')
 and not has_schema_privilege('service_role','payment_internal','CREATE'),false);
$contract$;
revoke all on function lumin.payment_readiness_contract() from public,anon,authenticated,service_role;
grant execute on function lumin.payment_readiness_contract() to service_role;

do $check$
begin
 if not lumin.payment_readiness_contract() then
  raise exception 'MIGRATION_ATTESTATION_PAYMENT_CONTRACT_MISMATCH';
 end if;
 if not exists(select 1 from public.booking_lumin_schema_attestation
   where id=true and migration_head='0113_legacy_payment_writer_attestation' and evidence='core_schema_contract') then
  raise exception 'MIGRATION_ATTESTATION_PREDECESSOR_MISMATCH';
 end if;
end $check$;
alter table public.booking_lumin_schema_attestation drop constraint booking_lumin_schema_attestation_migration_head_check;
update public.booking_lumin_schema_attestation
 set migration_head='0115_payment_provenance_attestation',applied_at=timezone('utc',now()) where id=true;
alter table public.booking_lumin_schema_attestation add constraint booking_lumin_schema_attestation_migration_head_check
 check(migration_head='0115_payment_provenance_attestation');
commit;
