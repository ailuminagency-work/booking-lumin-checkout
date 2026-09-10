"""Observed actual allocator calls; run only after candidate0028 is applied."""
import planning_allocator_protocol as p


def absent(f):
    assert p.query(f"select count(*) from public.allocation_group_heads where booking_id='{f['b']}';")=='0'


try:
    for dimension in ('service','resource','worker'):
        first=p.identities()
        if dimension=='service':
            second=p.identities(a=first['a'],t=first['t'],s=first['s'],r=first['r'])
            p.seed(first,capacity=1,resource_capacity=100)
            p.seed(second,capacity=1,resource_capacity=100,start_offset_minutes=30)
        elif dimension=='resource':
            second=p.identities(a=first['a'],t=first['t'],r=first['r'])
            p.seed(first,capacity=10,resource_capacity=3,quantity=2)
            p.seed(second,capacity=10,resource_capacity=3,quantity=2)
        else:
            second=p.identities(a=first['a'],t=first['t'],w=first['w'])
            p.seed(first,capacity=10,resource_capacity=100)
            p.seed(second,capacity=10,resource_capacity=100)
        holder=p.start(p.allocate(first))
        p.ready(holder)
        waiter=p.start(p.allocate(second))
        p.blocked(waiter,holder)
        winning,_=p.finish(holder)
        p.finish(waiter,error=('P0001','ALLOCATION_UNAVAILABLE'))
        result=p.receipt(winning)
        assert result['usable'] and result['status']=='held',result
        absent(second)
        print('PASS actual allocator contested '+dimension,flush=True)
    # Mutating source wins before admission. The allocator must wait for the
    # real table owner and then read committed reduced resource capacity.
    f=p.identities();p.seed(f,capacity=10,resource_capacity=3,quantity=2)
    writer=p.start(f"update public.resources set capacity=1 where id='{f['r']}';",role=None)
    p.ready(writer)
    allocator=p.start(p.allocate(f));p.blocked(allocator,writer)
    p.finish(writer)
    p.finish(allocator,error=('P0001','ALLOCATION_UNAVAILABLE'));absent(f)
    print('PASS resource source update precedes actual admission',flush=True)
    # Same path with a genuine prearmed short statement timer; there must be
    # no candidate rows after cancellation while the lock holder remains open.
    f=p.identities();p.seed(f)
    writer=p.start(f"update public.resources set capacity=capacity where id='{f['r']}';",role=None)
    p.ready(writer)
    allocator=p.start(p.allocate(f),timeout='1500ms')
    p.blocked(allocator,writer)
    p.finish(allocator,error=('57014','statement timeout'))
    p.finish(writer,command='rollback;');absent(f)
    print('PASS actual prearmed timer cancels blocked allocator with no effects',flush=True)
    # Intentionally unsupported caller: metadata changes inside the running
    # statement do not arm that statement's timer. Observe the real allocator
    # still blocked past1500ms, then explicitly cancel under an external bound.
    f=p.identities();p.seed(f)
    writer=p.start(f"update public.resources set capacity=capacity where id='{f['r']}';",role=None)
    p.ready(writer)
    nested=f"""set local statement_timeout='0';
      with config as materialized(select set_config('statement_timeout','1500ms',true) value)
      select public.allocate_planning_group('{f['a']}','{f['t']}','{f['b']}','{f['c']}',(select case when value='1500ms' then 1::bigint end from config));"""
    unsupported=p.start(nested);p.blocked(unsupported,writer)
    p.observe(f"select exists(select 1 from pg_stat_activity where application_name='{unsupported[1]}' and wait_event_type='Lock' and clock_timestamp()-query_start>interval '1700 milliseconds')",'unsupported timer metadata is not attestation',limit=3)
    assert p.query(f"select pg_cancel_backend(pid) from pg_stat_activity where application_name='{unsupported[1]}';")=='t'
    p.finish(unsupported,error=('57014','user request'))
    p.finish(writer,command='rollback;');absent(f)
    print('PASS bounded negative demonstration: same-statement setting does not attest timer',flush=True)
finally:
    p.cleanup()
