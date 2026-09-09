#!/usr/bin/env python3
"""Local disposable database only; requires psql on PATH and normal PG* env.
Two owner CAS saves target one revision; exactly one commits. Fixtures use
random UUIDs and are removed by exact ID. No providers/network except local PG.
"""
import os
import subprocess
import time
import uuid

if os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost'):
    raise SystemExit('Set PGHOST to localhost/127.0.0.1 for this disposable harness')
if not os.environ.get('PGDATABASE'):
    raise SystemExit('Set explicit disposable PGDATABASE')

def run(sql, check=True):
    result = subprocess.run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

user, tenant, flow = (str(uuid.uuid4()) for _ in range(3))
app = 'flow-cas-' + uuid.uuid4().hex
config = '''{"key":"race","steps":[{"key":"q","questionKey":"q"}]}'''
login = f'''set local role authenticated; select set_config('request.jwt.claims','{{"sub":"{user}","role":"authenticated"}}',true);'''
save = f"select public.save_flow_draft('{tenant}','{flow}','Race',1,'{config}');"
first = second = None
try:
    run(f"""begin;
      insert into auth.users(id,email) values('{user}','flow-race@example.test');
      insert into public.tenants(id,name,slug,timezone,currency) values('{tenant}','Race','race-{tenant}','UTC','USD');
      insert into public.tenant_members(tenant_id,user_id,role) values('{tenant}','{user}','BUSINESS_OWNER');
      {login}
      select public.save_flow_draft('{tenant}','{flow}','Race',0,'{config}'); commit;""")
    first = subprocess.Popen(['psql','-X','-v','ON_ERROR_STOP=1','-Atc',f"set application_name='{app}'; begin; {login} {save} select pg_sleep(3); commit;"], stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if run(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event='PgSleep'").stdout.strip() == '1':
            break
        if first.poll() is not None:
            raise RuntimeError('First writer failed before holding the lock: ' + first.communicate()[1])
        time.sleep(.05)
    else:
        raise RuntimeError('First writer did not reach lock barrier')
    second = subprocess.Popen(['psql','-X','-v','ON_ERROR_STOP=1','-Atc',f'begin; {login} {save} commit;'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    _, err1 = first.communicate(timeout=15)
    _, err2 = second.communicate(timeout=15)
    assert first.returncode == 0, err1
    assert second.returncode != 0 and 'FLOW_REVISION_CONFLICT' in err2, err2
    assert run(f"select revision from public.flow_drafts where tenant_id='{tenant}' and flow_id='{flow}'").stdout.strip() == '2'
    print('PASS: overlapping owner saves permit one commit; loser has revision conflict')
finally:
    for process in (first, second):
        if process is not None and process.poll() is None:
            process.kill()
            process.communicate()
    run(f"begin; delete from public.flow_drafts where tenant_id='{tenant}' and flow_id='{flow}'; delete from public.flows where tenant_id='{tenant}' and id='{flow}'; delete from public.tenant_members where tenant_id='{tenant}' and user_id='{user}'; delete from public.tenants where id='{tenant}'; delete from auth.users where id='{user}'; commit;")
