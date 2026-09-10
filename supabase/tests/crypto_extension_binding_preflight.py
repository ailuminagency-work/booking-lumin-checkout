"""Independent local-only preflight/atomicity attacks. Run on unpatched 0001..0025.

Each rejected candidate runs inside an outer fixture transaction; psql disconnect
rolls back the intentional catalog/definition tamper AND the migration. No drops,
extension relocation in deployed environments, random output, or live access.
"""
import json
import os
from pathlib import Path
import subprocess

if (os.environ.get('CRYPTO_BINDING_TEST_DISPOSABLE') != '1'
        or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost')
        or not os.environ.get('PGDATABASE', '').startswith('lumin_')):
    raise SystemExit('Explicit disposable loopback lumin_ database required')
args = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
migration = Path(os.environ['CRYPTO_BINDING_MIGRATION_FILE']).read_text(encoding='utf-8-sig')
test_source = Path(os.environ['CRYPTO_BINDING_TEST_FILE']).read_text(encoding='utf-8-sig')
if not migration.strip():
    raise SystemExit('Committed migration must be nonempty')


def run(sql):
    return subprocess.run(args, input="set statement_timeout='10s';set lock_timeout='5s';" + sql,
                          capture_output=True, text=True, timeout=20)


def query(sql):
    r = run(sql)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


snapshot_sql = """select jsonb_build_object(
 'extension',(select to_jsonb(e) from pg_extension e where extname='pgcrypto'),
 'namespaces',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where nspname in('public','extensions','crypto_review_untrusted')),
 'functions',(select jsonb_agg(jsonb_build_object('catalog',to_jsonb(p),'definition',pg_get_functiondef(p.oid)) order by p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and
  (n.nspname='lumin' or p.proname='gen_random_bytes' or exists(select 1 from pg_depend d join pg_extension e on e.oid=d.refobjid where d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass and d.deptype='e' and e.extname='pgcrypto'))),
 'members',(select jsonb_agg(to_jsonb(d) order by d.classid,d.objid,d.objsubid) from pg_depend d join pg_extension e on e.oid=d.refobjid where d.refclassid='pg_extension'::regclass and d.deptype='e' and e.extname='pgcrypto'),
 'event_triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_event_trigger t))"""
baseline = json.loads(query(snapshot_sql))
schema = query("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'")
if schema not in ('public', 'extensions'):
    raise SystemExit('Expected supported public/extensions baseline')
fn = f'{schema}.gen_random_bytes(integer)'
capacity = 'lumin.reserve_capacity_nonplanning(uuid,uuid,timestamptz,timestamptz,uuid,integer,interval)'
resource = 'lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer)'


def reject(label, mutation, code, marker=None):
    result = run('begin;' + mutation + migration)
    assert result.returncode != 0, 'Unexpected preflight acceptance: ' + label
    # A syntax/permission failure in the fixture must never masquerade as a migration rejection.
    assert 'CRYPTO_REVIEW_FIXTURE_READY' in result.stdout, result.stderr
    assert '55000' in result.stderr and code in result.stderr, result.stderr
    if marker:
        assert marker in result.stderr, 'Post-rewrite tamper did not execute: ' + result.stderr
    assert json.loads(query(snapshot_sql)) == baseline, 'Partial mutation survived: ' + label
    print('PASS rejected with complete rollback:', label, flush=True)


def attack(label, mutation, code='CRYPTO_BINDING_UNSUPPORTED', marker=None):
    reject(label, mutation + "select 'CRYPTO_REVIEW_FIXTURE_READY';", code, marker)


attack('wrong function owner', f'alter function {fn} owner to anon;')
# Explicit privileged synthetic catalog tamper, transaction-rolled-back in this disposable DB only.
attack('wrong extension owner', "update pg_extension set extowner=(select oid from pg_roles where rolname='anon') where extname='pgcrypto';")
attack('missing extension membership', f'alter extension pgcrypto drop function {fn};')
attack('unexpected SECURITY DEFINER', f'alter function {fn} security definer;')
attack('unexpected volatility', f'alter function {fn} stable;')
attack('unexpected function settings', f"alter function {fn} set search_path='public';")
attack('unsupported extension schema', 'create schema crypto_review_untrusted;alter extension pgcrypto set schema crypto_review_untrusted;')
attack('second kernel accepted-body drift', f"do $$begin execute replace(pg_get_functiondef('{resource}'::regprocedure),'declare cap integer;','declare cap integer; /* review drift */');end$$;", 'CRYPTO_BINDING_TARGET_DRIFT')
attack('first kernel guard drift', f"do $$begin execute replace(pg_get_functiondef('{capacity}'::regprocedure),'perform lumin.group_legacy_guard(p_booking_id);','perform null;');end$$;", 'CRYPTO_BINDING_TARGET_DRIFT')
attack('second kernel privilege/config drift', f'alter function {resource} security invoker;', 'CRYPTO_BINDING_TARGET_DRIFT')
attack('second kernel OUT type drift', f"update pg_proc set proallargtypes[10]='boolean'::regtype where oid='{resource}'::regprocedure;", 'CRYPTO_BINDING_TARGET_DRIFT')
attack('second kernel OUT name drift', f"update pg_proc set proargnames[10]='drifted_status' where oid='{resource}'::regprocedure;", 'CRYPTO_BINDING_TARGET_DRIFT')
attack('SQL impostor with extension membership', f"alter extension pgcrypto drop function {fn};alter function {fn} rename to crypto_review_original;create function {schema}.gen_random_bytes(integer) returns bytea language sql volatile strict parallel safe cost 1 as $$select ''::bytea$$;alter extension pgcrypto add function {fn};")
if schema == 'extensions':
    attack('postcondition after actual first rewrite', f"""
    create function lumin.crypto_review_postcondition() returns event_trigger language plpgsql as $$begin
      if exists(select 1 from pg_proc where oid='{capacity}'::regprocedure and prosrc like '%extensions.gen_random_bytes(16)%') then
        execute 'alter function {capacity} cost 101';
        raise notice 'CRYPTO_REVIEW_AFTER_FIRST_REWRITE';
      end if;
    end$$;
    create event trigger crypto_review_after_create on ddl_command_end when tag in('CREATE FUNCTION') execute function lumin.crypto_review_postcondition();
    """, 'CRYPTO_BINDING_POSTCONDITION', 'CRYPTO_REVIEW_AFTER_FIRST_REWRITE')
    attack('second rewrite tampers with already checked first target', f"""
    create function lumin.crypto_review_postcondition() returns event_trigger language plpgsql as $$begin
      if exists(select 1 from pg_proc where oid='{resource}'::regprocedure and prosrc like '%extensions.gen_random_bytes(16)%') then
        execute 'alter function {capacity} cost 101';
        raise notice 'CRYPTO_REVIEW_AFTER_SECOND_REWRITE';
      end if;
    end$$;
    create event trigger crypto_review_after_create on ddl_command_end when tag in('CREATE FUNCTION') execute function lumin.crypto_review_postcondition();
    """, 'CRYPTO_BINDING_POSTCONDITION', 'CRYPTO_REVIEW_AFTER_SECOND_REWRITE')
    for label, tamper in (
        ('late primitive owner drift', f'alter function {fn} owner to anon;'),
        ('late primitive membership removal', f'alter extension pgcrypto drop function {fn};'),
        ('late extension owner drift', "update pg_extension set extowner=(select oid from pg_roles where rolname='anon') where extname='pgcrypto';"),
        ('late extension namespace drift', 'alter schema extensions rename to crypto_review_untrusted;'),
    ):
        attack(label, f"""
        create function lumin.crypto_review_postcondition() returns event_trigger language plpgsql as $$begin
          if exists(select 1 from pg_proc where oid='{resource}'::regprocedure and prosrc like '%extensions.gen_random_bytes(16)%') then
            {tamper}
            raise notice 'CRYPTO_REVIEW_AFTER_SECOND_PROVIDER_TAMPER';
          end if;
        end$$;
        create event trigger crypto_review_after_create on ddl_command_end when tag in('CREATE FUNCTION') execute function lumin.crypto_review_postcondition();
        """, 'CRYPTO_BINDING_POSTCONDITION', 'CRYPTO_REVIEW_AFTER_SECOND_PROVIDER_TAMPER')

# A same-named nonmember must never be selected through search_path. The valid
# extension member remains the unique trusted target; the shadow raises if called.
if schema == 'extensions':
    shadow = "create function public.gen_random_bytes(integer) returns bytea language plpgsql volatile as $$begin raise exception 'UNTRUSTED_SHADOW_CALLED';end$$;"
    r = run('begin;' + shadow + migration)
    assert r.returncode == 0, r.stderr
    assert query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='gen_random_bytes'") == '1'
else:
    r = run(migration)
    assert r.returncode == 0, r.stderr

after = json.loads(query(snapshot_sql))
expected = json.loads(json.dumps(baseline))
for item in expected['functions']:
    if item['catalog']['proname'] in ('reserve_capacity_nonplanning', 'reserve_resource_quantity'):
        item['catalog']['prosrc'] = item['catalog']['prosrc'].replace('public.gen_random_bytes(16)', f'{schema}.gen_random_bytes(16)')
        item['definition'] = item['definition'].replace('public.gen_random_bytes(16)', f'{schema}.gen_random_bytes(16)')
if schema == 'extensions':
    # Only the explicitly committed independent shadow fixture is extra.
    after['functions'] = [x for x in after['functions'] if not (x['catalog']['proname']=='gen_random_bytes' and x['catalog']['pronamespace'] == next(n['oid'] for n in after['namespaces'] if n['nspname']=='public'))]
assert after == expected, 'Unexpected metadata/body/ACL/OID change beyond four bindings'
print('PASS full before/after function and extension metadata preservation:', schema, flush=True)
r = run(test_source)
assert r.returncode == 0, r.stderr
assert 'CRYPTO EXTENSION BINDING TESTS PASS' in r.stdout, r.stdout
print('PASS actual allocation/retry/replacement suite with independent shadow retained:', schema, flush=True)
replay_before = json.loads(query(snapshot_sql))
replay = run(migration)
if schema == 'public':
    assert replay.returncode == 0, replay.stderr
else:
    assert replay.returncode != 0 and '55000' in replay.stderr and 'CRYPTO_BINDING_TARGET_DRIFT' in replay.stderr, replay.stderr
assert json.loads(query(snapshot_sql)) == replay_before, 'Replay changed validated state'
print('PASS explicit no-op/one-shot replay semantics:', schema, flush=True)
print('CRYPTO PREFLIGHT SECURITY PASS; dedicated fixture DB retained', flush=True)
