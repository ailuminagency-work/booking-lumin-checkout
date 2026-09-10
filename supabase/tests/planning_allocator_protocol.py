"""Local disposable actual-allocator protocol helpers; no application fixture allocator."""
import json
import errno
import os
from pathlib import Path
import subprocess
import time
import uuid

if (os.environ.get('ALLOCATOR_TEST_DISPOSABLE') != '1'
        or os.environ.get('PGHOST') not in ('localhost','127.0.0.1')
        or not os.environ.get('PGDATABASE','').startswith('lumin_allocator_attack_')):
    raise SystemExit('Explicit loopback lumin_allocator_attack_ database required')
ARGS=[os.environ.get('PSQL_BIN','psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
FIXTURE=Path(os.environ['ALLOCATOR_PARENT_FIXTURE_FILE']).read_text(encoding='utf-8-sig')
PROCESSES=[]
CLIENT_ENV={**os.environ,'PGCLIENTENCODING':'UTF8'}


def query(text):
    # Fixture/catalog work has its own bounded budget; actual allocator calls
    # below still use the frozen separately armed <=5s invocation protocol.
    result=subprocess.run(ARGS,input="set statement_timeout='30s';set lock_timeout='5s';"+text,
                          text=True,encoding='utf-8',env=CLIENT_ENV,capture_output=True,timeout=40)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def observe(sql,label,limit=3):
    end=time.monotonic()+limit
    while query(sql)!='t':
        if time.monotonic()>=end:
            raise AssertionError('No observation: '+label)
        time.sleep(.02)


def start(sql='',role='service_role',timeout='5s',isolation='read committed',idle_timeout='0'):
    started=time.monotonic()
    name='allocator-attack-'+uuid.uuid4().hex
    process=subprocess.Popen(ARGS,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env=CLIENT_ENV)
    PROCESSES.append(process)
    # psql sends these semicolon-terminated commands separately. No nested
    # set_config expression is treated as evidence of an armed query timer.
    process.stdin.write(f"set application_name='{name}';begin isolation level {isolation};\n"
                        +f"set local statement_timeout='{timeout}';set local lock_timeout='5s';set local idle_in_transaction_session_timeout='{idle_timeout}';\n"
                        +(f'set local role {role};\n' if role else '')+sql+'\n')
    process.stdin.flush()
    return process,name,started


def ready(session):
    observe(f"select exists(select 1 from pg_stat_activity where application_name='{session[1]}' and state='idle in transaction')",'idle open transaction')


def blocked(waiter,holder):
    observe(f"select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='{holder[1]}' where w.application_name='{waiter[1]}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)))",'actual lock/blocker PID')


def finish(session,command='set constraints all immediate;commit;',error=None):
    process=session[0]
    if process.poll() is None:
        try:
            process.stdin.write(command+'\n\\q\n');process.stdin.flush()
        except OSError as exc:
            # Windows may report EINVAL, rather than EPIPE, when psql exits
            # between poll and flush after a server-side cancellation.
            if not isinstance(exc,BrokenPipeError) and not (os.name=='nt' and exc.errno==errno.EINVAL):
                raise
            failed_stdin=process.stdin
            try:
                failed_stdin.close()
            except OSError as close_exc:
                if not isinstance(close_exc,BrokenPipeError) and not (os.name=='nt' and close_exc.errno==errno.EINVAL):
                    raise
            finally:
                process.stdin=None
    out,err=process.communicate(timeout=max(.1,10-(time.monotonic()-session[2])))
    if error:
        assert process.returncode and error[0] in err and error[1] in err,(out,err)
    else:
        assert process.returncode==0,err
    return out,err


def cleanup():
    for process in PROCESSES:
        if process.poll() is None:
            process.kill();process.communicate(timeout=3)


def identities(**overrides):
    result={key:str(uuid.uuid4()) for key in ('a','t','b','s','c','w','r','shift','window')}
    result.update(overrides)
    return result


def seed(f,capacity=1,resource_capacity=3,quantity=1,start_offset_minutes=0):
    args=','.join("'%s'"%f[k] for k in ('a','t','b','s','c','w','r'))
    start=f"((date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')+interval '2 days 10 hours'+make_interval(mins=>{start_offset_minutes}))"
    query(FIXTURE+f"""begin;select pg_temp.fixture_parents({args});
      update public.bookings set slot_start={start},slot_end={start}+interval '1 hour' where id='{f['b']}';
      update public.resources set capacity={resource_capacity} where id='{f['r']}';
      update public.service_resources set quantity_required={quantity} where tenant_id='{f['t']}' and service_id='{f['s']}' and resource_id='{f['r']}';
      insert into public.availability_overrides(id,tenant_id,service_id,date,kind,start_minute,end_minute,capacity)
      select '{f['window']}','{f['t']}','{f['s']}',({start} at time zone 'UTC')::date,'open',0,1440,{capacity}
      where not exists(select 1 from public.availability_overrides where tenant_id='{f['t']}' and service_id='{f['s']}');
      insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes)
      values('{f['t']}','{f['s']}',0,366,30) on conflict do nothing;
      insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active)
      values('{f['shift']}','{f['t']}','{f['w']}','available',{start}-interval '10 hours',{start}+interval '14 hours','UTC',true);
      commit;""")


def allocate(f,generation=1):
    return 'select public.allocate_planning_group('+','.join("'%s'"%f[k] for k in ('a','t','b','c'))+f',{generation});'


def receipt(output):
    values=[json.loads(line) for line in output.splitlines() if line.startswith('{')]
    assert len(values)==1,output
    value=values[0]
    assert set(value)=={'schemaVersion','groupId','generation','bookingId','status','usable','expiresAt','bookingState','confirmed'},value
    assert value['schemaVersion']==1 and value['bookingState']=='draft' and value['confirmed'] is False,value
    assert len(json.dumps(value).encode())<=2048,value
    return value


def allocate_commit(f,generation=1):
    session=start(allocate(f,generation),idle_timeout='1s')
    out,_=finish(session)
    return receipt(out)


def acknowledged_outcome(session):
    """Local test caller: receipts become success only after COMMIT acknowledgement."""
    try:
        out,_=finish(session,command="set constraints all immediate;commit;select 'CALLER_COMMIT_ACK';")
    except (AssertionError,subprocess.TimeoutExpired,OSError):
        return {'status':'unknown','success':False,'receipt':None}
    if 'CALLER_COMMIT_ACK' not in out.splitlines():
        return {'status':'unknown','success':False,'receipt':None}
    return {'status':'committed','success':True,'receipt':receipt(out)}
