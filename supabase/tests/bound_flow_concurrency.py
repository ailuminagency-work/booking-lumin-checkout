#!/usr/bin/env python3
"""Disposable local PostgreSQL only. Requires psql/PG* and BOUND_FLOW_TEST_DISPOSABLE=1.
Fixture cleanup temporarily disables ONLY the two version-immutability triggers
inside a transaction, deleting exact random fixture IDs, then re-enables them.
This is test-superuser cleanup, never an application capability.
"""
import json, os, subprocess, time, uuid
if os.environ.get('BOUND_FLOW_TEST_DISPOSABLE')!='1' or os.environ.get('PGHOST') not in ('127.0.0.1','localhost') or not os.environ.get('PGDATABASE'):
    raise SystemExit('Explicit disposable local PG configuration required')
BASE=[os.environ.get('PSQL_BIN','psql'),'-X','-qAt','-v','ON_ERROR_STOP=1']
def run(q):
    r=subprocess.run(BASE+['-c',q],text=True,capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
actor,tenant,service,flow,version,install=[str(uuid.uuid4()) for _ in range(6)]
token=uuid.uuid4().hex+uuid.uuid4().hex
app='bound-flow-race-'+uuid.uuid4().hex
config=json.dumps({'key':'request','steps':[{'key':'q','questionKey':'q','kind':'question','required':True}]})
submit=f"select public.submit_flow_request('{token}','https://business.example','race-request-key0001','{{\"q\":{{\"quantity\":2}}}}','{{\"name\":\"Race Person\",\"email\":\"{actor}@example.test\"}}','2099-01-01T10:00Z');"
first=second=None
try:
    run(f"""begin;
    insert into auth.users(id,email) values('{actor}','race-owner@example.test');
    insert into public.tenants(id,name,slug,timezone,currency) values('{tenant}','Race','race-{tenant}','UTC','USD');
    insert into public.tenant_members(tenant_id,user_id,role) values('{tenant}','{actor}','BUSINESS_OWNER');
    insert into public.services(id,tenant_id,archetype,name,currency,base_price) values('{service}','{tenant}','simple','Race','USD',0);
    insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty) values('{tenant}','{service}','q','Count','quantity',0,1,5);
    set local role service_role;
    select public.save_bound_flow_draft('{actor}','{tenant}','{flow}','{service}',0,'Race','{config}');
    select public.publish_bound_flow('{actor}','{tenant}','{flow}',1,'{version}','{install}','["https://business.example"]');
    select public.issue_flow_session('{install}','{token}','https://business.example'); commit;""")
    first=subprocess.Popen(BASE+['-c',f"set application_name='{app}';begin;set local role service_role;{submit} select pg_sleep(3);commit;"],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    deadline=time.monotonic()+10
    while run(f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event='PgSleep'")!='1':
        if first.poll() is not None: raise RuntimeError(first.communicate()[1])
        if time.monotonic()>deadline: raise RuntimeError('Barrier timeout')
        time.sleep(.03)
    second=subprocess.Popen(BASE+['-c',f'begin;set local role service_role;{submit}commit;'],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    out1,err1=first.communicate(timeout=15);out2,err2=second.communicate(timeout=15)
    assert first.returncode==second.returncode==0,(err1,err2)
    receipt1=json.loads(out1.strip());receipt2=json.loads(out2.strip())
    assert receipt1==receipt2 and receipt1['confirmed'] is False
    assert run(f"select (select count(*) from public.flow_requests where tenant_id='{tenant}')=1 and (select count(*) from public.bookings where tenant_id='{tenant}' and state='draft')=1 and (select count(*) from public.durable_outbox where tenant_id='{tenant}')=1")=='t'
    print('PASS bound-flow concurrent submit: identical durable receipt, one draft/provenance/outbox')
finally:
    for proc in (first,second):
        if proc is not None and proc.poll() is None:proc.kill();proc.communicate()
    run(f"""begin;
    delete from public.durable_outbox where tenant_id='{tenant}';
    delete from public.flow_requests where tenant_id='{tenant}';
    delete from public.bookings where tenant_id='{tenant}';
    delete from public.customers where tenant_id='{tenant}';
    delete from public.flow_sessions where tenant_id='{tenant}';
    delete from public.flow_installations where tenant_id='{tenant}';
    update public.flows set published_version_id=null where tenant_id='{tenant}';
    alter table public.bound_flow_versions disable trigger bound_flow_versions_immutable;
    delete from public.bound_flow_versions where tenant_id='{tenant}' and flow_id='{flow}';
    alter table public.bound_flow_versions enable trigger bound_flow_versions_immutable;
    alter table public.flow_versions disable trigger flow_versions_immutable;
    delete from public.flow_versions where tenant_id='{tenant}' and flow_id='{flow}';
    alter table public.flow_versions enable trigger flow_versions_immutable;
    delete from public.bound_flow_services where tenant_id='{tenant}';
    delete from public.flow_drafts where tenant_id='{tenant}';
    delete from public.flows where tenant_id='{tenant}';
    delete from public.service_questions where tenant_id='{tenant}';
    delete from public.services where tenant_id='{tenant}';
    delete from public.tenant_members where tenant_id='{tenant}';
    delete from public.tenants where id='{tenant}';
    delete from auth.users where id='{actor}';commit;""")
