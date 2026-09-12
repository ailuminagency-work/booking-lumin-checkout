-- Structural financial exclusion for every permanent planning-group head.
-- No allocation, financial handoff, role grants or accepted function replacement.
begin;
do $$begin perform lumin.group_rc();end$$;
lock table public.allocation_policies in share mode;
lock table public.allocation_group_heads in access exclusive mode;
lock table public.bookings,public.payments,public.refunds in access exclusive mode;
do $$begin
 if exists(select 1 from public.allocation_group_heads h join public.bookings b on b.id=h.booking_id where b.payment_id is not null
  or exists(select 1 from public.payments p where p.booking_id=b.id)
  or exists(select 1 from public.refunds r where r.booking_id=b.id or exists(select 1 from public.payments p where p.id=r.payment_id and p.booking_id=b.id))) then
  raise exception 'GROUP_FINANCIAL_PREFLIGHT' using errcode='55000';
 end if;
 if exists(select 1 from pg_catalog.pg_proc where pronamespace='lumin'::regnamespace and proname in('group_financial_fence','group_financial_statement','group_financial_row','group_financial_head')) then raise exception 'GROUP_FINANCIAL_CATALOG' using errcode='55000';end if;
end$$;
-- Transaction-local migration evidence only; never an application authority flag.
create temporary table group_financial_catalog(kind text,id oid,snapshot jsonb,definition text) on commit drop;
insert into group_financial_catalog select 'function',p.oid,to_jsonb(p),pg_get_functiondef(p.oid) from pg_catalog.pg_proc p where p.pronamespace in('public'::regnamespace,'lumin'::regnamespace) and p.prokind='f';
insert into group_financial_catalog select 'trigger',t.oid,to_jsonb(t),pg_get_triggerdef(t.oid) from pg_catalog.pg_trigger t where t.tgrelid in('public.bookings'::regclass,'public.payments'::regclass,'public.refunds'::regclass,'public.allocation_group_heads'::regclass);
create function lumin.group_financial_fence() returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 perform lumin.group_rc();
 if not exists(select 1 from pg_catalog.pg_locks where pid=pg_backend_pid() and database=(select oid from pg_catalog.pg_database where datname=current_database()) and relation='public.allocation_policies'::regclass and granted and mode in('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))
 or not exists(select 1 from pg_catalog.pg_locks where pid=pg_backend_pid() and database=(select oid from pg_catalog.pg_database where datname=current_database()) and relation='public.allocation_group_heads'::regclass and granted and mode in('ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')) then
 raise exception 'GROUP_FINANCIAL_PROTOCOL' using errcode='55000';end if;
end$$;
create function lumin.group_financial_statement() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 perform lumin.group_prefix(false);return null;
end$$;
create function lumin.group_financial_row() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) end;n jsonb:=to_jsonb(new);booking_ids uuid[];payment_ids uuid[];
begin
 if tg_table_name='bookings' then
  -- Detect hidden payment changes even when payment_id was absent from SET list.
  if tg_op='INSERT' and new.payment_id is null then return null;end if;
  if tg_op='UPDATE' and new.payment_id is not distinct from old.payment_id then return null;end if;
  perform lumin.group_financial_fence();
  if exists(select 1 from public.allocation_group_heads h where h.booking_id in((o->>'id')::uuid,(n->>'id')::uuid)) and ((o->>'payment_id') is not null or (n->>'payment_id') is not null) then raise exception 'GROUP_FINANCIAL_ASSOCIATION' using errcode='0A000';end if;
 else
  perform lumin.group_financial_fence();
  booking_ids:=array[(o->>'booking_id')::uuid,(n->>'booking_id')::uuid];
  payment_ids:=case when tg_table_name='payments' then array[(o->>'id')::uuid,(n->>'id')::uuid] else array[(o->>'payment_id')::uuid,(n->>'payment_id')::uuid] end;
  if exists(select 1 from public.allocation_group_heads h where h.booking_id=any(booking_ids)
   or exists(select 1 from public.bookings b where b.id=h.booking_id and b.payment_id=any(payment_ids))
   or exists(select 1 from public.payments p where p.booking_id=h.booking_id and p.id=any(payment_ids))
   or exists(select 1 from public.refunds r where r.booking_id=h.booking_id and r.payment_id=any(payment_ids))) then raise exception 'GROUP_FINANCIAL_ASSOCIATION' using errcode='0A000';end if;
 end if;
 return null;
end$$;
create function lumin.group_financial_head() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 perform lumin.group_financial_fence();perform lumin.group_require_fence();
 if exists(select 1 from public.bookings b where b.id=new.booking_id and b.payment_id is not null)
 or exists(select 1 from public.payments p where p.booking_id=new.booking_id)
 or exists(select 1 from public.refunds r where r.booking_id=new.booking_id or exists(select 1 from public.payments p where p.id=r.payment_id and p.booking_id=new.booking_id)) then raise exception 'GROUP_FINANCIAL_ASSOCIATION' using errcode='0A000';end if;
 if tg_when='BEFORE' then return new;end if;return null;
end$$;
revoke all on function lumin.group_financial_fence(),lumin.group_financial_statement(),lumin.group_financial_row(),lumin.group_financial_head() from public,anon,authenticated,service_role;
insert into group_financial_catalog select 'function',p.oid,to_jsonb(p),pg_get_functiondef(p.oid) from pg_catalog.pg_proc p where p.pronamespace='lumin'::regnamespace and p.proname in('group_financial_fence','group_financial_statement','group_financial_row','group_financial_head');
create trigger group_financial_protocol before insert or update on public.payments for each statement execute function lumin.group_financial_statement();
create trigger group_financial_protocol before insert or update on public.refunds for each statement execute function lumin.group_financial_statement();
create trigger group_financial_insert_protocol before insert on public.bookings for each statement execute function lumin.group_financial_statement();
create trigger group_financial_link_protocol before update of payment_id on public.bookings for each statement execute function lumin.group_financial_statement();
create trigger group_financial_final after insert or update on public.payments for each row execute function lumin.group_financial_row();
create trigger group_financial_final after insert or update on public.refunds for each row execute function lumin.group_financial_row();
create trigger group_financial_final after insert or update on public.bookings for each row execute function lumin.group_financial_row();
create trigger aa_group_financial_initial before insert on public.allocation_group_heads for each row execute function lumin.group_financial_head();
create trigger zz_group_financial_final after insert on public.allocation_group_heads for each row execute function lumin.group_financial_head();
do $$declare r record;expected integer;begin
 if exists(select 1 from group_financial_catalog c where(c.kind='function' and ((select to_jsonb(p) from pg_catalog.pg_proc p where p.oid=c.id) is distinct from c.snapshot or pg_get_functiondef(c.id) is distinct from c.definition)) or(c.kind='trigger' and ((select to_jsonb(t) from pg_catalog.pg_trigger t where t.oid=c.id) is distinct from c.snapshot or pg_get_triggerdef(c.id) is distinct from c.definition))) then raise exception 'GROUP_FINANCIAL_CATALOG' using errcode='55000';end if;
 for r in select * from(values
 ('payments','group_financial_protocol','group_financial_statement',22,false),('refunds','group_financial_protocol','group_financial_statement',22,false),
 ('bookings','group_financial_insert_protocol','group_financial_statement',6,false),('bookings','group_financial_link_protocol','group_financial_statement',18,true),
 ('payments','group_financial_final','group_financial_row',21,false),('refunds','group_financial_final','group_financial_row',21,false),('bookings','group_financial_final','group_financial_row',21,false),
 ('allocation_group_heads','aa_group_financial_initial','group_financial_head',7,false),('allocation_group_heads','zz_group_financial_final','group_financial_head',5,false))x(tbl,trg,fn,typ,col) loop
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=to_regclass('public.'||r.tbl) and t.tgname=r.trg and t.tgfoid=to_regprocedure('lumin.'||r.fn||'()') and t.tgtype=r.typ and t.tgenabled='O' and not t.tgisinternal and not t.tgdeferrable and t.tgqual is null and t.tgnargs=0 and t.tgattr::text=case when r.col then(select attnum::text from pg_catalog.pg_attribute where attrelid='public.bookings'::regclass and attname='payment_id') else '' end) then raise exception 'GROUP_FINANCIAL_CATALOG' using errcode='55000';end if;
 end loop;
 -- Bind new helper source independently of snapshots captured after DDL callbacks.
 -- Only CRLF-to-LF normalization supports Windows checkout versus Linux CI.
 for r in select * from(values
 ('group_financial_fence','void','98d34d4eaaa73f2ac64da89d2e3bdb8d18d19b5721976a6c2ed353fdc1f123dd'),
 ('group_financial_head','trigger','38868ffefe0d93d806401e6df40206d6fb6e8eb75836dce2e8b9b24abc783e8d'),
 ('group_financial_row','trigger','e48d5e8446387f0947f403552cf874561363aba8b64b8e3a8751d68d10866a09'),
 ('group_financial_statement','trigger','0979876820eb28c3e87f4bf3884de62dfc168f7452f6782b6ba01fb5e2295fb7'))x(fn,ret,hash) loop
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('lumin.'||r.fn||'()')
   and p.prorettype=to_regtype(r.ret) and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
   and p.prokind='f' and not p.proretset and not p.proisstrict and not p.proleakproof and p.provolatile='v' and p.proparallel='u'
   and p.pronargs=0 and p.pronargdefaults=0 and p.provariadic=0 and p.prosupport=0 and p.procost=100 and p.prorows=0
   and p.proallargtypes is null and p.proargmodes is null and p.proargnames is null and p.probin is null
   and encode(pg_catalog.sha256(convert_to(replace(p.prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex')=r.hash)
  then raise exception 'GROUP_FINANCIAL_CATALOG' using errcode='55000';end if;
 end loop;
 if (select count(*) from pg_catalog.pg_proc p where p.pronamespace='lumin'::regnamespace and p.proname in('group_financial_fence','group_financial_statement','group_financial_row','group_financial_head') and p.proowner=(select oid from pg_catalog.pg_roles where rolname='postgres') and p.prosecdef and p.proconfig=array['search_path=pg_catalog'] and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE'))<>4 then raise exception 'GROUP_FINANCIAL_CATALOG' using errcode='55000';end if;
end$$;
commit;