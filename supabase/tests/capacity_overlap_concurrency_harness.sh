#!/usr/bin/env bash
# Disposable local database ONLY: local_harness + active migrations applied.
# PG* env variables select that database; PSQL_BIN selects the psql executable.
# Returns nonzero for the pre-0014 double-grant defect. No real providers.
set -euo pipefail
PSQL_BIN="${PSQL_BIN:-psql}"
run() { "$PSQL_BIN" -X -v ON_ERROR_STOP=1 -q "$@"; }
TENANT='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
SERVICE='e0000000-0000-0000-0000-000000000001'
RESOURCE='e0000000-0000-0000-0000-000000000002'
CUST='e0000000-0000-0000-0000-0000000000c1'
B1='e0000000-0000-0000-0000-0000000000b1'
B2='e0000000-0000-0000-0000-0000000000b2'
TMP=$(mktemp -d)
P1=''; P2=''
cleanup() {
  # Wait for children before deleting committed fixtures, including failure paths.
  if [ -n "$P1" ]; then wait "$P1" || true; fi
  if [ -n "$P2" ]; then wait "$P2" || true; fi
  run -c "delete from public.tenants where id='$TENANT';" || true
  rm -rf "$TMP"
}
trap cleanup EXIT
run <<SQL
insert into public.tenants (id,name,slug,timezone,currency,status)
values ('$TENANT','Overlap harness','overlap-harness','UTC','USD','active');
insert into public.services (id,tenant_id,archetype,name,currency,base_price,duration_minutes)
values ('$SERVICE','$TENANT','simple','Overlap service','USD',1000,120);
insert into public.resources (id,tenant_id,name,capacity) values ('$RESOURCE','$TENANT','Exclusive resource',1);
insert into public.customers (id,tenant_id,name,email) values ('$CUST','$TENANT','Fixture','fixture@example.test');
insert into public.bookings (id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,customer_id,idempotency_key)
values ('$B1','$TENANT','LMN-OV0001','draft','{"serviceId":"$SERVICE"}','{}','2030-02-04 16:00+00','2030-02-04 18:00+00','$CUST','overlap-booking-0001'),
       ('$B2','$TENANT','LMN-OV0002','draft','{"serviceId":"$SERVICE"}','{}','2030-02-04 17:00+00','2030-02-04 19:00+00','$CUST','overlap-booking-0002');
SQL

reserve_sql() {
  if [ "$1" = capacity ]; then
    echo "select result from lumin.reserve_capacity('$TENANT','$SERVICE','$3','$4','$2',1,interval '15 minutes');"
  else
    echo "select result from lumin.reserve_resource('$TENANT','$RESOURCE','$3','$4','$2',interval '15 minutes');"
  fi
}
FAIL=0
race() {
  local kind="$1" label="$2" second_start="$3" second_zone="$4"
  run -c "delete from public.capacity_holds where tenant_id='$TENANT'; delete from public.resource_reservations where tenant_id='$TENANT';"
  run -t -A > "$TMP/first" 2>&1 <<SQL &
set application_name = 'lumin-overlap-first';
set statement_timeout = '10s';
set timezone = 'UTC';
begin isolation level read committed;
$(reserve_sql "$kind" "$B1" '2030-02-04 16:00+00' '2030-02-04 18:00+00')
select pg_sleep(3);
select 'COMMIT_AT=' || extract(epoch from clock_timestamp());
commit;
SQL
  P1=$!
  # Observe the first session sleeping AFTER its reservation while still in its
  # open transaction. This removes the false-green sequential-start possibility.
  local ready=0
  for attempt in {1..100}; do
    if [ "$(run -t -A -c "select count(*) from pg_stat_activity where datname=current_database() and application_name='lumin-overlap-first' and wait_event='PgSleep' and xact_start is not null;")" = 1 ]; then ready=1; break; fi
    sleep 0.02
  done
  if [ "$ready" != 1 ]; then cat "$TMP/first"; echo 'FAIL: first transaction never reached overlap barrier'; exit 1; fi
  run -t -A > "$TMP/second" 2>&1 <<SQL &
set statement_timeout = '10s';
set timezone = '$second_zone';
begin isolation level read committed;
select extract(epoch from transaction_timestamp());
$(reserve_sql "$kind" "$B2" "$second_start" '2030-02-04 19:00+00')
commit;
SQL
  P2=$!
  wait "$P1"; P1=''
  wait "$P2"; P2=''
  tr -d '\r' < "$TMP/first" > "$TMP/first-clean"
  tr -d '\r' < "$TMP/second" > "$TMP/second-clean"
  local granted denied active
  local committed started
  committed=$(sed -n 's/^COMMIT_AT=//p' "$TMP/first-clean")
  started=$(grep -E '^[0-9]+\.[0-9]+$' "$TMP/second-clean")
  if ! awk -v started="$started" -v committed="$committed" 'BEGIN {exit !(started+0>0 && committed+0>started+0)}'; then
    echo "FAIL: sessions did not overlap"; exit 1
  fi
  granted=$({ grep -h -c '^GRANTED$' "$TMP/first-clean" "$TMP/second-clean" || true; } | awk '{s+=$1} END {print s}')
  denied=$({ grep -h -c '^NO_CAPACITY$' "$TMP/first-clean" "$TMP/second-clean" || true; } | awk '{s+=$1} END {print s}')
  if [ "$kind" = capacity ]; then
    active=$(run -t -A -c "select count(*) from public.capacity_holds where tenant_id='$TENANT' and status='active' and expires_at>now();")
  else
    active=$(run -t -A -c "select count(*) from public.resource_reservations where tenant_id='$TENANT' and status='held' and expires_at>now();")
  fi
  if [ "$granted" = 1 ] && [ "$denied" = 1 ] && [ "$active" = 1 ]; then
    echo "PASS: $kind $label (one grant, one denial, one hold)"
  else
    echo "FAIL: $kind $label (granted=$granted denied=$denied holds=$active)"; FAIL=1
  fi
}
race capacity different-start '2030-02-04 17:00+00' UTC
race resource different-start '2030-02-04 17:00+00' UTC
race capacity different-timezone '2030-02-04 16:00+00' America/Los_Angeles
race resource different-timezone '2030-02-04 16:00+00' Asia/Tokyo
exit "$FAIL"
