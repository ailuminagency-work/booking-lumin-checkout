"""Observed PostgreSQL group races; retained fixtures require a dedicated local DB.

No application constructor, trigger bypass, cleanup DELETE or database drop.
GROUP_FIXTURE_FILE may select the SQL builder's fixture before integration.
"""
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

if (os.environ.get('GROUP_LIFECYCLE_TEST_DISPOSABLE') != '1'
        or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1')
        or not os.environ.get('PGDATABASE', '').startswith('lumin_')):
    raise SystemExit('Dedicated disposable local lumin_ database required')
args = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
fixture = Path(os.environ.get('GROUP_FIXTURE_FILE', Path(__file__).with_name('group_lifecycle_fixture.sql'))).read_text()
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
    name = 'group-race-' + uuid.uuid4().hex
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


def finish(s, command='commit;', error=None):
    p = s[0]
    if p.poll() is None:
        try:
            p.stdin.write(command + '\n\\q\n')
            p.stdin.flush()
        except BrokenPipeError:
            pass
    out, err = p.communicate(timeout=20)
    if error:
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


def reserve(f, resource=None):
    return f"select * from lumin.reserve_resource_quantity('{f['t']}','{resource or f['r']}','2035-01-01T10:00Z','2035-01-01T11:00Z','{f['b']}',interval '5 minutes',1);"


def made(f, expiry="clock_timestamp()+interval '5 minutes'"):
    sql(fixture + 'begin;' + construct(f, expiry=expiry) + 'commit;')


def proof(f, generation, status):
    active = status == 'held'
    q = f"""select jsonb_build_object(
      'state',(select state from public.bookings where id='{f['b']}'),
      'head',(select current_generation from public.allocation_group_heads where tenant_id='{f['t']}' and id='{f['g']}'),
      'status',(select status from public.allocation_groups where tenant_id='{f['t']}' and id='{f['g']}' and generation={generation}),
      'capacity',(select count(*) from public.capacity_holds where tenant_id='{f['t']}' and booking_id='{f['b']}' and group_id='{f['g']}' and group_generation={generation} and status='{'active' if active else 'released'}'),
      'resource',(select count(*) from public.resource_reservations where tenant_id='{f['t']}' and booking_id='{f['b']}' and group_id='{f['g']}' and group_generation={generation} and status='{'held' if active else 'released'}'),
      'worker',(select count(*) from public.worker_interval_holds where tenant_id='{f['t']}' and group_id='{f['g']}' and generation={generation} and status='{'held' if active else 'released'}'),
      'payments',(select count(*) from public.payments where booking_id='{f['b']}'),
      'nongroup',(select count(*) from public.resource_reservations where booking_id='{f['b']}' and group_id is null));"""
    assert json.loads(sql(q)) == dict(state='draft', head=generation, status=status, capacity=1, resource=1, worker=1, payments=0, nongroup=0)


try:
    f = parents()
    extra = str(uuid.uuid4())
    sql(f"insert into public.resources(id,tenant_id,name,capacity) values('{extra}','{f['t']}','Other',3);")
    first = session(construct(f)); ready(first)
    second = session(reserve(f, extra), True); blocked(second, first)
    finish(first); finish(second, error=['GROUP_MANAGED']); proof(f, 1, 'held')
    print('PASS first group blocks wrong-resource legacy admission')

    f = parents()
    first = session(reserve(f), True); ready(first)
    second = session(construct(f)); blocked(second, first)
    finish(first); finish(second, error=['GROUP_INCOMPLETE'])
    assert sql(f"select (select count(*) from public.allocation_groups where tenant_id='{f['t']}')=0 and (select count(*) from public.allocation_group_heads where tenant_id='{f['t']}')=0 and (select count(*) from public.allocation_group_resources where tenant_id='{f['t']}')=0 and (select count(*) from public.allocation_group_workers where tenant_id='{f['t']}')=0 and (select count(*) from public.worker_interval_holds where tenant_id='{f['t']}')=0 and (select count(*) from public.capacity_holds where booking_id='{f['b']}')=0 and (select count(*) from public.resource_reservations where booking_id='{f['b']}' and group_id is null)=1") == 't'
    print('PASS legacy-first rejects group adoption with full construction rollback')

    for primitive in ('consume_hold', 'release_hold', 'consume_resource_holds', 'release_resource_holds'):
        f = parents(); made(f)
        first = session(release(f), True); ready(first)
        second = session(f"select public.{primitive}('{f['b']}');", True); blocked(second, first)
        finish(first); finish(second, error=['GROUP_MANAGED']); proof(f, 1, 'released')
    print('PASS four legacy lifecycle writers wait and deny after atomic closure')

    f = parents(); made(f); sql('set role service_role;' + release(f))
    first = session(construct(f, 2)); ready(first)
    second = session(release(f), True); blocked(second, first)
    finish(first); finish(second, error=['GROUP_GENERATION_CONFLICT']); proof(f, 2, 'held')
    assert sql(f"select (select count(*) from public.allocation_group_workers where tenant_id='{f['t']}')=2 and (select count(*) from public.allocation_group_resources where tenant_id='{f['t']}')=2 and (select status='released' from public.allocation_groups where tenant_id='{f['t']}' and generation=1)") == 't'
    print('PASS replacement generation survives stale release and retains manifests')

    f = parents(); made(f)
    first = session(release(f), True); ready(first)
    second = session(construct(f, 2)); blocked(second, first)
    finish(first); finish(second); proof(f, 2, 'held')
    assert sql(f"select status='released' from public.allocation_groups where tenant_id='{f['t']}' and generation=1") == 't'
    print('PASS release-first replacement waits for complete terminal closure')

    f = parents(); made(f)
    first = session(f"select public.roster_worker_put('{f['a']}','{f['t']}',1,'{f['w']}','Retired',false,false);", True); ready(first)
    second = session(release(f), True); blocked(second, first)
    finish(first); finish(second); proof(f, 1, 'released')
    assert sql(f"select version=2 from public.worker_roster_state where tenant_id='{f['t']}'") == 't'
    print('PASS roster retirement does not prevent freeing pinned group')

    f = parents(); made(f)
    first = session(release(f), True); ready(first)
    second = session(f"select public.save_allocation_policy('{f['a']}','{f['t']}','{f['s']}',1,0,0,120,'linked');", True); blocked(second, first)
    finish(first); finish(second); proof(f, 1, 'released')
    assert sql(f"select revision=2 from public.allocation_policies where tenant_id='{f['t']}' and service_id='{f['s']}'") == 't'
    print('PASS policy change waits for complete closure')

    f = parents(); made(f, "clock_timestamp()+interval '2 seconds'")
    first = session(f"select 1 from public.bookings where id='{f['b']}' for update;"); ready(first)
    second = session(release(f), True); blocked(second, first)
    observe(f"select clock_timestamp()>=expires_at from public.allocation_groups where tenant_id='{f['t']}' and id='{f['g']}'", 'lease expires during row wait')
    finish(first, 'rollback;'); finish(second); proof(f, 1, 'expired')
    print('PASS release refreshes expiry after actual booking-row wait')

    f = parents(); made(f)
    first = session(f"select 1 from public.bookings where id='{f['b']}' for update;"); ready(first)
    second = session(release(f), True); blocked(second, first)
    finish(first, f"delete from public.bookings where id='{f['b']}';commit;", error=['GROUP_HISTORY_RETAINED', 'deadlock detected', '23503'])
    # The parent trigger may be the deadlock loser; if release loses instead,
    # require its whole rollback and retain the complete held group.
    out, err = second[0].communicate(input='commit;\n\\q\n', timeout=20)
    if second[0].returncode:
        assert 'deadlock detected' in err, err
        proof(f, 1, 'held')
    else:
        proof(f, 1, 'released')
    print('PASS parent inversion aborts wholly and retains group identity')

    for isolation in ('repeatable read', 'serializable'):
        f = parents()
        old = session('select count(*) from public.allocation_group_heads;', isolation=isolation); ready(old)
        first = session(construct(f)); ready(first)
        finish(old, 'set local role service_role;' + reserve(f) + 'commit;', error=['GROUP_ISOLATION_UNSUPPORTED'])
        finish(first); proof(f, 1, 'held')
    print('PASS stale higher-isolation snapshots reject without a mutation')

    f = parents()
    old = session('select count(*) from public.allocation_group_heads;', isolation='repeatable read'); ready(old)
    first = session(construct(f)); ready(first)
    # Deliberate privileged external wait is not an application bypass. The
    # actual service-role entry must still reject after the stale reader wakes.
    old[0].stdin.write('lock table public.allocation_group_heads in share mode;set local role service_role;' + reserve(f) + '\n')
    old[0].stdin.flush()
    blocked(old, first); finish(first)
    finish(old, error=['GROUP_ISOLATION_UNSUPPORTED']); proof(f, 1, 'held')
    print('PASS externally waiting stale snapshot still rejects after wakeup')
finally:
    for p in processes:
        if p.poll() is None:
            p.kill()
        try:
            p.communicate(timeout=5)
        except (ValueError, subprocess.TimeoutExpired):
            pass

print('GROUP LIFECYCLE CONCURRENCY PASS: retained synthetic history; no purge or trigger bypass')
