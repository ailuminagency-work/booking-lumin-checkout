#!/usr/bin/env bash
# OFFLINE DISPOSABLE database only, after local_harness + 0001..0015.
# Explicit opt-in prevents accidental use against a linked/live Supabase project.
set -euo pipefail
[[ "${OUTBOX_TEST_DISPOSABLE:-}" == 1 ]] || { echo 'Set OUTBOX_TEST_DISPOSABLE=1'; exit 1; }
[[ "${PGHOST:-}" == 127.0.0.1 || "${PGHOST:-}" == localhost ]] || { echo 'Local host required'; exit 1; }
PSQL_BIN="${PSQL_BIN:-psql}"
run() { "$PSQL_BIN" -X -v ON_ERROR_STOP=1 -q -t -A "$@"; }
TENANT=$(run -c 'select gen_random_uuid()')
BOOKING=$(run -c 'select gen_random_uuid()')
DEDUP=$(run -c 'select gen_random_uuid()')
TENANT=${TENANT//$'\r'/}; BOOKING=${BOOKING//$'\r'/}; DEDUP=${DEDUP//$'\r'/}
OUT1=$(mktemp); OUT2=$(mktemp)
cleanup() {
 run <<SQL
 delete from public.durable_outbox where tenant_id='$TENANT';
 delete from public.bookings where id='$BOOKING' and tenant_id='$TENANT';
 delete from public.tenants where id='$TENANT';
SQL
 rm -f "$OUT1" "$OUT2"
}
trap cleanup EXIT
run <<SQL
insert into public.tenants(id,name,slug,timezone,currency) values('$TENANT','Outbox race','outbox-$TENANT','UTC','USD');
insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key)
values('$BOOKING','$TENANT','OUTBOX-RACE','2030-01-01T10:00Z','2030-01-01T11:00Z','outbox-concurrency-key');
SQL
wait_marker() {
 for _ in {1..100}; do
  if grep -q LOCK_HELD "$OUT1"; then return; fi
  sleep 0.02
 done
 echo 'Transaction barrier not reached'; exit 1
}
# Duplicate enqueue races on the same unique tenant/key; only one row persists.
run > "$OUT1" <<SQL &
begin;
set local role service_role;
select 'ID='||public.outbox_enqueue('$TENANT','$BOOKING','booking.requested','$DEDUP');
\echo LOCK_HELD
select pg_sleep(3);
commit;
SQL
P1=$!
wait_marker
run > "$OUT2" <<SQL &
set role service_role;
select 'ID='||public.outbox_enqueue('$TENANT','$BOOKING','booking.requested','$DEDUP');
SQL
P2=$!
wait "$P1"; wait "$P2"
[[ "$(grep '^ID=' "$OUT1")" == "$(grep '^ID=' "$OUT2")" ]] || { echo 'Dedup failed'; exit 1; }
: > "$OUT1"; : > "$OUT2"
# First lease holds its row lock while second transaction tries to claim it.
run > "$OUT1" <<SQL &
begin;
set local role service_role;
select 'CLAIMS='||count(*) from public.outbox_lease('$TENANT',1,60);
\echo LOCK_HELD
select pg_sleep(3);
commit;
SQL
P1=$!
wait_marker
run > "$OUT2" <<SQL &
set role service_role;
select 'CLAIMS='||count(*) from public.outbox_lease('$TENANT',1,60);
SQL
P2=$!
wait "$P2"; wait "$P1"
grep -q 'CLAIMS=1' "$OUT1" && grep -q 'CLAIMS=0' "$OUT2" || { echo 'Double lease'; exit 1; }
RESULT=$(run -c "select count(*)=1 and bool_and(attempts=1 and generation=1 and state='leased') from public.durable_outbox where tenant_id='$TENANT'")
[[ "${RESULT//$'\r'/}" == t ]] || { echo 'Persisted lease state failed'; exit 1; }
echo 'Outbox concurrency PASS: duplicate enqueue stable; locked lease skipped.'
