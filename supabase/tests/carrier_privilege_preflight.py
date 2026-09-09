#!/usr/bin/env python3
"""Rollback-only topology attacks against the exact additive migration body."""
import os, re, subprocess, uuid
from pathlib import Path

if os.environ.get('CARRIER_TEST_DISPOSABLE') != '1' or os.environ.get('PGHOST') not in ('localhost', '127.0.0.1') or not os.environ.get('PGDATABASE', '').startswith('lumin_'):
    raise SystemExit('Explicit disposable local PostgreSQL required')
base = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
migration = (Path(__file__).parent.parent / 'migrations/0024_carrier_direct_write_boundary.sql').read_text()
body = migration.replace('\nbegin;\n', '\n', 1).removesuffix('commit;\n')
assert body != migration and 'commit;' not in body

def run(sql, fail=None):
    p = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=15)
    if fail:
        assert p.returncode != 0 and re.search(r'ERROR:\s+55000:', p.stderr) and fail in p.stderr, p.stderr
    else:
        assert p.returncode == 0, p.stderr
    return p.stdout.strip()

fingerprint_sql = """select md5(string_agg(oid::text||prosrc||coalesce(proacl::text,''),'' order by oid)) from pg_proc where pronamespace in ('public'::regnamespace,'lumin'::regnamespace);
select md5(string_agg(oid::text||coalesce(relacl::text,''),'' order by oid)) from pg_class where relnamespace='public'::regnamespace;
select count(*) from pg_auth_members;"""
before = run(fingerprint_sql)
suffix = uuid.uuid4().hex
attacks = [
    ("grant update(status) on public.capacity_holds to service_role;", 'CARRIER_UNSUPPORTED_GRANT_TOPOLOGY'),
    ("grant insert(quantity) on public.resource_reservations to public;", 'CARRIER_UNSUPPORTED_GRANT_TOPOLOGY'),
    ("grant select on public.capacity_holds to service_role with grant option;", 'CARRIER_UNSUPPORTED_GRANT_TOPOLOGY'),
    (f"create role carrier_parent_{suffix} noinherit;grant carrier_parent_{suffix} to service_role;", 'CARRIER_UNSUPPORTED_ROLE_TOPOLOGY'),
    ("alter table public.capacity_holds owner to service_role;", 'CARRIER_UNSUPPORTED_TABLE_TOPOLOGY'),
    (f"create table public.carrier_child_{suffix} () inherits (public.resource_reservations);", 'CARRIER_UNSUPPORTED_TABLE_TOPOLOGY'),
]
for setup, failure in attacks:
    # An error exits this psql connection; PostgreSQL rolls back both fixture
    # topology and any partial migration changes. Never persist custom roles.
    run('begin;set local statement_timeout=\'10s\';' + setup + body + 'rollback;', failure)
    assert run(fingerprint_sql) == before, 'Failed preflight changed persistent privileges/functions'
    print('PASS rollback', failure)

# Exercise an upgrade-shaped table ACL, including PUBLIC privileges, without
# changing unrelated objects or rewriting any accepted function/ACL.
run("begin;grant all on public.capacity_holds,public.resource_reservations to service_role;grant update on public.capacity_holds to public;" + body + """
do $$begin
 if has_table_privilege('service_role','public.capacity_holds','UPDATE') or not has_table_privilege('service_role','public.capacity_holds','SELECT') then raise exception 'bad upgrade';end if;
end $$;
rollback;""")
assert run(fingerprint_sql) == before
print('PASS upgrade-shaped grant removal and full rollback; function/ACL fingerprints unchanged')
