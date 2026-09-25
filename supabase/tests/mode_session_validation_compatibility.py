"""Explicitly gated, disposable-only comparison of the historical read RPC with current migrations.

Default mode is static fixture/path validation. --run requires two precreated empty local
databases, a deliberate opt-in, and a separate human verification of their disposability.
It never creates or drops databases and never connects without --run. The candidate SQL
is a test fixture, not a migration or production release recommendation.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase/migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))
HERE = Path(__file__).resolve().parent
CANDIDATE = HERE / "fixtures/mode_session_validation_candidate.sql"
FIXTURE = HERE / "fixtures/mode_session_validation_compatibility.sql"
SIGNATURE = "public.mode_validate_existing_flow_session(text,uuid,uuid,text,text,text,uuid,bigint,bigint,timestamp with time zone,timestamp with time zone)"
CANDIDATE_SHA256 = "e6ddd08cd77a7c96d1316d89d02389a01bd21fe764a730c97dbbe1c8c15a696d"


def check_sources() -> None:
    if len(MIGRATIONS) != 31 or [int(p.name[:4]) for p in MIGRATIONS] != list(range(1, 32)) or MIGRATIONS[-1].name != "0031_overbooking_backstop.sql":
        raise RuntimeError("Accepted migration inventory changed")
    if not CANDIDATE.is_file() or not FIXTURE.is_file():
        raise RuntimeError("Compatibility fixtures missing")
    candidate = CANDIDATE.read_text(encoding="utf-8")
    if hashlib.sha256(CANDIDATE.read_bytes()).hexdigest() != CANDIDATE_SHA256:
        raise RuntimeError("Historical validator candidate bytes changed")
    if "create function public.mode_validate_existing_flow_session(" not in candidate or "mode_issue_flow_session(" in candidate or "grant execute on function public.mode_validate_existing_flow_session" not in candidate:
        raise RuntimeError("Candidate fixture changed outside validation-only scope")
    print("Static compatibility fixture and accepted-migration inventory: PASS; no database connection")


def guarded(args: argparse.Namespace) -> None:
    if os.environ.get("LUMIN_MODE_VALIDATION_DISPOSABLE") != "I_VERIFIED_BOTH_EMPTY_LOCAL_DATABASES":
        raise SystemExit("Refusing SQL: explicit disposable opt-in is absent")
    if os.environ.get("PGHOST") not in ("127.0.0.1", "localhost") or os.environ.get("PGUSER") != "postgres":
        raise SystemExit("Refusing SQL: local postgres host and superuser are required")
    if not re.fullmatch(r"[1-9][0-9]{0,4}", os.environ.get("PGPORT", "")) or int(os.environ["PGPORT"]) > 65535:
        raise SystemExit("Refusing SQL: explicit local port required")
    if any(os.environ.get(name) for name in ("DATABASE_URL", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGOPTIONS")):
        raise SystemExit("Refusing SQL: ambient connection override present")
    if os.environ.get("PGPASSWORD") not in (None, "", "postgres"):
        raise SystemExit("Refusing SQL: unexpected password value")
    if not re.fullmatch(r"lumin_mode_validation_compat_public_[a-z0-9_]{1,24}", args.public_db) or not re.fullmatch(r"lumin_mode_validation_compat_extensions_[a-z0-9_]{1,24}", args.extensions_db):
        raise SystemExit("Refusing SQL: two distinct, explicitly named disposable databases required")
    if shutil.which("psql") is None:
        raise SystemExit("psql unavailable; SQL not executed")


def command(db: str, *tail: str) -> list[str]:
    return ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", os.environ["PGHOST"], "-p", os.environ["PGPORT"], "-U", "postgres", "-d", db, *tail]


def sql(db: str, statement: str) -> str:
    result = subprocess.run(command(db, "-At", "-c", statement), text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f"SQL step failed in {db}: {result.stderr[-1000:]}")
    return result.stdout.strip()


def file(db: str, path: Path) -> None:
    result = subprocess.run(command(db, "-f", str(path)), text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f"Fixture step {path.name} failed in {db}: {result.stderr[-1000:]}")


def start(db: str, app: str, statement: str) -> subprocess.Popen[str]:
    return subprocess.Popen(command(db, "-At", "-c", f"begin; set local application_name='{app}'; {statement}"), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def observed(db: str, app: str, event: str, process: subprocess.Popen[str]) -> None:
    if event not in ("Lock", "Timeout"):
        raise RuntimeError("Unsupported wait observation")
    deadline = time.monotonic() + 4
    query = f"select count(*)=1 from pg_stat_activity where datname=current_database() and application_name='{app}' and state='active'"
    query += f" and wait_event_type='{event}'"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            finish(process, f"{app} before observed {event} wait")
            raise RuntimeError(f"{app} completed before required {event} wait")
        if sql(db, query) == "t": return
        time.sleep(0.05)
    raise RuntimeError(f"Did not observe {event} wait for {app}")


def finish(process: subprocess.Popen[str], label: str) -> str:
    try:
        out, err = process.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise RuntimeError(f"{label} did not finish")
    if process.returncode:
        raise RuntimeError(f"{label} failed: {err[-1000:]}")
    return out.strip()


def observed_blocked_by(db: str, waiter_app: str, holder_app: str, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 3
    query = f"""select count(*)=1 from pg_stat_activity w
      join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid))
      where w.datname=current_database() and w.application_name='{waiter_app}'
      and w.state='active' and w.wait_event_type='Lock'
      and h.datname=current_database() and h.application_name='{holder_app}'"""
    while time.monotonic() < deadline:
        if process.poll() is not None:
            finish(process, f"{waiter_app} before identified lock wait")
            raise RuntimeError(f"{waiter_app} completed before identified lock wait")
        if sql(db, query) == "t": return
        time.sleep(0.05)
    raise RuntimeError(f"Did not observe {waiter_app} blocked by {holder_app}")


PROTOCOL = "set local transaction isolation level read committed; set local statement_timeout='5s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='1s';"
CALL = "public.mode_validate_existing_flow_session(f.token_hash,f.session_id,f.installation_id,'https://renderer.test','https://merchant.test','compat-unit',f.version_id,1,1,f.issued_at,f.expires_at)"
STATE = """select jsonb_build_object(
 'sessions',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mode_flow_sessions t),
 'requests',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mode_flow_requests t),
 'bookings',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.bookings t),
 'customers',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.customers t),
 'installations',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mode_flow_installations t),
 'history',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.mode_flow_installation_history t))"""


def test_sql(db: str) -> None:
    signature = sql(db, f"select to_regprocedure('{SIGNATURE}') is not null")
    if signature != "t": raise RuntimeError("Exact validator signature absent")
    grants = sql(db, f"select has_function_privilege('service_role','{SIGNATURE}','EXECUTE') and not has_function_privilege('anon','{SIGNATURE}','EXECUTE') and not has_function_privilege('authenticated','{SIGNATURE}','EXECUTE')")
    if grants != "t": raise RuntimeError("Service-only grants missing")
    isolation = sql(db, """select c.relrowsecurity and c.relforcerowsecurity
      and not has_table_privilege('service_role','public.mode_flow_sessions','SELECT')
      and not has_table_privilege('anon','public.mode_flow_sessions','SELECT')
      and not has_table_privilege('authenticated','public.mode_flow_sessions','SELECT')
      from pg_class c where c.oid='public.mode_flow_sessions'::regclass""")
    if isolation != "t": raise RuntimeError("Session RLS or direct-table privilege boundary missing")
    # Build quoted literals inside PostgreSQL; the call itself executes under service_role.
    service_call = sql(db, """select format(
      'select public.mode_validate_existing_flow_session(%L::text,%L::uuid,%L::uuid,%L::text,%L::text,%L::text,%L::uuid,%L::bigint,%L::bigint,%L::timestamptz,%L::timestamptz)',
      f.token_hash,f.session_id,f.installation_id,'https://renderer.test','https://merchant.test','compat-unit',f.version_id,1,1,f.issued_at,f.expires_at)
      from compat_test.fixture f where tenant_id='e1000000-0000-4000-8000-000000000002'""")
    service_receipt = sql(db, f"begin; {PROTOCOL} set local role service_role; {service_call}; rollback;")
    expected_receipt = sql(db, "select issue_receipt from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002'")
    if service_receipt != expected_receipt: raise RuntimeError("service_role returned wrong existing receipt")
    denied = subprocess.run(command(db, "-At", "-c", f"begin; {PROTOCOL} set local role service_role; select count(*) from public.mode_flow_sessions; rollback;"), text=True, capture_output=True, timeout=30)
    if denied.returncode == 0 or "permission denied" not in denied.stderr.lower():
        raise RuntimeError("service_role direct session-table read was not denied")
    # This is a selected relational snapshot, not proof that every database table is unchanged.
    before = sql(db, STATE)
    tests = f"""
begin; {PROTOCOL}
do $test$ declare f compat_test.fixture; foreign_row compat_test.fixture; got jsonb;
begin
 select * into f from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002';
 select * into foreign_row from compat_test.fixture where tenant_id='e2000000-0000-4000-8000-000000000002';
 got:={CALL};
 if got is distinct from f.issue_receipt then raise exception 'EXISTING_RECEIPT_MISMATCH';end if;
 begin perform public.mode_validate_existing_flow_session(f.token_hash,foreign_row.session_id,f.installation_id,'https://renderer.test','https://merchant.test','compat-unit',f.version_id,1,1,f.issued_at,f.expires_at);raise exception 'FORGED_SESSION_ACCEPTED';
 exception when insufficient_privilege then null;end;
 begin perform public.mode_validate_existing_flow_session(f.token_hash,f.session_id,foreign_row.installation_id,'https://renderer.test','https://merchant.test','compat-unit',f.version_id,1,1,f.issued_at,f.expires_at);raise exception 'CROSS_TENANT_ACCEPTED';
 exception when insufficient_privilege then null;end;
 begin perform public.mode_validate_existing_flow_session(f.token_hash,f.session_id,f.installation_id,'https://api.test','https://merchant.test','compat-unit',f.version_id,1,1,f.issued_at,f.expires_at);raise exception 'FORGED_ORIGIN_ACCEPTED';
 exception when insufficient_privilege then null;end;
 begin perform public.mode_validate_existing_flow_session(f.token_hash,f.session_id,f.installation_id,'https://renderer.test','https://merchant.test','compat-unit',foreign_row.version_id,1,1,f.issued_at,f.expires_at);raise exception 'FORGED_VERSION_ACCEPTED';
 exception when insufficient_privilege then null;end;
 begin perform public.mode_validate_existing_flow_session(f.token_hash,f.session_id,f.installation_id,'https://renderer.test','https://merchant.test','compat-unit',f.version_id,1,1,f.issued_at,f.expires_at+interval '1 second');raise exception 'FORGED_EXPIRY_ACCEPTED';
 exception when sqlstate '22023' then null;end;
end $test$;
rollback;
"""
    sql(db, tests)
    after = sql(db, STATE)
    if before != after: raise RuntimeError("Validation changed selected persistent state")

    # Synthetic expiry is confined to a rolled-back transaction in the disposable DB.
    expiry = f"""begin; {PROTOCOL}
    alter table public.mode_flow_sessions disable trigger mode_session_immutable;
    update public.mode_flow_sessions set expires_at=transaction_timestamp()-interval '1 second',issued_at=transaction_timestamp()-interval '15 minutes 1 second'
    where id=(select session_id from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002');
    alter table public.mode_flow_sessions enable trigger mode_session_immutable;
    do $expired$ declare f compat_test.fixture; begin
      select * into f from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002';
      select s.issued_at,s.expires_at into f.issued_at,f.expires_at
        from public.mode_flow_sessions s where s.id=f.session_id;
      begin perform {CALL};raise exception 'EXPIRED_SESSION_ACCEPTED';
      exception when sqlstate '42501' then
        if sqlerrm <> 'MODE_SESSION_FORBIDDEN' then raise; end if;
      end;
    end $expired$; rollback;"""
    sql(db, expiry)


def expiry_during_lock_wait(db: str) -> None:
    # A privileged synthetic INSERT is committed before either actor starts.
    # One captured clock value makes the immutable row's 15-minute span exact.
    inserted = sql(db, """with stamp as (select clock_timestamp() as at),
      source as (select s.* from public.mode_flow_sessions s
        join compat_test.fixture f on f.session_id=s.id
        where f.tenant_id='e1000000-0000-4000-8000-000000000002'),
      created as (insert into public.mode_flow_sessions
        (token_hash,tenant_id,flow_id,installation_id,version_id,service_id,mode,
         profile_version,renderer_origin,parent_origin,target_revision,policy_revision,
         issued_history_sequence,issued_at,expires_at)
       select repeat('c',64),s.tenant_id,s.flow_id,s.installation_id,s.version_id,
         s.service_id,s.mode,s.profile_version,s.renderer_origin,s.parent_origin,
         s.target_revision,s.policy_revision,s.issued_history_sequence,
         stamp.at-interval '14 minutes 57 seconds',stamp.at+interval '3 seconds'
       from source s cross join stamp returning id,token_hash,expires_at)
      insert into compat_test.expiry_race(session_id,token_hash,expires_at)
      select id,token_hash,expires_at from created returning session_id""")
    if not re.fullmatch(r"[0-9a-f-]{36}", inserted):
        raise RuntimeError("Near-expiry fixture insert did not return one session")
    before = sql(db, STATE)
    holder_statement = f"""{PROTOCOL}
      select id from public.mode_flow_sessions
      where id=(select session_id from compat_test.expiry_race) for update;
      select pg_sleep(4); commit;"""
    holder = start(db, "compat_expiry_holder", holder_statement)
    waiter = None
    waiter_result = None
    try:
        observed(db, "compat_expiry_holder", "Timeout", holder)
        waiter_statement = f"""{PROTOCOL}
          do $race$ declare f compat_test.fixture; race compat_test.expiry_race;
          begin
            select * into f from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002';
            select * into race from compat_test.expiry_race;
            f.token_hash:=race.token_hash; f.session_id:=race.session_id;
            select issued_at,expires_at into f.issued_at,f.expires_at
              from public.mode_flow_sessions where id=race.session_id;
            if clock_timestamp()>=f.expires_at then
              raise exception 'RACE_EXPIRED_BEFORE_INVOCATION';
            end if;
            begin perform {CALL}; raise exception 'EXPIRED_WAIT_ACCEPTED';
            exception when sqlstate '42501' then
              if sqlerrm <> 'MODE_SESSION_FORBIDDEN' then raise; end if;
            end;
          end $race$;
          select 'EXPECTED_42501_MODE_SESSION_FORBIDDEN'; rollback;"""
        waiter = start(db, "compat_expiry_waiter", waiter_statement)
        observed_blocked_by(db, "compat_expiry_waiter", "compat_expiry_holder", waiter)
        if sql(db, "select clock_timestamp()<expires_at from compat_test.expiry_race") != "t":
            raise RuntimeError("Expiry passed before the identified lock wait was observed")
        # The row was inserted with a three-second future expiry. This observer
        # budget spans that full interval; it does not extend either SQL lock.
        deadline = time.monotonic() + 4
        while sql(db, "select clock_timestamp()>=expires_at from compat_test.expiry_race") != "t":
            if waiter.poll() is not None:
                finish(waiter, "expiry waiter before expiry")
                raise RuntimeError("Expiry waiter completed before expiry while blocked")
            if time.monotonic() >= deadline:
                raise RuntimeError("Session did not expire while lock was held")
            time.sleep(0.05)
        observed_blocked_by(db, "compat_expiry_waiter", "compat_expiry_holder", waiter)
    finally:
        try:
            finish(holder, "expiry lock holder")
        finally:
            if waiter is not None:
                waiter_result = finish(waiter, "expiry validator")
    if waiter is None:
        raise RuntimeError("Expiry validator never started")
    if waiter_result != "EXPECTED_42501_MODE_SESSION_FORBIDDEN":
        raise RuntimeError("Expiry validator did not prove exact forbidden result")
    if sql(db, STATE) != before:
        raise RuntimeError("Expiry race changed selected persistent state beyond fixture setup")


def rotation(db: str) -> None:
    # Read-before-rotation: a held read lock makes apply wait. The old pin still
    # validates after the target version changes because policy/origin remain valid.
    read_first = f"{PROTOCOL} select {CALL} from compat_test.fixture f where f.tenant_id='e1000000-0000-4000-8000-000000000002'; select pg_sleep(2); commit;"
    process = start(db, "compat_read_first", read_first)
    try:
        observed(db, "compat_read_first", "Timeout", process)
        apply_first = """set local statement_timeout='5s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='1s';
        select public.mode_apply_flow_version('e1000000-0000-4000-8000-000000000001',f.tenant_id,f.flow_id,f.installation_id,1,f.version_id,f.rotation_version_id,'compat_apply_001')
        from compat_test.fixture f where f.tenant_id='e1000000-0000-4000-8000-000000000002'; commit;"""
        waiter = start(db, "compat_rotate_waiter", apply_first)
        observed(db, "compat_rotate_waiter", "Lock", waiter)
    finally:
        finish(process, "read-before-rotation holder")
    finish(waiter, "read-before-rotation waiter")
    expect_installation(db, "rotation_version_id", 2)
    old_receipt = f"""begin; {PROTOCOL} do $old$ declare f compat_test.fixture;begin
      select * into f from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002';
      if {CALL} is distinct from f.issue_receipt then raise exception 'OLD_PIN_LOST_AFTER_ROTATION';end if;
    end $old$;rollback;"""
    sql(db, old_receipt)

    # Rotation-before-read: hold the installation update open so validation must
    # rediscover current authority after it commits. Same receipt is expected.
    rotate_first = """set local statement_timeout='5s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='1s';
      select public.mode_apply_flow_version('e1000000-0000-4000-8000-000000000001',f.tenant_id,f.flow_id,f.installation_id,2,f.rotation_version_id,f.concurrent_version_id,'compat_apply_002')
      from compat_test.fixture f where f.tenant_id='e1000000-0000-4000-8000-000000000002'; select pg_sleep(2); commit;"""
    process = start(db, "compat_rotate_first", rotate_first)
    try:
        observed(db, "compat_rotate_first", "Timeout", process)
        waiter = start(db, "compat_read_waiter", old_receipt.replace("begin;", "", 1))
        observed(db, "compat_read_waiter", "Lock", waiter)
    finally:
        finish(process, "rotation-before-read holder")
    finish(waiter, "rotation-before-read waiter")
    expect_installation(db, "concurrent_version_id", 3)


def expect_installation(db: str, fixture_column: str, revision: int) -> None:
    if fixture_column not in ("rotation_version_id", "concurrent_version_id"):
        raise RuntimeError("Unsupported expected version column")
    correct = sql(db, f"""select i.current_version_id=f.{fixture_column} and i.target_revision={revision}
      from public.mode_flow_installations i join compat_test.fixture f on f.installation_id=i.id
      where f.tenant_id='e1000000-0000-4000-8000-000000000002'""")
    if correct != "t": raise RuntimeError("Committed installation version or target revision mismatch")


def concurrent_disable(db: str) -> None:
    holder = f"{PROTOCOL} select id from public.tenants where id='e1000000-0000-4000-8000-000000000002' for update; update public.tenants set status='inactive' where id='e1000000-0000-4000-8000-000000000002'; select pg_sleep(2); commit;"
    process = start(db, "compat_disable_first", holder)
    try:
        observed(db, "compat_disable_first", "Timeout", process)
        test = f"""{PROTOCOL} do $wait$ declare f compat_test.fixture; begin
        select * into f from compat_test.fixture where tenant_id='e1000000-0000-4000-8000-000000000002';
        begin perform {CALL}; raise exception 'STALE_GRANT_AFTER_DISABLE';
        exception when insufficient_privilege then null;end;end $wait$; rollback;"""
        waiter = start(db, "compat_disable_waiter", test)
        observed(db, "compat_disable_waiter", "Lock", waiter)
    finally:
        finish(process, "concurrent disable holder")
    finish(waiter, "concurrent disable waiter")
    if sql(db, "select status='inactive' from public.tenants where id='e1000000-0000-4000-8000-000000000002'") != "t":
        raise RuntimeError("Tenant disable did not commit")


def run(args: argparse.Namespace) -> None:
    guarded(args)
    # Check both targets before making any change in either database. The role
    # prerequisites avoid cluster-global CREATE ROLE side effects in local_harness.sql.
    roles = sql(args.public_db, "select count(*)=3 from pg_roles where rolname in ('anon','authenticated','service_role')")
    if roles != "t": raise RuntimeError("Required local roles absent; refusing cluster-global role creation")
    for layout, db in (("public", args.public_db), ("extensions", args.extensions_db)):
        empty = sql(db, """select
          not exists(select 1 from pg_namespace where nspname not in ('public','information_schema') and nspname not like 'pg_%')
          and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
          and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
          and not exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('c','e','d','r','m'))
          and not exists(select 1 from pg_extension where extname<>'plpgsql')""")
        if empty != "t":
            raise RuntimeError(f"{db} is not empty; refusing setup")
    for layout, db in (("public", args.public_db), ("extensions", args.extensions_db)):
        if layout == "extensions":
            sql(db, "create schema extensions; create extension pgcrypto with schema extensions")
        else:
            sql(db, "create extension pgcrypto with schema public")
        file(db, HERE / "local_harness.sql")
        for migration in MIGRATIONS:
            file(db, migration)
        file(db, CANDIDATE)
        file(db, FIXTURE)
        test_sql(db)
        expiry_during_lock_wait(db)
        rotation(db)
        concurrent_disable(db)
        print(f"{layout}: candidate signature, grants, receipt, selected-state unchanged and adversarial checks PASS; observed lock ordering only in disposable {db}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Execute only after separate disposable-database verification")
    parser.add_argument("--public-db", default="")
    parser.add_argument("--extensions-db", default="")
    args = parser.parse_args()
    check_sources()
    if args.run:
        run(args)


if __name__ == "__main__":
    main()
