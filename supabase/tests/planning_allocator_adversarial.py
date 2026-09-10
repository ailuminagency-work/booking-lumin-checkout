"""Actual generation replacement and late-failure rollback acceptance."""
import json
import hashlib
from datetime import datetime,timezone
import planning_allocator_protocol as p


def encode(value):
    if value is None:return '-1:'
    if isinstance(value,list):return encode(len(value))+''.join(encode(v) for v in value)
    if isinstance(value,bool):value='1' if value else '0'
    text=str(value)
    return str(len(text.encode('utf-8')))+':'+text


def microseconds(value):
    dt=datetime.fromisoformat(value.replace('Z','+00:00'))-datetime(1970,1,1,tzinfo=timezone.utc)
    return dt.days*86400000000+dt.seconds*1000000+dt.microseconds


def release(f,receipt):
    p.query(f"set role service_role;select public.release_planning_group('{f['a']}','{f['t']}','{receipt['groupId']}',{receipt['generation']});")


def state(f):
    return json.loads(p.query(f"""select jsonb_build_object(
      'booking',(select to_jsonb(b) from public.bookings b where id='{f['b']}'),
      'workerManifest',(select jsonb_agg(to_jsonb(w) order by generation,worker_id) from public.allocation_group_workers w where group_id=(select id from public.allocation_group_heads where booking_id='{f['b']}')),
      'head',(select to_jsonb(h) from public.allocation_group_heads h where booking_id='{f['b']}'),
      'groups',(select jsonb_agg(to_jsonb(g) order by generation) from public.allocation_groups g where booking_id='{f['b']}'),
      'resources',(select jsonb_agg(to_jsonb(r) order by id) from public.resource_reservations r where booking_id='{f['b']}'),
      'capacity',(select jsonb_agg(to_jsonb(c) order by id) from public.capacity_holds c where booking_id='{f['b']}'),
      'workers',(select jsonb_agg(to_jsonb(w) order by generation,worker_id) from public.worker_interval_holds w where group_id=(select id from public.allocation_group_heads where booking_id='{f['b']}')),
      'manifest',(select jsonb_agg(to_jsonb(r) order by generation,resource_id) from public.allocation_group_resources r where group_id=(select id from public.allocation_group_heads where booking_id='{f['b']}')))"""))


try:
    sample=['lumin/allocation/intent/v1','\u00e9\U0001f600',-1,True,None,[9007199254740991,False]]
    literal=json.dumps(sample,ensure_ascii=False).replace("'","''")
    encoded=p.query(f"select lumin.allocation_encode('{literal}'::jsonb);")
    assert encoded==encode(sample),(encoded,encode(sample))
    assert p.query(f"select encode(pg_catalog.sha256(convert_to(lumin.allocation_encode('{literal}'::jsonb),'UTF8')),'hex');")==hashlib.sha256(encode(sample).encode()).hexdigest()
    assert p.query("set timezone='Asia/Kathmandu';select lumin.allocation_us('1969-12-31T23:59:59.999999Z');")=='-1'
    print('PASS independent UTF8/nested/safeinteger/hash and negative-epoch fixtures',flush=True)
    f=p.identities();p.seed(f,capacity=10,resource_capacity=3)
    # Caller-immediate mode must be supported by the frozen scoped deferral.
    first_session=p.start('set constraints all immediate;'+p.allocate(f),idle_timeout='1s')
    first=p.receipt(p.finish(first_session)[0])
    stored=json.loads(p.query(f"select jsonb_build_object('start',requested_start,'end',requested_end,'hash',encode(intent_hash,'hex')) from public.allocation_groups where booking_id='{f['b']}' and generation=1;"))
    intent=['lumin/allocation/intent/v1',f['t'],f['b'],1,f['c'],f['s'],microseconds(stored['start']),microseconds(stored['end'])]
    assert stored['hash']==hashlib.sha256(encode(intent).encode()).hexdigest(),'Stored intent differs from independent canonical bytes'
    again=p.allocate_commit(f)
    assert again==first,'Exact retry altered receipt or expiry'
    release(f,first)
    first_state=state(f);original_resource=first_state['resources'][0]
    p.query(f"""delete from public.service_resources where tenant_id='{f['t']}' and service_id='{f['s']}';
      set role service_role;select public.save_allocation_policy('{f['a']}','{f['t']}','{f['s']}',1,0,0,120,'none');""")
    second=p.allocate_commit(f,2);release(f,second)
    p.query(f"""insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values('{f['t']}','{f['s']}','{f['r']}',2);
      set role service_role;select public.save_allocation_policy('{f['a']}','{f['t']}','{f['s']}',2,0,0,120,'linked');""")
    before=state(f)
    trigger="""create function pg_temp.fail_allocator_seal() returns trigger language plpgsql as $$begin
      if new.generation=3 and new.sealed then raise exception 'INDEPENDENT_FINAL_SEAL' using errcode='55000';end if;return new;end$$;
      create trigger zzz_allocator_attack before update on public.allocation_groups for each row execute function pg_temp.fail_allocator_seal();"""
    failure=p.start(trigger+'set local role service_role;set constraints all immediate;'+p.allocate(f,3),role=None)
    p.finish(failure,error=('55000','INDEPENDENT_FINAL_SEAL'))
    assert state(f)==before,'Failed generation3 changed retained state'
    third=p.allocate_commit(f,3);after=state(f)
    assert first['groupId']==second['groupId']==third['groupId']
    assert len(after['groups'])==3 and len(after['resources'])==1,after
    current=after['resources'][0]
    assert current['id']==original_resource['id'] and current['group_generation']==3 and current['quantity']==2,current
    assert current['hold_key']!=original_resource['hold_key'],'Released key revived'
    assert after['groups'][:2]==before['groups'],'Historical generations mutated'
    assert after['manifest'][:1]==first_state['manifest'],'Generation1 manifest mutated'
    print('PASS actual generations1/2/3 physical carrier reuse and final-seal rollback',flush=True)
    release(f,third)
    p.query(f"update public.services set active=false where id='{f['s']}';update public.crews set active=false where id='{f['c']}';")
    history=p.allocate_commit(f,3)
    assert history['status']=='released' and history['usable'] is False,history
    print('PASS terminal history does not require current active service/crew',flush=True)
    # A real30s TTL is allowed to approach expiry before the actual invocation;
    # the invocation itself remains correctly prearmed and blocked under5s.
    expiring=p.identities();p.seed(expiring)
    p.query(f"set role service_role;select public.save_allocation_policy('{expiring['a']}','{expiring['t']}','{expiring['s']}',1,0,0,30,'linked');")
    held=p.allocate_commit(expiring)
    p.query(f"update public.crews set active=false where id='{expiring['c']}';")
    p.observe(f"select expires_at<=clock_timestamp()+interval '3 seconds' from public.allocation_groups where id='{held['groupId']}' and generation=1;",'real TTL approaching expiry',limit=35)
    holder=p.start(f"select id from public.bookings where id='{expiring['b']}' for update;",role=None)
    p.ready(holder)
    assert p.query(f"select expires_at>clock_timestamp() from public.allocation_groups where id='{held['groupId']}' and generation=1;")=='t','Fixture expired before invocation'
    waiter=p.start(p.allocate(expiring));p.blocked(waiter,holder)
    p.observe(f"select expires_at<=clock_timestamp() from public.allocation_groups where id='{held['groupId']}' and generation=1;",'real expiry while allocator waits',limit=4)
    p.finish(holder)
    expired=p.receipt(p.finish(waiter)[0])
    assert expired['status']=='held' and expired['usable'] is False and expired['expiresAt']==held['expiresAt'],expired
    print('PASS observed row wait crosses actual expiry; inactive crew does not obscure nonusable history',flush=True)

    for setting in ('statement_timeout','lock_timeout'):
        f=p.identities();p.seed(f);before=state(f)
        invalid=p.start(f"set local {setting}='5001ms';"+p.allocate(f))
        p.finish(invalid,error=('55000','ALLOCATION_PROTOCOL'))
        assert state(f)==before,'Oversized timer changed allocation state'
        print('PASS separately armed '+setting+' greater than 5000ms rejected',flush=True)

    f=p.identities();p.seed(f);before=state(f)
    delayed="""create function pg_temp.delay_final_seal() returns trigger language plpgsql as $$begin
      if new.sealed then perform pg_sleep(6);end if;return new;end$$;
      create trigger zzz_deadline_seal before update on public.allocation_groups for each row execute function pg_temp.delay_final_seal();"""
    late=p.start(delayed+'set local role service_role;'+p.allocate(f),role=None)
    p.observe(f"select exists(select 1 from pg_stat_activity where application_name='{late[1]}' and wait_event='PgSleep')",'actual final seal delay')
    p.finish(late,error=('57014','statement timeout'))
    assert state(f)==before,'Final seal timeout leaked partial allocation'
    print('PASS actual delayed final seal hits armed deadline and rolls back every carrier',flush=True)

    f=p.identities();p.seed(f)
    second=str(__import__('uuid').uuid4())
    p.query(f"""insert into public.workers(id,tenant_id,display_name) values('{second}','{f['t']}','Last worker');
      insert into public.crew_members values('{f['t']}','{f['c']}','{second}');
      insert into public.service_worker_eligibility values('{f['t']}','{f['s']}','{second}',true);
      insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active)
      select gen_random_uuid(),tenant_id,'{second}',kind,starts_at,ends_at,source_time_zone,active from public.worker_shifts where id='{f['shift']}';""")
    before=state(f)
    fault="""create function pg_temp.fail_last_worker() returns trigger language plpgsql as $$begin
      if (select count(*) from public.worker_interval_holds where group_id=new.group_id)=1 then
        raise exception 'INDEPENDENT_LAST_WORKER' using errcode='55000';end if;return new;end$$;
      create trigger zzz_last_worker before insert on public.worker_interval_holds for each row execute function pg_temp.fail_last_worker();"""
    last=p.start(fault+'set local role service_role;'+p.allocate(f),role=None)
    p.finish(last,error=('55000','INDEPENDENT_LAST_WORKER'))
    assert state(f)==before,'Last worker failure leaked allocation state'
    assert p.allocate_commit(f)['usable'],'Clean multi-worker retry failed'
    print('PASS forced second/last worker failure rolls back earlier worker and all carriers',flush=True)

    f=p.identities();p.seed(f)
    # Local caller response-loss model: do not parse allocation output until
    # COMMIT acknowledgement. Deliberately discard the transport after COMMIT.
    uncertain=p.start(p.allocate(f));p.ready(uncertain)
    uncertain[0].stdin.write('set constraints all immediate;commit;\n');uncertain[0].stdin.flush()
    p.observe(f"select exists(select 1 from pg_stat_activity where application_name='{uncertain[1]}' and state='idle' and xact_start is null)",'actual committed session before simulated response loss')
    persisted=state(f)
    uncertain[0].kill();uncertain[0].wait(timeout=3)
    caller_result=p.acknowledged_outcome(uncertain)
    assert caller_result['success'] is False and caller_result['receipt'] is None
    acknowledged=p.acknowledged_outcome(p.start(p.allocate(f)))
    assert acknowledged['success'] is True and acknowledged['status']=='committed'
    reconciled=acknowledged['receipt']
    assert reconciled['groupId']==persisted['head']['id'] and reconciled['generation']==1
    assert state(f)==persisted,'Reconciliation renewed expiry or changed intent/state'
    print('PASS local caller discards uncertain COMMIT response, returns no success, reconciles same generation without renewal',flush=True)

    f=p.identities();p.seed(f)
    p.query(f"""update public.bookings set slot_start=to_timestamp(ceil(extract(epoch from clock_timestamp())/300)*300)+interval '10 minutes',
      slot_end=to_timestamp(ceil(extract(epoch from clock_timestamp())/300)*300)+interval '70 minutes' where id='{f['b']}';
      update public.availability_overrides set date=(select (slot_start at time zone 'UTC')::date from public.bookings where id='{f['b']}') where id='{f['window']}';
      update public.worker_shifts set starts_at=(select slot_start-interval '1 hour' from public.bookings where id='{f['b']}'),ends_at=(select slot_end+interval '1 hour' from public.bookings where id='{f['b']}') where id='{f['shift']}';
      update public.scheduling_policies set slot_interval_minutes=5,lead_time_minutes=(select floor(extract(epoch from slot_start-clock_timestamp())/60)::integer from public.bookings where id='{f['b']}') where tenant_id='{f['t']}';""")
    boundary=f"(select b.slot_start-make_interval(mins=>s.lead_time_minutes) from public.bookings b join public.scheduling_policies s on s.tenant_id=b.tenant_id where b.id='{f['b']}')"
    p.observe(f"select {boundary}<=clock_timestamp()+interval '3 seconds'",'lead-time admission boundary approaching',limit=65)
    before=state(f)
    holder=p.start(f"select id from public.bookings where id='{f['b']}' for update;",role=None);p.ready(holder)
    assert p.query(f"select {boundary}>clock_timestamp()")=='t','Lead time already expired before invocation'
    waiter=p.start(p.allocate(f));p.blocked(waiter,holder)
    p.observe(f"select {boundary}<clock_timestamp()",'lead time crossed during actual row wait',limit=4)
    p.finish(holder);p.finish(waiter,error=('P0001','ALLOCATION_UNAVAILABLE'))
    assert state(f)==before,'Expired lead time allocated partial state'
    print('PASS fresh admission lead time crosses observed wait and rejects without allocation',flush=True)

finally:
    p.cleanup()
