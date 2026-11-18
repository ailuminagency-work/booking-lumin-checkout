-- Additive witness advancement for reviewed 0101/0102. Dormant source stays dormant.
-- Fingerprints describe this bounded catalog/body contract, NOT historical-chain
-- or provider verification. A later legitimate definition change must update it.
begin;
create function lumin.payment_readiness_contract()
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
   ('public.bind_booking_payment_source(uuid,uuid,uuid)','895361bce9f92b3e11eb9db477327e5c',true,true,'public.booking_payment_attempt_sources')
  ) expected(signature,body_hash,definer,callable,result_type)
  left join pg_catalog.pg_proc p on p.oid=to_regprocedure(expected.signature)
  left join pg_catalog.pg_language l on l.oid=p.prolang
  where p.oid is null or md5(replace(p.prosrc,chr(13),'')) is distinct from body_hash
   or p.prosecdef is distinct from definer or p.prorettype is distinct from to_regtype(result_type)
   or l.lanname is distinct from 'plpgsql' or p.provolatile is distinct from 'v'
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
   ('public.payment_reviews','8b562116a3e7adf936412067079410e0','b2fb849820e41b56c513c86673c4dd66',true),
   ('public.payment_source_scopes','96e48352c93b624ea052b3a504ab13d1','84624bd36f97fbeb9b4ccefa1bab27f2',false),
   ('public.booking_payment_attempt_sources','bce2ef71457770c4d35af77f30b47153','76853adecba0ee6c786470d8677ee97f',false)
  ) expected(name,columns_hash,constraints_hash,review_writes)
  left join pg_catalog.pg_class c on c.oid=to_regclass(expected.name)
  where c.oid is null or c.relkind<>'r' or not c.relrowsecurity or not c.relforcerowsecurity
   or exists(select 1 from pg_catalog.pg_policy where polrelid=c.oid)
   or (select md5(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum))
       from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) is distinct from columns_hash
   -- PG18 adds NOT NULL catalog constraints; attnotnull above covers these on
   -- all supported versions, so exclude their representation from this digest.
   or (select md5(string_agg(pg_get_constraintdef(k.oid),',' order by pg_get_constraintdef(k.oid)))
       from pg_catalog.pg_constraint k where k.conrelid=c.oid and k.contype<>'n') is distinct from constraints_hash
   or exists(select 1 from pg_catalog.pg_constraint k where k.conrelid=c.oid and not k.convalidated)
   or exists(select 1 from unnest(array['anon','authenticated']) r,
       unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v
       where has_table_privilege(r,c.oid,v))
   or not has_table_privilege('service_role',c.oid,'SELECT')
   or has_table_privilege('service_role',c.oid,'INSERT') is distinct from review_writes
   or has_table_privilege('service_role',c.oid,'UPDATE') is distinct from review_writes
   or has_table_privilege('service_role',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )
 and not exists (
  select 1 from (values
   ('public.payment_reviews','payment_review_writer_guard','lumin.guard_payment_review_writer()',31),
   ('public.payment_source_scopes','payment_source_scopes_immutable','lumin.guard_payment_source_immutable()',27),
   ('public.booking_payment_attempt_sources','booking_payment_attempt_sources_immutable','lumin.guard_payment_source_immutable()',27)
  ) expected(relation,name,signature,event_bits)
  left join pg_catalog.pg_trigger t on t.tgrelid=to_regclass(relation) and t.tgname=name
  where t.oid is null or t.tgenabled<>'O' or t.tgfoid is distinct from to_regprocedure(signature)
   or t.tgtype<>event_bits or t.tgqual is not null or t.tgnargs<>0 or t.tgisinternal
 ),false);
$contract$;
revoke all on function lumin.payment_readiness_contract() from public,anon,authenticated,service_role;
grant execute on function lumin.payment_readiness_contract() to service_role;

do $check$
begin
 if not lumin.payment_readiness_contract() then
  raise exception 'MIGRATION_ATTESTATION_PAYMENT_CONTRACT_MISMATCH';
 end if;
 if not exists(select 1 from public.booking_lumin_schema_attestation
   where id=true and migration_head='0100_security_advisor_hardening' and evidence='core_schema_contract') then
  raise exception 'MIGRATION_ATTESTATION_PREDECESSOR_MISMATCH';
 end if;
end $check$;
alter table public.booking_lumin_schema_attestation drop constraint booking_lumin_schema_attestation_migration_head_check;
update public.booking_lumin_schema_attestation
 set migration_head='0103_payment_readiness_attestation',applied_at=timezone('utc',now()) where id=true;
alter table public.booking_lumin_schema_attestation add constraint booking_lumin_schema_attestation_migration_head_check
 check(migration_head='0103_payment_readiness_attestation');
commit;
