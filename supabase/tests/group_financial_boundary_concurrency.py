"""Observed PostgreSQL group races; retained fixtures require a dedicated local DB.

No application constructor, trigger bypass, cleanup DELETE or database drop.
GROUP_FINANCIAL_FIXTURE_FILE may select the SQL builder's fixture before integration.
"""
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

if (os.environ.get('GROUP_FINANCIAL_TEST_DISPOSABLE') != '1'
        or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1')
        or not os.environ.get('PGDATABASE', '').startswith('lumin_')):
    raise SystemExit('Dedicated disposable local lumin_ database required')
args = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
fixture = Path(os.environ.get('GROUP_FINANCIAL_FIXTURE_FILE', Path(__file__).with_name('group_lifecycle_fixture.sql'))).read_text()
prefix = "set statement_timeout='15s';set lock_timeout='12s';"
processes = []
names = []


def sql(query):
    result = subprocess.run(args, input=prefix + query, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def observe(query, label):
    deadline = time.monotonic() + 8
    while sql(query) != 't':
        if time.monotonic() >= deadline:
            raise AssertionError('Observation timeout: ' + label)
        time.sleep(.025)


def session(query, role=False, isolation='read committed'):
    name = 'financial-race-' + uuid.uuid4().hex
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(p)
    names.append(name)
    p.stdin.write(prefix + f"set application_name='{name}';" + fixture
                  + f'begin isolation level {isolation};' + ('set local role service_role;' if role else '') + query + '\n')
    p.stdin.flush()
    return p, name


def ready(s):
    # Completion of the first statement while the transaction remains open
    # proves it acquired its locks; no timing-only barrier is used.
    observe(f"select exists(select 1 from pg_stat_activity where application_name='{s[1]}' and state='idle in transaction')", 'holder ready')


def blocked(waiter, holder):
    observe(f"select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='{holder[1]}' where w.application_name='{waiter[1]}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)))", 'actual blocker PID and Lock')


def finish(s, command='commit;', error=None, allow_deadlock=False):
    p = s[0]
    if p.poll() is None:
        try:
            p.stdin.write(command + '\n\\q\n')
            p.stdin.flush()
        except BrokenPipeError:
            pass
    out, err = p.communicate(timeout=20)
    if allow_deadlock and p.returncode:
        assert '40P01' in err, (out, err)
    elif error:
        assert p.returncode != 0 and any(code in err for code in error), (out, err)
    else:
        assert p.returncode == 0, err
    return out, err


def parents():
    f = dict(zip(('a', 't', 'b', 'g', 's', 'c', 'w', 'r'), [str(uuid.uuid4()) for _ in range(8)]))
    values = ','.join("'%s'" % f[k] for k in ('a', 't', 'b', 's', 'c', 'w', 'r'))
    sql(fixture + f'select pg_temp.fixture_parents({values});')
    return f


def construct(f, generation=1, expiry="clock_timestamp()+interval '5 minutes'"):
    values = ','.join("'%s'" % f[k] for k in ('a', 't', 'b', 'g', 's', 'c', 'w', 'r'))
    return f'select pg_temp.fixture_group({values},{generation},{expiry});'


def release(f, generation=1):
    return f"select public.release_planning_group('{f['a']}','{f['t']}','{f['g']}',{generation});"


def pay(f, booking=None):
    return f"insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values('{f['p']}','{f['t']}','{booking or f['b']}','fake','{f['p']}',1,'USD');"


def financial(f, other, mode):
    if mode == 'payment':
        return pay(f)
    if mode == 'booking_link':
        return f"update public.bookings set payment_id='{other['p']}' where id='{f['b']}';"
    if mode == 'refund':
        return f"insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values('{f['t']}','{f['b']}','{other['p']}',1,'USD');"
    if mode == 'payment_move':
        return f"update public.payments set booking_id='{f['b']}' where id='{other['p']}';"
    raise AssertionError(mode)


def invariant(f, group_exists):
    q = f"""select jsonb_build_object(
     'head',(select count(*) from public.allocation_group_heads where booking_id='{f['b']}'),
     'payment',(select count(*) from public.payments where booking_id='{f['b']}'),
     'refund',(select count(*) from public.refunds where booking_id='{f['b']}' or payment_id in(select id from public.payments where booking_id='{f['b']}')),
     'link',(select payment_id is not null from public.bookings where id='{f['b']}'),
     'held',(select count(*) from public.allocation_groups where booking_id='{f['b']}' and sealed and status='held'))"""
    result = json.loads(sql(q))
    if group_exists:
        assert result == {'head':1,'payment':0,'refund':0,'link':False,'held':1}, result

    else:
        assert result['head'] == 0 and result['held'] == 0, result
        assert result['payment'] or result['refund'] or result['link'], result


# Application catalog identities/definitions, not backend-local pg_temp churn.
# Scope triggers by their target relation, even when their handler is temporary.
SNAPSHOT_SQL = """select jsonb_build_object(
 'data',jsonb_build_object(
  'payments',(select count(*) from public.payments),
  'refunds',(select count(*) from public.refunds),
  'heads',(select count(*) from public.allocation_group_heads),
  'linked_bookings',(select count(*) from public.bookings where payment_id is not null)),
 'catalog',jsonb_build_object(
  'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'row',to_jsonb(p)) order by n.nspname,p.proname,p.oid),'[]'::jsonb)
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','lumin')),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'relation',c.relname,'relation_oid',c.oid,'row',to_jsonb(t),
    'function_schema',fn.nspname,'function_row',to_jsonb(fp)) order by n.nspname,c.relname,t.tgname,t.oid),'[]'::jsonb)
   from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
   join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_proc fp on fp.oid=t.tgfoid
   join pg_catalog.pg_namespace fn on fn.oid=fp.pronamespace
   where n.nspname in ('public','lumin') and c.relpersistence<>'t')));"""


def snapshot():
    return json.loads(sql(SNAPSHOT_SQL))


def assert_snapshot_equal(before, after, label):
    assert before['data'] == after['data'], ('Application data changed', label, before['data'], after['data'])
    for component in ('functions', 'triggers'):
        left = {row['row']['oid']: row for row in before['catalog'][component]}
        right = {row['row']['oid']: row for row in after['catalog'][component]}
        changed = [oid for oid in sorted(left.keys() | right.keys()) if left.get(oid) != right.get(oid)]
        # Identity-only diagnostics: do not dump function bodies or trigger arguments.
        identities = [(oid, (right.get(oid) or left[oid])['schema'],
                       (right.get(oid) or left[oid])['row'].get('proname',
                        (right.get(oid) or left[oid])['row'].get('tgname'))) for oid in changed[:20]]
        assert not changed, ('Application catalog changed', label, component, len(changed), identities)


def assert_catalog_difference(before, after, component, label):
    try:
        assert_snapshot_equal(before, after, label)
    except AssertionError as error:
        detail = error.args[0]
        assert isinstance(detail, tuple) and detail[0] == 'Application catalog changed' and detail[2] == component, (label, detail)
    else:
        raise AssertionError(('Snapshot assertion missed changed catalog', label))


def catalog_snapshot_controls():
    # A committed temporary helper in another backend must disappear without
    # changing this application's catalog. Readiness and disappearance are observed.
    baseline = snapshot()
    name = 'financial_snapshot_' + uuid.uuid4().hex
    holder = session('commit;create function pg_temp.' + name
                     + '() returns integer language sql as $$select 1$$;begin;select 1;')
    observe("select exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace "
            + f"where p.proname='{name}' and n.nspname like 'pg_temp_%');", 'committed temporary sentinel exists')
    ready(holder)
    oid = sql("select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace "
              + f"where p.proname='{name}' and n.nspname like 'pg_temp_%';")
    assert oid.isdecimal(), ('Temporary sentinel not observed', oid)
    global_before = sql('select count(*) from pg_catalog.pg_proc;')
    during = snapshot()
    assert_snapshot_equal(baseline, during, 'unrelated temporary helper creation')
    finish(holder, 'rollback;')
    observe(f'select not exists(select 1 from pg_catalog.pg_proc where oid={int(oid)});', 'temporary sentinel removed')
    after = snapshot()
    assert_snapshot_equal(during, after, 'unrelated temporary helper cleanup')
    global_after = sql('select count(*) from pg_catalog.pg_proc;')
    # Counts are diagnostic only: concurrent unrelated helpers are exactly why
    # equality/delta assertions against global catalogs were unsafe.
    print('PASS snapshot temporary cleanup', 'oid=' + oid,
          'global_proc_before=' + global_before, 'global_proc_after=' + global_after, flush=True)

    # All sentinel DDL is rolled back. No payment or application data is written.
    function = 'public.' + name
    trigger = 'snapshot_' + uuid.uuid4().hex
    temp_handler = 'pg_temp.' + name
    statements = [
        'begin;', SNAPSHOT_SQL,
        f'create function {function}() returns integer language sql as $$select 1$$;', SNAPSHOT_SQL,
        f'create or replace function {function}() returns integer language sql as $$select 2$$;', SNAPSHOT_SQL,
        f'create function {temp_handler}() returns trigger language plpgsql as $$begin return new;end$$;', SNAPSHOT_SQL,
        f'create trigger {trigger} before insert on public.payments for each row execute function {temp_handler}();', SNAPSHOT_SQL,
        f'alter table public.payments disable trigger {trigger};', SNAPSHOT_SQL,
        f'create or replace function {temp_handler}() returns trigger language plpgsql as $$begin perform 1;return new;end$$;', SNAPSHOT_SQL,
        'rollback;', SNAPSHOT_SQL]
    values = [json.loads(line) for line in sql(''.join(statements)).splitlines()]
    assert len(values) == 8, ('Expected all catalog control snapshots', len(values))
    initial, created, replaced, temp, attached, disabled, handler_changed, restored = values
    for value in values:
        assert value['data'] == initial['data'], 'Catalog control unexpectedly changed application data'
    assert len(created['catalog']['functions']) == len(initial['catalog']['functions']) + 1
    assert len(replaced['catalog']['functions']) == len(created['catalog']['functions'])
    assert_catalog_difference(initial, created, 'functions', 'permanent function creation')
    assert_catalog_difference(created, replaced, 'functions', 'same-count permanent function replacement')
    assert_snapshot_equal(replaced, temp, 'unattached temporary handler ignored')
    assert len(attached['catalog']['triggers']) == len(temp['catalog']['triggers']) + 1
    assert len(disabled['catalog']['triggers']) == len(attached['catalog']['triggers'])
    assert_catalog_difference(temp, attached, 'triggers', 'temporary handler attached to application table')
    assert_catalog_difference(attached, disabled, 'triggers', 'same-count trigger disable')
    assert len(handler_changed['catalog']['triggers']) == len(disabled['catalog']['triggers'])
    assert_catalog_difference(disabled, handler_changed, 'triggers', 'same-count attached temporary handler replacement')
    assert_snapshot_equal(initial, restored, 'catalog control rollback')
    assert_snapshot_equal(baseline, snapshot(), 'all snapshot controls restored')
    print('PASS snapshot permanent function/trigger definition changes and rollback controls', flush=True)


def denied_transaction(label, body, code, message, marker=None):
    before = snapshot()
    r = subprocess.run(args, input=prefix + fixture + 'begin;' + body + 'commit;', text=True, capture_output=True, timeout=20)
    assert r.returncode and code in r.stderr and message in r.stderr, (label,r.stderr)
    if marker:
        assert marker in r.stderr, (label,'rewrite not observed',r.stderr)
    after = snapshot()
    assert_snapshot_equal(before, after, label)
    print('PASS rollback',label,flush=True)


try:
    catalog_snapshot_controls()
    f, other = parents(), parents()
    f['p'], other['p'] = str(uuid.uuid4()), str(uuid.uuid4())
    sql(pay(other))
    sql(fixture+'begin;'+construct(f)+'commit;')
    late_payment = f"""create function pg_temp.financial_rewrite() returns trigger language plpgsql as $$begin new.booking_id:='{f['b']}';raise notice 'FINAL_PAYMENT_REWRITE';return new;end$$;
    create trigger zzz_financial_review before insert on public.payments for each row execute function pg_temp.financial_rewrite();"""
    denied_transaction('later BEFORE payment rewrite',late_payment+pay(f,other['b']),'0A000','GROUP_FINANCIAL_ASSOCIATION','FINAL_PAYMENT_REWRITE')
    hidden_link = f"""create function pg_temp.financial_rewrite() returns trigger language plpgsql as $$begin new.payment_id:='{other['p']}';raise notice 'UNNAMED_LINK_REWRITE';return new;end$$;
    create trigger zzz_financial_review before update on public.bookings for each row execute function pg_temp.financial_rewrite();
    update public.bookings set reference=reference where id='{f['b']}';"""
    denied_transaction('unnamed booking link requires actual fence',hidden_link,'55000','GROUP_FINANCIAL_PROTOCOL','UNNAMED_LINK_REWRITE')
    fresh = parents()
    late_head = f"""create function pg_temp.financial_rewrite() returns trigger language plpgsql as $$begin new.booking_id:='{other['b']}';new.tenant_id:='{other['t']}';raise notice 'FINAL_HEAD_REWRITE';return new;end$$;
    create trigger zzz_financial_review before insert on public.allocation_group_heads for each row execute function pg_temp.financial_rewrite();
    select lumin.group_prefix(true);insert into public.allocation_group_heads values('{fresh['t']}','{fresh['g']}','{fresh['b']}',1);"""
    denied_transaction('later BEFORE head rewrite',late_head,'0A000','GROUP_FINANCIAL_ASSOCIATION','FINAL_HEAD_REWRITE')
    # Two rows: the first permitted payment must disappear when the last rejects.
    permitted, forbidden = str(uuid.uuid4()), str(uuid.uuid4())
    multi = f"""set local role service_role;insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values
    ('{permitted}','{other['t']}','{other['b']}','fake','{permitted}',1,'USD'),
    ('{forbidden}','{f['t']}','{f['b']}','fake','{forbidden}',1,'USD');"""
    denied_transaction('multirow final financial failure',multi,'0A000','GROUP_FINANCIAL_ASSOCIATION')
    denied_transaction('TRUNCATE CASCADE retains group history','truncate public.payments cascade;','0A000','GROUP_HISTORY_RETAINED')
    denied_transaction('parent DELETE cascade retains history',f"delete from public.tenants where id='{f['t']}';",'0A000','GROUP_HISTORY_RETAINED')
    for mode in ('payment','booking_link','refund','payment_move'):
        for writer_first in (True, False):
            f, other = parents(), parents()
            f['p'], other['p'] = str(uuid.uuid4()), str(uuid.uuid4())
            sql(pay(other))
            if writer_first:
                holder = session(financial(f, other, mode), role=True)
                ready(holder)
                waiter = session(construct(f))
                blocked(waiter, holder)
                finish(holder)
                _, error = finish(waiter, error=['0A000'])
                assert 'GROUP_FINANCIAL_ASSOCIATION' in error, error
                invariant(f, False)
            else:
                holder = session(construct(f))
                ready(holder)
                waiter = session(financial(f, other, mode), role=True)
                blocked(waiter, holder)
                finish(holder)
                _, error = finish(waiter, error=['0A000'])
                assert 'GROUP_FINANCIAL_ASSOCIATION' in error, error
                invariant(f, True)
            print('PASS observed', mode, 'writer-first' if writer_first else 'head-first', flush=True)
    # A stale snapshot is established before the first head commits. The later
    # financial statement must reject isolation rather than use that snapshot.
    for isolation in ('repeatable read','serializable'):
        f, other = parents(), parents()
        f['p'] = str(uuid.uuid4())
        stale = session('select count(*) from pg_catalog.pg_class;', role=True, isolation=isolation)
        # Catalog SELECT establishes a snapshot without raw head grants.
        ready(stale)
        sql(fixture + 'begin;' + construct(f) + 'commit;')
        _, error = finish(stale, financial(f,other,'payment')+'commit;', error=['0A000'])
        assert 'GROUP_ISOLATION_UNSUPPORTED' in error, error
        invariant(f, True)
        print('PASS stale isolation rejection', isolation, flush=True)
    f, other = parents(), parents()
    other['p'] = str(uuid.uuid4())
    sql(pay(other))
    parent = session(f"select id from public.bookings where id='{f['b']}' for update;", role=True)
    ready(parent)
    head = session(construct(f))
    blocked(head,parent)
    # The parent now enters the new financial statement fence while it already
    # owns the booking row needed by the strong-head transaction.
    parent[0].stdin.write(financial(f,other,'booking_link')+'\n')
    parent[0].stdin.flush()
    blocked(parent,head)
    finish(parent,allow_deadlock=True)
    finish(head,allow_deadlock=True)
    assert (parent[0].returncode == 0) != (head[0].returncode == 0), 'Exactly one complete transaction must survive'
    invariant(f,head[0].returncode == 0)
    print('PASS observed financial parent-row/head-fence inversion with full deadlock rollback',flush=True)
    print('FINANCIAL CONCURRENCY PASS: six atomicity attacks, nine observed races and two stale isolation cases', flush=True)
finally:
    for process in processes:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
