#!/usr/bin/env python3
"""Observed roster fences; only an explicitly disposable local database."""
import json, os, subprocess, time, uuid

if os.environ.get('ROSTER_SNAPSHOT_TEST_DISPOSABLE') != '1' or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1') or not os.environ.get('PGDATABASE', '').startswith('lumin_'):
    raise SystemExit('Explicit disposable local PostgreSQL required')
BASE = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']

def run(sql):
    p = subprocess.run(BASE, input=sql, text=True, capture_output=True, timeout=10)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()

def wait(query, processes):
    deadline = time.monotonic() + 10
    while run(query) != 't':
        if any(p.poll() is not None for p in processes):
            raise AssertionError('Session ended before observed barrier')
        if time.monotonic() > deadline:
            raise AssertionError('Observed barrier timeout')
        time.sleep(.025)

def start(app, sql, hold):
    p = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    p.stdin.write(f"set application_name='{app}';set statement_timeout='15s';set idle_in_transaction_session_timeout='30s';begin;set local role service_role;{sql}" + ('\n' if hold else 'commit;\n'))
    p.stdin.flush()
    if not hold:
        p.stdin.close()
        p.stdin = None
    return p

for case in ('snapshot-first', 'mutation-first', 'service-no-late-lock'):
    actor, tenant, worker, service = [str(uuid.uuid4()) for _ in range(4)]
    app1, app2 = ['roster-snapshot-' + uuid.uuid4().hex for _ in range(2)]
    first = second = None
    try:
        run(f"""begin;
        insert into auth.users(id,email) values('{actor}','{actor}@example.test');
        insert into public.tenants(id,name,slug,timezone,currency) values('{tenant}','Snapshot','{tenant}','UTC','USD');
        insert into public.tenant_members(tenant_id,user_id,role) values('{tenant}','{actor}','BUSINESS_OWNER');
        insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('{service}','{tenant}','simple','Before','USD',0);
        select public.roster_provision('{actor}','{tenant}');commit;""")
        snapshot = f"select public.owner_roster_snapshot('{actor}','{tenant}');"
        mutation = f"select public.roster_worker_put('{actor}','{tenant}',1,'{worker}','Worker',true,true);"
        a, b = (mutation, snapshot) if case == 'mutation-first' else (snapshot, mutation)
        first = start(app1, a, True)
        wait(f"select exists(select 1 from pg_stat_activity where application_name='{app1}' and state='idle in transaction')", [first])
        if case == 'service-no-late-lock':
            # A service metadata writer can commit while the reader holds its
            # roster fence. Each later read gets one fresh READ COMMITTED view.
            run(f"set statement_timeout='2s';update public.services set name='After' where id='{service}';")
            first.stdin.write(snapshot + 'commit;\n')
        else:
            second = start(app2, b, False)
            wait(f"select exists(select 1 from pg_stat_activity where application_name='{app2}' and wait_event_type='Lock')", [first, second])
            first.stdin.write('commit;\n')
        first.stdin.close()
        first.stdin = None
        output, error = first.communicate(timeout=20)
        assert first.returncode == 0, error
        if second is not None:
            other, error = second.communicate(timeout=20)
            assert second.returncode == 0, error
        if case == 'snapshot-first':
            before = json.loads(output)
            assert before['rosterVersion'] == 1 and before['workers'] == [], before
        elif case == 'mutation-first':
            after = json.loads(other)
            assert after['rosterVersion'] == 2 and after['workers'][0]['id'] == worker, after
        else:
            before, after = [json.loads(line) for line in output.splitlines()]
            assert before['services'][0]['name'] == 'Before' and after['services'][0]['name'] == 'After'
            assert before['rosterVersion'] == after['rosterVersion'] == 1
        final = json.loads(run(snapshot))
        assert final['rosterVersion'] == (1 if case == 'service-no-late-lock' else 2), final
        print('PASS', case, 'observed fence and complete consistent projection')
    finally:
        for p in (first, second):
            if p is not None and p.poll() is None:
                if p.stdin is not None:
                    try:
                        p.stdin.close()
                    except BrokenPipeError:
                        pass
                    p.stdin = None
                p.kill()
                p.communicate(timeout=5)
        run(f"begin;delete from public.workers where tenant_id='{tenant}';delete from public.worker_roster_state where tenant_id='{tenant}';delete from public.services where tenant_id='{tenant}';delete from public.tenant_members where tenant_id='{tenant}';delete from public.tenants where id='{tenant}';delete from auth.users where id='{actor}';commit;")
