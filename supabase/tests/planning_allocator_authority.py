"""Actual source/roster/authority/financial writers versus new allocation."""
import uuid
import planning_allocator_protocol as p


def no_head(f):
    assert p.query(f"select count(*) from public.allocation_group_heads where booking_id='{f['b']}';")=='0'


def denied(f,error):
    session=p.start(p.allocate(f))
    p.finish(session,error=error);no_head(f)


try:
    for writer_kind in ('owner_revoked','tenant_suspended','eligibility_revoked','blocked_shift','closed_override','payment_insert'):
        f=p.identities();p.seed(f)
        if writer_kind=='owner_revoked':
            mutation=f"delete from public.tenant_members where tenant_id='{f['t']}' and user_id='{f['a']}';"
            expected=('42501','FORBIDDEN')
        elif writer_kind=='tenant_suspended':
            mutation=f"update public.tenants set status='suspended' where id='{f['t']}';"
            expected=('42501','FORBIDDEN')
        elif writer_kind=='eligibility_revoked':
            version=p.query(f"select version from public.worker_roster_state where tenant_id='{f['t']}';")
            mutation=f"select public.roster_eligibility_put('{f['a']}','{f['t']}',{version},'{f['s']}','{f['w']}',false,false);"
            expected=('P0001','ALLOCATION_UNAVAILABLE')
        elif writer_kind=='blocked_shift':
            version=p.query(f"select version from public.worker_roster_state where tenant_id='{f['t']}';")
            mutation=f"select public.roster_shift_put('{f['a']}','{f['t']}',{version},'{uuid.uuid4()}','{f['w']}','blocked',(select slot_start from public.bookings where id='{f['b']}'),(select slot_end from public.bookings where id='{f['b']}'),'UTC',true,true);"
            expected=('P0001','ALLOCATION_UNAVAILABLE')
        elif writer_kind=='closed_override':
            mutation=f"update public.availability_overrides set kind='closed',start_minute=null,end_minute=null,capacity=null where id='{f['window']}';"
            expected=('P0001','ALLOCATION_UNAVAILABLE')
        else:
            payment=str(uuid.uuid4())
            mutation=f"insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values('{payment}','{f['t']}','{f['b']}','fake','{payment}',1,'USD');"
            expected=('0A000','GROUP_FINANCIAL_ASSOCIATION')
        writer=p.start(mutation,role=None)
        p.ready(writer)
        allocator=p.start(p.allocate(f));p.blocked(allocator,writer)
        p.finish(writer);p.finish(allocator,error=expected);no_head(f)
        print('PASS observed '+writer_kind+' before actual allocation',flush=True)

    # Financial writer arriving after the actual allocator must wait and reject.
    f=p.identities();p.seed(f)
    allocator=p.start(p.allocate(f));p.ready(allocator)
    payment=str(uuid.uuid4())
    writer=p.start(f"insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,amount,currency) values('{payment}','{f['t']}','{f['b']}','fake','{payment}',1,'USD');")
    p.blocked(writer,allocator);p.finish(allocator)
    p.finish(writer,error=('0A000','GROUP_FINANCIAL_ASSOCIATION'))
    assert p.query(f"select count(*) from public.payments where id='{payment}';")=='0'
    print('PASS actual allocation precedes blocked forbidden financial write',flush=True)

    for legacy_first in (True,False):
        f=p.identities();p.seed(f)
        legacy=f"select * from public.reserve_resource('{f['t']}','{f['r']}',(select slot_start from public.bookings where id='{f['b']}'),(select slot_end from public.bookings where id='{f['b']}'),'{f['b']}',interval '2 minutes');"
        if legacy_first:
            holder=p.start(legacy);p.ready(holder)
            waiter=p.start(p.allocate(f));p.blocked(waiter,holder)
            out,_=p.finish(holder);assert 'GRANTED' in out,out
            p.finish(waiter,error=('55000','ALLOCATION_CORRUPT'));no_head(f)
            assert p.query(f"select count(*) from public.resource_reservations where booking_id='{f['b']}' and group_id is null and status='held';")=='1'
        else:
            holder=p.start(p.allocate(f));p.ready(holder)
            waiter=p.start(legacy);p.blocked(waiter,holder)
            p.finish(holder);p.finish(waiter,error=('0A000','GROUP_MANAGED'))
        print('PASS observed legacy resource '+('before' if legacy_first else 'after')+' actual first allocation',flush=True)

    f=p.identities();p.seed(f)
    holder=p.start(p.allocate(f));p.ready(holder)
    version=p.query(f"select version from public.worker_roster_state where tenant_id='{f['t']}';")
    waiter=p.start(f"select public.roster_eligibility_put('{f['a']}','{f['t']}',{version},'{f['s']}','{f['w']}',false,false);")
    p.blocked(waiter,holder);p.finish(holder);p.finish(waiter)
    assert p.query(f"select count(*) from public.allocation_groups where booking_id='{f['b']}' and status='held';")=='1'
    retry=p.start(p.allocate(f));p.finish(retry,error=('P0001','ALLOCATION_UNAVAILABLE'))
    print('PASS roster mutation waits behind allocation then active retry fails closed',flush=True)

    f,other=p.identities(),p.identities();p.seed(f);p.seed(other)
    p.query(f"insert into public.availability_overrides(tenant_id,service_id,date,kind,start_minute,end_minute,capacity) select '{other['t']}','{f['s']}',date,'open',0,1440,1 from public.availability_overrides where id='{f['window']}';")
    denied(f,('55000','ALLOCATION_CORRUPT'))
    print('PASS foreign tenant label cannot hide actual-service availability row',flush=True)
    f=p.identities();p.seed(f)
    p.query(f"insert into public.availability_overrides(tenant_id,service_id,date,kind,start_minute,end_minute,capacity) select '{f['t']}','{f['s']}',date,'open',0,1440,1 from public.availability_overrides cross join generate_series(1,128) where id='{f['window']}';")
    denied(f,('54000','ALLOCATION_LIMIT'))
    print('PASS cap+1 availability completeness rejects instead of truncating',flush=True)
    f=p.identities();p.seed(f)
    for role in ('anon','authenticated'):
        session=p.start(p.allocate(f),role=role)
        p.finish(session,error=('42501','permission denied'))
    no_head(f)
    print('PASS browser roles cannot invoke allocator',flush=True)
finally:
    p.cleanup()
