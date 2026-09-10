-- Bind only the two accepted random-token kernels to a vetted pgcrypto member.
-- Historical migrations remain immutable; no shim, grant or extension relocation.
begin;
do $binding$
declare
 trusted oid; ext pg_catalog.pg_extension%rowtype; random_fn pg_catalog.pg_proc%rowtype;
 ns text; target pg_catalog.pg_proc%rowtype; after_fn pg_catalog.pg_proc%rowtype;
 signatures text[]:=array['lumin.reserve_capacity_nonplanning(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)','lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer)'];
 hashes text[]:=array['e4f5a85efe087bd9988bf8f54ff6fb49007f4b026d14bed27d0786183228e232','b4b09f7d27dc9f718606bdc70d37cf3aa3f131b7cc224201bf64c62c96f796f8'];
 snapshots jsonb[]; definitions text[]; bodies text[]; ids oid[]; i integer; source text; replacement text; expected text;
begin
 select oid into trusted from pg_catalog.pg_roles where rolname='postgres';
 select * into ext from pg_catalog.pg_extension where extname='pgcrypto';
 select nspname into ns from pg_catalog.pg_namespace where oid=ext.extnamespace;
 if trusted is null or ext.oid is null or ext.extowner<>trusted or ns not in('public','extensions') then
  raise exception 'CRYPTO_BINDING_UNSUPPORTED' using errcode='55000';
 end if;
 select p.* into random_fn from pg_catalog.pg_proc p
 where p.pronamespace=ext.extnamespace and p.proname='gen_random_bytes'
 and p.proargtypes='23'::pg_catalog.oidvector;
 if random_fn.oid is null or random_fn.proowner<>trusted or random_fn.prokind<>'f'
 or random_fn.prorettype<>'pg_catalog.bytea'::pg_catalog.regtype or random_fn.proretset
 or random_fn.provariadic<>0 or random_fn.pronargs<>1 or random_fn.pronargdefaults<>0
 or random_fn.proallargtypes is not null or random_fn.proargmodes is not null
 or random_fn.proargdefaults is not null or random_fn.proconfig is not null
 or random_fn.prosecdef or random_fn.proleakproof or not random_fn.proisstrict
 or random_fn.provolatile<>'v' or random_fn.proparallel<>'s' or random_fn.procost<>1 or random_fn.prorows<>0
 or random_fn.proargnames is not null or random_fn.prosupport<>0 or random_fn.protrftypes is not null or random_fn.prosqlbody is not null
 or random_fn.prolang<>(select oid from pg_catalog.pg_language where lanname='c')
 or random_fn.prosrc<>'pg_random_bytes' or random_fn.probin is distinct from '$libdir/pgcrypto'
 or not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.objid=random_fn.oid and d.objsubid=0 and d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass and d.refobjid=ext.oid and d.deptype='e') then
  raise exception 'CRYPTO_BINDING_UNSUPPORTED' using errcode='55000';
 end if;
 -- Inspect every target before changing either. Full body comparison normalizes
 -- CRLF to LF only (git Windows/Linux checkout); no other whitespace is ignored.
 for i in 1..2 loop
  select * into target from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(signatures[i]);
  if target.oid is null or target.proowner<>trusted or target.prokind<>'f'
   or target.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
   or not target.prosecdef or target.proisstrict or target.proleakproof or not target.proretset
   or target.prorettype<>'pg_catalog.record'::pg_catalog.regtype or target.provolatile<>'v' or target.proparallel<>'u'
   or target.provariadic<>0 or target.pronargdefaults<>0 or target.pronargs<>7
   or target.prosupport<>0 or target.proargdefaults is not null or target.protrftypes is not null
   or target.proallargtypes is distinct from (case when i=1 then array[2950,2950,1184,1184,2950,23,1186,25,2950,25,1184]::oid[] else array[2950,2950,1184,1184,2950,1186,23,25,2950,25,1184]::oid[] end)
   or target.proargnames is distinct from (case when i=1 then array['p_tenant_id','p_service_id','p_slot_start','p_slot_end','p_booking_id','p_capacity','p_ttl','result','hold_id','hold_status','hold_expires_at']::text[] else array['p_tenant_id','p_resource_id','p_slot_start','p_slot_end','p_booking_id','p_ttl','p_quantity','result','reservation_id','reservation_status','reservation_expires_at']::text[] end)
   or target.procost<>100 or target.prorows<>1000 or target.probin is not null or target.prosqlbody is not null
   or target.proconfig is distinct from array['search_path=""']::text[]
   or target.proargmodes is distinct from array['i','i','i','i','i','i','i','t','t','t','t']::"char"[]
   or (select count(*) from pg_catalog.pg_proc p where p.pronamespace=target.pronamespace and p.proname=target.proname)<>1 then
   raise exception 'CRYPTO_BINDING_TARGET_DRIFT' using errcode='55000';
  end if;
  source:=pg_catalog.replace(target.prosrc,pg_catalog.chr(13)||pg_catalog.chr(10),pg_catalog.chr(10));
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')<>hashes[i]
   or (pg_catalog.length(source)-pg_catalog.length(pg_catalog.replace(source,'public.gen_random_bytes(16)','')))/pg_catalog.length('public.gen_random_bytes(16)')<>2 then
   raise exception 'CRYPTO_BINDING_TARGET_DRIFT' using errcode='55000';
  end if;
  snapshots[i]:=pg_catalog.to_jsonb(target);definitions[i]:=pg_catalog.pg_get_functiondef(target.oid);bodies[i]:=target.prosrc;ids[i]:=target.oid;
 end loop;
 replacement:=pg_catalog.format('%I.gen_random_bytes(16)',ns);
 for i in 1..2 loop
  if ns<>'public' then execute pg_catalog.replace(definitions[i],'public.gen_random_bytes(16)',replacement);end if;
 end loop;
 -- Validate the entire final state after every DDL/event trigger has completed.
 for i in 1..2 loop
  expected:=pg_catalog.replace(bodies[i],'public.gen_random_bytes(16)',replacement);
  select * into after_fn from pg_catalog.pg_proc where oid=ids[i];
  if after_fn.oid is null or (pg_catalog.to_jsonb(after_fn)-'prosrc') is distinct from(snapshots[i]-'prosrc')
   or after_fn.prosrc is distinct from expected
   or pg_catalog.pg_get_functiondef(ids[i]) is distinct from pg_catalog.replace(definitions[i],'public.gen_random_bytes(16)',replacement) then
   raise exception 'CRYPTO_BINDING_POSTCONDITION' using errcode='55000';
  end if;
 end loop;
 if (select nspname from pg_catalog.pg_namespace where oid=ext.extnamespace) is distinct from ns
  or (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=random_fn.oid) is distinct from pg_catalog.to_jsonb(random_fn)
  or (select pg_catalog.to_jsonb(e) from pg_catalog.pg_extension e where e.oid=ext.oid) is distinct from pg_catalog.to_jsonb(ext)
  or not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.objid=random_fn.oid and d.objsubid=0 and d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass and d.refobjid=ext.oid and d.deptype='e') then
  raise exception 'CRYPTO_BINDING_POSTCONDITION' using errcode='55000';
 end if;
end;
$binding$;
commit;