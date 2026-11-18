"""Owned dedicated source-binding disposable DB only; reuses validated harness."""
import pathlib, runpy, concurrent.futures
ctx = runpy.run_path(str(pathlib.Path(__file__).with_name("payment-source-binding-concurrency.py")))
run, T, S = ctx["run"], ctx["T"], ctx["S"]
attempts = []
for n in range(30,36):
    booking = f"a1040000-1111-4000-8000-{n:012}"
    run(f"insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values('{booking}','{T}','ASSOC{n}',now(),now()+interval '1 hour','intent-concurrency-key-{n}')")
    attempts.append(run(f"set role service_role;select id from public.bind_booking_payment_source('{T}','{booking}','{S}')"))
def snapshot(a, amount):
    return run(f"set role service_role;select amount from public.snapshot_payment_attempt_request('{T}','{a}',{amount},'USD')")
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    assert list(pool.map(lambda _:snapshot(attempts[0],100),range(8))) == ['100']*8
print("PASS eight duplicate request snapshots converge")
def competing_snapshot(n):
    amount = 100+n%2
    try: return amount,snapshot(attempts[1],amount)
    except RuntimeError as e:
        if 'PAYMENT_REQUEST_CONFLICT' not in str(e): raise
        return amount,'CONFLICT'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(competing_snapshot,range(8)))
winner=run(f"select amount from public.payment_attempt_requests where attempt_id='{attempts[1]}'")
assert all(result==(str(amount) if str(amount)==winner else 'CONFLICT') for amount,result in results)
print("PASS concurrent conflicting amounts cannot replace immutable request")
def associate(a,intent):
    return run(f"set role service_role;select provider_intent_id from public.associate_payment_attempt_intent('{T}','{a}','{intent}','acct_platformA','acct_concurrentA',false,100,'USD')")
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    assert list(pool.map(lambda _:associate(attempts[0],'pi_duplicate'),range(8)))==['pi_duplicate']*8
print("PASS eight duplicate intent associations converge")
for a in attempts[2:]: snapshot(a,100)
def contested_intent(n):
    intent='pi_competitor_'+str(n%2)
    try:return intent,associate(attempts[2],intent)
    except RuntimeError as e:
        if 'PAYMENT_INTENT_CONFLICT' not in str(e):raise
        return intent,'CONFLICT'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(contested_intent,range(8)))
winner=run(f"select provider_intent_id from public.payment_attempt_intents where attempt_id='{attempts[2]}'")
assert all(result==(intent if intent==winner else 'CONFLICT') for intent,result in results)
print("PASS competing provider intents cannot replace one attempt association")
# Same scoped intent cannot cross-bind another booking even under concurrency.
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    futures=[pool.submit(associate,attempts[3],winner) for _ in range(8)]
    for f in futures:
        try:f.result();raise AssertionError('cross-attempt intent accepted')
        except RuntimeError as e:assert 'PAYMENT_INTENT_CONFLICT' in str(e)
assert run(f"select count(*) from public.payment_attempt_intents where attempt_id='{attempts[3]}'")=='0'
print("PASS concurrent cross-booking duplicate scoped intent rejected without association")

def cross_attempt_race(n):
    a=attempts[4+n%2]
    try:return a,associate(a,'pi_shared_race')
    except RuntimeError as e:
        if 'PAYMENT_INTENT_CONFLICT' not in str(e):raise
        return a,'CONFLICT'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(cross_attempt_race,range(8)))
winner=run("select attempt_id from public.payment_attempt_intents where provider_intent_id='pi_shared_race'")
assert winner in attempts[4:]
assert all(result==('pi_shared_race' if a==winner else 'CONFLICT') for a,result in results)
print("PASS simultaneous cross-attempt same scoped intent has one winner and no crossbinding")
