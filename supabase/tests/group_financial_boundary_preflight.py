"""Independent0027 rollback checks; fresh local disposable0001..0026 only."""
import json
import os
from pathlib import Path
import subprocess
import uuid

if (os.environ.get('GROUP_FINANCIAL_TEST_DISPOSABLE') != '1'
        or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1')
        or not os.environ.get('PGDATABASE', '').startswith('lumin_')):
    raise SystemExit('Explicit disposable loopback lumin_ database required')
args = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
migration = Path(os.environ['GROUP_FINANCIAL_MIGRATION_FILE']).read_text(encoding='utf-8-sig')
fixture = Path(os.environ['GROUP_FINANCIAL_FIXTURE_FILE']).read_text(encoding='utf-8-sig')
tests = Path(os.environ['GROUP_FINANCIAL_TEST_FILE']).read_text(encoding='utf-8-sig')
if not migration.strip() or not tests.strip():
    raise SystemExit('Migration and behavioral SQL suite required')


def run(sql):
    return subprocess.run(args, input="set statement_timeout='12s';set lock_timeout='8s';" + sql,
                          capture_output=True, text=True, timeout=20)


def query(sql):
    r = run(sql)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


snapshot_sql = """select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('catalog',to_jsonb(p),'definition',pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p where p.prokind='f' and p.pronamespace in('public'::regnamespace,'lumin'::regnamespace)),
 'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace),
 'tables',(select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),
 'events',(select jsonb_agg(to_jsonb(e) order by e.oid) from pg_event_trigger e),
 'heads',(select jsonb_agg(to_jsonb(h) order by tenant_id,id) from public.allocation_group_heads h),
 'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),
 'refunds',(select jsonb_agg(to_jsonb(r) order by id) from public.refunds r),
 'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b))"""
baseline = json.loads(query(snapshot_sql))


def parents(f):
    return 'select pg_temp.fixture_parents(' + ','.join("'%s'" % f[k] for k in ('a','t','b','s','c','w','r')) + ');'


def group(f):
    return 'select pg_temp.fixture_group(' + ','.join("'%s'" % f[k] for k in ('a','t','b','g','s','c','w','r')) + ",1,clock_timestamp()+interval '5 minutes');"


def ids():
    return dict(zip(('a','t','b','g','s','c','w','r','p'), [str(uuid.uuid4()) for _ in range(9)]))


def payment(f, booking=None, tenant=None):
    return f"insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values('{f['p']}','{tenant or f['t']}','{booking or f['b']}','fake','{f['p']}',1,'USD');"


def reject(label, setup, code, marker=None, isolation='read committed', sqlstate='55000'):
    r = run('begin isolation level '+isolation+';' + fixture + setup + "select 'FINANCIAL_FIXTURE_READY';" + migration)
    assert r.returncode != 0 and 'FINANCIAL_FIXTURE_READY' in r.stdout, (label, r.stdout, r.stderr)
    assert sqlstate in r.stderr and code in r.stderr, (label, r.stderr)
    if marker:
        assert marker in r.stderr, ('Injected late DDL was not reached', r.stderr)
    assert json.loads(query(snapshot_sql)) == baseline, 'Partial catalog/data survived: ' + label
    print('PASS complete rollback:', label, flush=True)


for mode in ('booking_link','payment','refund_direct','refund_indirect','terminal_payment','wrong_tenant_payment'):
    f, other = ids(), ids()
    setup = parents(f) + parents(other) + group(f)
    if mode == 'terminal_payment':
        setup += f"select public.release_planning_group('{f['a']}','{f['t']}','{f['g']}',1);"
    if mode == 'booking_link':
        setup += payment(other) + f"update public.bookings set payment_id='{other['p']}' where id='{f['b']}';"
    elif mode == 'refund_direct':
        setup += payment(other) + f"insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values('{f['t']}','{f['b']}','{other['p']}',1,'USD');"
    elif mode == 'refund_indirect':
        # Its referenced payment necessarily also supplies the direct payment path.
        setup += payment(f) + f"insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values('{other['t']}','{other['b']}','{f['p']}',1,'USD');"
    else:
        setup += payment(f, tenant=other['t'] if mode == 'wrong_tenant_payment' else None)
    reject(mode, setup, 'GROUP_FINANCIAL_PREFLIGHT')

# The event trigger is part of the same rollback transaction. Its marker proves
# at least one candidate CREATE TRIGGER really executed, not a preflight failure.
late = """create function lumin.financial_review_late() returns event_trigger language plpgsql as $$begin
 raise notice 'FINANCIAL_AFTER_TRIGGER_DDL';
 raise exception 'FINANCIAL_INJECTED_DDL_FAILURE' using errcode='55000';end$$;
create event trigger financial_review_late on ddl_command_end when tag in('CREATE TRIGGER') execute function lumin.financial_review_late();"""
reject('late trigger DDL failure', late, 'FINANCIAL_INJECTED_DDL_FAILURE', 'FINANCIAL_AFTER_TRIGGER_DDL')
helper_tamper = """create function lumin.financial_review_creation() returns event_trigger language plpgsql as $outer$begin
if exists(select 1 from pg_proc where oid=to_regprocedure('lumin.group_financial_row()') and prosrc not like '%FINANCIAL_REVIEW_BYPASS%') then
execute $ddl$create or replace function lumin.group_financial_row() returns trigger language plpgsql security definer set search_path=pg_catalog as $body$begin -- FINANCIAL_REVIEW_BYPASS
return null;end$body$$ddl$;
raise notice 'HELPER_TAMPER_EXECUTED';end if;end$outer$;
create event trigger financial_review_creation on ddl_command_end when tag in('CREATE FUNCTION') execute function lumin.financial_review_creation();"""
reject('new helper mutated before catalog snapshot', helper_tamper, 'GROUP_FINANCIAL_CATALOG', 'HELPER_TAMPER_EXECUTED')
trigger_tamper = """create function lumin.financial_review_trigger() returns event_trigger language plpgsql as $$begin
if exists(select 1 from pg_trigger where tgrelid='public.allocation_group_heads'::regclass and tgname='zz_group_financial_final') then
alter table public.payments disable trigger group_financial_protocol;
raise notice 'LATE_TRIGGER_DISABLED';end if;end$$;
create event trigger financial_review_trigger on ddl_command_end when tag in('CREATE TRIGGER') execute function lumin.financial_review_trigger();"""
reject('last trigger DDL disables earlier protocol', trigger_tamper, 'GROUP_FINANCIAL_CATALOG', 'LATE_TRIGGER_DISABLED')
for isolation in ('repeatable read','serializable'):
    reject('unsupported migration isolation '+isolation, 'select count(*) from pg_catalog.pg_class;',
           'GROUP_ISOLATION_UNSUPPORTED', isolation=isolation, sqlstate='0A000')
query(migration)
installed = json.loads(query(snapshot_sql))
for kind in ('functions', 'triggers'):
    for original in baseline[kind] or []:
        assert original in (installed[kind] or []), 'Accepted catalog changed: ' + kind
for kind in ('tables', 'events', 'heads', 'payments', 'refunds', 'bookings'):
    assert installed[kind] == baseline[kind], 'Unexpected migration effect: ' + kind
behavior = subprocess.run(args + ['-f', str(Path(os.environ['GROUP_FINANCIAL_TEST_FILE']).resolve())],
                          capture_output=True, text=True, timeout=30)
assert behavior.returncode == 0, behavior.stderr
assert 'GROUP FINANCIAL BOUNDARY TESTS PASS' in behavior.stdout, 'Behavioral suite did not reach final PASS marker'
print('FINANCIAL PREFLIGHT PASS: eleven rejected transactions plus installed behavioral suite', flush=True)
