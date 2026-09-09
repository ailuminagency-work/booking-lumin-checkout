"""Explicit local disposable DB opt-in; prove overlapping database lock waits."""
import os
import subprocess
import time
import uuid

if os.environ.get('RESOURCE_QUANTITY_TEST_DISPOSABLE') != '1' or os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost') or not os.environ.get('PGDATABASE', '').startswith('lumin_'):
    raise SystemExit('Explicit disposable local lumin_ database required')
args = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-qAt']
processes = []

def sql(statement):
    result = subprocess.run(args + ['-c', statement], text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def wait_for(predicate, processes_to_watch, label):
    deadline = time.monotonic() + 10
    while not predicate():
        for process in processes_to_watch:
            if process.poll() is not None:
                output, error = process.communicate(timeout=2)
                raise AssertionError(label + ': process exited early: ' + output + error)
        if time.monotonic() >= deadline:
            raise AssertionError(label + ': bounded observation timeout')
        time.sleep(.025)

def active(app, event):
    return sql("select count(*) from pg_stat_activity where application_name='%s' and wait_event='%s';" % (app, event)) == '1'

def begin_holder(statement):
    app = 'quantity-holder-' + uuid.uuid4().hex
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(process)
    # After the observed sleep ends, stdin stays open and the transaction remains
    # idle until the test explicitly commits. Scheduler delays cannot end overlap.
    process.stdin.write("begin; set application_name='%s'; %s select pg_sleep(2);\n" % (app, statement))
    process.stdin.flush()
    wait_for(lambda: active(app, 'PgSleep'), [process], 'first writer PgSleep')
    return process

def begin_waiter(statement):
    app = 'quantity-waiter-' + uuid.uuid4().hex
    process = subprocess.Popen(args + ['-c', "begin; set application_name='%s'; set local role service_role; %s commit;" % (app, statement)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(process)
    return process, app

def finish(holder, waiter):
    holder.stdin.write('commit;\n\\q\n')
    holder.stdin.flush()
    first, error = holder.communicate(timeout=10)
    assert holder.returncode == 0, error
    second, error = waiter.communicate(timeout=10)
    assert waiter.returncode == 0, error
    return first.strip(), second.strip()

tenant, resource = str(uuid.uuid4()), str(uuid.uuid4())
bookings = [str(uuid.uuid4()) for _ in range(8)]
slug = 'quantity-race-' + tenant
created = False

def reserve(index, quantity=None):
    fn = 'public.reserve_resource' if quantity is None else 'lumin.reserve_resource_quantity'
    extra = '' if quantity is None else ',' + str(quantity)
    return "select result from %s('%s','%s','2035-01-01T10:00Z','2035-01-01T11:00Z','%s',interval '15 minutes'%s);" % (fn, tenant, resource, bookings[index], extra)

def race(first, second):
    holder = begin_holder('set local role service_role; ' + first)
    waiter, app = begin_waiter(second)
    wait_for(lambda: active(app, 'advisory'), [holder, waiter], 'second writer shared advisory wait')
    return sorted(finish(holder, waiter))

try:
    rows = ','.join("('%s','%s','QUANTITY-RACE-%d','2035-01-01T10:00Z','2035-01-01T11:00Z','quantity-race-key-%d')" % (booking, tenant, n, n) for n, booking in enumerate(bookings))
    sql("begin; insert into public.tenants(id,name,slug,timezone,currency) values('%s','Synthetic quantity race','%s','UTC','USD'); insert into public.resources(id,tenant_id,name,capacity) values('%s','%s','Equipment',3); insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values %s; commit;" % (tenant, slug, resource, tenant, rows))
    created = True
    assert race(reserve(0), reserve(1, 3)) == ['GRANTED', 'NO_CAPACITY'], 'old/new final units oversold'
    sql("delete from public.resource_reservations where tenant_id='%s';" % tenant)
    assert race(reserve(2, 2), reserve(3, 2)) == ['GRANTED', 'NO_CAPACITY'], 'two multi-unit holds oversold'
    sql("delete from public.resource_reservations where tenant_id='%s';" % tenant)
    assert race(reserve(4), reserve(5, 2)) == ['GRANTED', 'GRANTED'], 'compatible old/new quantities rejected'
    assert sql(reserve(6)) == 'NO_CAPACITY', 'legacy writer ignored existing quantities'
    assert sql("select sum(quantity) from public.resource_reservations where tenant_id='%s';" % tenant) == '3'
    sql("delete from public.resource_reservations where tenant_id='%s';" % tenant)
    sql(reserve(0, 3))
    sql("update public.resource_reservations set expires_at=clock_timestamp()+interval '2 seconds' where tenant_id='%s';" % tenant)
    holder = begin_holder("select pg_advisory_xact_lock(hashtextextended('lumin:resource-capacity:%s:%s',0));" % (tenant, resource))
    waiter, app = begin_waiter(reserve(7))
    wait_for(lambda: active(app, 'advisory'), [holder, waiter], 'expiry advisory wait')
    wait_for(lambda: sql("select expires_at<=clock_timestamp() from public.resource_reservations where tenant_id='%s' and booking_id='%s';" % (tenant, bookings[0])) == 't', [holder, waiter], 'held capacity expiry')
    assert finish(holder, waiter)[1] == 'GRANTED', 'expiry after advisory wait used stale time'
    sql("delete from public.resource_reservations where tenant_id='%s';" % tenant)
    # Released old row forces FOR UPDATE to wait after the shared advisory lock;
    # a separate full-capacity held row expires during that wait.
    sql("insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity) values ('%s','%s','%s','2035-01-01T10:00Z','2035-01-01T11:00Z','%s','released',clock_timestamp()+interval '15 minutes',1),('%s','%s','%s','2035-01-01T10:00Z','2035-01-01T11:00Z','%s','held',clock_timestamp()+interval '2 seconds',3);" % (tenant,resource,bookings[0],bookings[0],tenant,resource,bookings[1],bookings[1]))
    holder = begin_holder("select id from public.resource_reservations where tenant_id='%s' and booking_id='%s' for update;" % (tenant, bookings[0]))
    waiter, app = begin_waiter(reserve(0, 3))
    wait_for(lambda: active(app, 'transactionid'), [holder, waiter], 'released reservation row-lock wait')
    wait_for(lambda: sql("select expires_at<=clock_timestamp() from public.resource_reservations where tenant_id='%s' and booking_id='%s';" % (tenant, bookings[1])) == 't', [holder, waiter], 'competing quantity expiry')
    assert finish(holder, waiter)[1] == 'GRANTED', 'expiry after old-row lock used stale time'
    print('RESOURCE QUANTITY CONCURRENCY PASS: five observed database-overlap scenarios')
finally:
    cleanup_errors = []
    for process in processes:
        try:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        except (OSError, subprocess.TimeoutExpired) as error:
            cleanup_errors.append(type(error).__name__)
    if created:
        try:
            sql("delete from public.tenants where id='%s' and slug='%s';" % (tenant, slug))
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            cleanup_errors.append(type(error).__name__)
    if cleanup_errors:
        raise RuntimeError('Harness cleanup failed: ' + ', '.join(cleanup_errors))
