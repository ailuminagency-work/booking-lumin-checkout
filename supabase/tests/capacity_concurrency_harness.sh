#!/usr/bin/env bash
# ============================================================================
# capacity_concurrency_harness.sh — the REAL two-transaction final-slot race
# (RC-3 F1). capacity_tests.sql proves the sequential guarantee inside one
# session; this harness proves the CONCURRENT one: two live, OVERLAPPING
# transactions both call lumin.reserve_capacity for the SAME capacity-1 slot,
# and exactly one wins.
#
# Method: two psql sessions are launched simultaneously. Each does
#   BEGIN; SELECT reserve_capacity(<same slot>, <own booking>); pg_sleep(2); COMMIT;
# The transaction-scoped advisory lock in reserve_capacity forces the loser to
# BLOCK on the lock for the ~2s the winner holds its open transaction, so the
# two reservations genuinely overlap (not merely run back-to-back). Outcome
# asserted: exactly one GRANTED, one NO_CAPACITY, and exactly one 'active' hold.
#
# Usage: point it at a database (fresh Supabase or plain PG with 0001-0010 +
# local_harness.sql applied) via a psql-compatible connection:
#   PSQL="psql 'postgresql://...'" bash supabase/tests/capacity_concurrency_harness.sh
# or with discrete vars:
#   PGHOST=/sock PGPORT=5433 PGUSER=postgres PGDATABASE=lumin_test \
#     bash supabase/tests/capacity_concurrency_harness.sh
# ============================================================================
set -euo pipefail

PSQL_BIN="${PSQL_BIN:-psql}"
run() { $PSQL_BIN -v ON_ERROR_STOP=1 -q "$@"; }

TENANT='dddddddd-dddd-dddd-dddd-dddddddddddd'
SERVICE='d0000000-0000-0000-0000-000000000001'
CUST='d0000000-0000-0000-0000-0000000000c1'
B1='d0000000-0000-0000-0000-0000000000b1'
B2='d0000000-0000-0000-0000-0000000000b2'
SLOT_START='2026-02-02 16:00:00+00'   # a Monday
SLOT_END='2026-02-02 18:00:00+00'

cleanup() {
  run <<SQL || true
delete from public.capacity_holds where tenant_id = '$TENANT';
delete from public.bookings       where tenant_id = '$TENANT';
delete from public.customers      where tenant_id = '$TENANT';
delete from public.availability_rules where tenant_id = '$TENANT';
delete from public.services       where tenant_id = '$TENANT';
delete from public.tenant_members where tenant_id = '$TENANT';
delete from public.tenants        where id = '$TENANT';
delete from auth.users where id = 'd1111111-1111-1111-1111-111111111111';
SQL
}
trap cleanup EXIT

echo "[harness] seeding committed fixtures..."
cleanup
run <<SQL
insert into auth.users (id, email) values ('d1111111-1111-1111-1111-111111111111','cc-harness@example.test');
insert into public.tenants (id, name, slug, timezone, currency, status)
  values ('$TENANT','CC Tenant','cc-tenant','America/Chicago','USD','active');
insert into public.tenant_members (tenant_id, user_id, role)
  values ('$TENANT','d1111111-1111-1111-1111-111111111111','BUSINESS_OWNER');
insert into public.services (id, tenant_id, archetype, name, currency, base_price, duration_minutes)
  values ('$SERVICE','$TENANT','simple','Single Bay','USD',12000,120);
insert into public.availability_rules (tenant_id, service_id, weekday, start_minute, end_minute, capacity)
  values ('$TENANT','$SERVICE',1,540,1020,1);
insert into public.customers (id, tenant_id, name, email)
  values ('$CUST','$TENANT','CC Cust','cc@example.test');
insert into public.bookings (id, tenant_id, reference, state, selection, pricing, slot_start, slot_end, customer_id, idempotency_key)
  values ('$B1','$TENANT','LMN-CC0001','draft','{"serviceId":"$SERVICE"}','{}','$SLOT_START','$SLOT_END','$CUST','idem-cc-booking-0001'),
         ('$B2','$TENANT','LMN-CC0002','draft','{"serviceId":"$SERVICE"}','{}','$SLOT_START','$SLOT_END','$CUST','idem-cc-booking-0002');
SQL

reserve_tx() {  # $1 = booking id, $2 = out file
  $PSQL_BIN -v ON_ERROR_STOP=1 -t -A > "$2" 2>&1 <<SQL &
begin;
select result from lumin.reserve_capacity('$TENANT','$SERVICE','$SLOT_START','$SLOT_END','$1',1,interval '15 minutes');
select pg_sleep(2);
commit;
SQL
}

OUT1=$(mktemp); OUT2=$(mktemp)
echo "[harness] launching two overlapping reservations for the same last slot..."
reserve_tx "$B1" "$OUT1"; P1=$!
reserve_tx "$B2" "$OUT2"; P2=$!
wait "$P1"; wait "$P2"

R1=$(grep -Eo 'GRANTED|NO_CAPACITY' "$OUT1" | head -1 || true)
R2=$(grep -Eo 'GRANTED|NO_CAPACITY' "$OUT2" | head -1 || true)
echo "[harness] booking1 → ${R1:-<none>} ; booking2 → ${R2:-<none>}"
rm -f "$OUT1" "$OUT2"

GRANTED=0; NOCAP=0
[ "$R1" = "GRANTED" ] && GRANTED=$((GRANTED+1)); [ "$R1" = "NO_CAPACITY" ] && NOCAP=$((NOCAP+1))
[ "$R2" = "GRANTED" ] && GRANTED=$((GRANTED+1)); [ "$R2" = "NO_CAPACITY" ] && NOCAP=$((NOCAP+1))

ACTIVE=$($PSQL_BIN -t -A -c "select count(*) from public.capacity_holds where tenant_id='$TENANT' and status='active' and expires_at>now();")

FAIL=0
if [ "$GRANTED" -ne 1 ]; then echo "FAIL: expected exactly 1 GRANTED, got $GRANTED"; FAIL=1; fi
if [ "$NOCAP" -ne 1 ];   then echo "FAIL: expected exactly 1 NO_CAPACITY, got $NOCAP"; FAIL=1; fi
if [ "$ACTIVE" != "1" ]; then echo "FAIL: expected exactly 1 active hold, got $ACTIVE"; FAIL=1; fi

if [ "$FAIL" -eq 0 ]; then
  echo "=== CONCURRENCY HARNESS PASSED: exactly one winner, one active hold ==="
else
  echo "=== CONCURRENCY HARNESS FAILED ==="; exit 1
fi
