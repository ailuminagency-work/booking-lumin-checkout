"""Run ONLY against an already-migrated disposable DB. No credentials/providers.
Uses explicit loopback PGHOST + PGPORT + PGDATABASE; writes retained test fixtures.
"""
import os, subprocess, concurrent.futures, re, ipaddress
if os.environ.get("PAYMENT_SOURCE_DISPOSABLE") != "1":
    raise SystemExit("Set PAYMENT_SOURCE_DISPOSABLE=1 for owned disposable database only")
if os.environ.get("PGHOST") not in ("127.0.0.1", "localhost"):
    raise SystemExit("Loopback-only fixture")
port = os.environ.get("PGPORT", "")
if not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535:
    raise SystemExit("Explicit bounded numeric PGPORT required")
if not re.fullmatch(r"lumin_source_binding_[a-z0-9_]+", os.environ.get("PGDATABASE", "")):
    raise SystemExit("Expected dedicated lumin_source_binding_ disposable database")
if os.environ.get("PGUSER") != "postgres":
    raise SystemExit("Explicit disposable postgres admin required")
env = os.environ.copy()
for k in ("PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS", "PGHOSTADDR", "DATABASE_URL"):
    env.pop(k, None)
psql = os.environ.get("PSQL_BIN", "psql")
def run(sql):
    p = subprocess.run([psql, "-X", "-v", "ON_ERROR_STOP=1", "-qAtc", sql], env=env,
                       text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()
identity = run("select host(inet_server_addr())||'|'||inet_server_port()||'|'||current_database()||'|'||current_user")
parts = identity.split("|")
# Docker's loopback-published PostgreSQL sees its private container address.
# Client endpoint remains explicitly loopback; verify server address and identity.
allowed = tuple(ipaddress.ip_network(n) for n in ("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
if len(parts) != 4 or not any(ipaddress.ip_address(parts[0]) in n for n in allowed) or parts[1:] != [str(int(port)), env["PGDATABASE"], "postgres"]:
    raise SystemExit("Disposable server identity mismatch; no fixture writes performed")
T = "a1020000-1111-4000-8000-000000000001"
B = "a1020000-1111-4000-8000-000000000002"
run(f"""insert into public.tenants(id,name,slug,timezone,currency) values
('{T}','Concurrent source','concurrent-source','UTC','USD');
insert into public.payment_connections(tenant_id,provider,status,account_id,charges_enabled)
values('{T}','stripe_connect','connected','acct_concurrentA',true);
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key)
values('{B}','{T}','CONCURRENT',now(),now()+interval '1 hour','source-concurrent-key');""")
# Actual independent DB sessions race scope registration, then booking binding.
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    scopes = list(pool.map(lambda _: run(f"set role service_role;select id from public.register_payment_source_scope('{T}','acct_platformA',false)"), range(8)))
assert len(set(scopes)) == 1, scopes
S = scopes[0]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    attempts = list(pool.map(lambda _: run(f"set role service_role;select id from public.bind_booking_payment_source('{T}','{B}','{S}')"), range(8)))
assert len(set(attempts)) == 1, attempts
assert run(f"select count(*) from public.booking_payment_attempt_sources where booking_id='{B}'") == "1"
assert run(f"select count(*) from public.payment_source_scopes where tenant_id='{T}'") == "1"
print("PASS eight concurrent scope registrations and eight duplicate attempt bindings converge")

B2 = "a1020000-1111-4000-8000-000000000003"
run(f"insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values('{B2}','{T}','CONFLICT-RACE',now(),now()+interval '1 hour','source-conflict-race-key')")
S2 = run(f"set role service_role;select id from public.register_payment_source_scope('{T}','acct_platformA',true)")
def conflict_bind(n):
    source = S if n % 2 == 0 else S2
    try:
        return (source, run(f"set role service_role;select source_scope_id from public.bind_booking_payment_source('{T}','{B2}','{source}')"))
    except RuntimeError as e:
        if "PAYMENT_SOURCE_CONFLICT" not in str(e):
            raise
        return (source, "CONFLICT")
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(conflict_bind, range(8)))
winner = run(f"select source_scope_id from public.booking_payment_attempt_sources where booking_id='{B2}'")
assert winner in (S, S2)
assert all(result == (source if source == winner else "CONFLICT") for source, result in results), results
assert run(f"select count(*) from public.booking_payment_attempt_sources where booking_id='{B2}'") == "1"
print("PASS mixed-mode concurrent first bind has one immutable winner; alternate source denied")
