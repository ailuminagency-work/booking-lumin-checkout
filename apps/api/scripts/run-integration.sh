#!/usr/bin/env bash
# @lumin/api pg-backed acceptance harnesses (NOT part of `npm test`).
#
# These are standalone tsx scripts (top-level `await` + node:assert), not vitest
# tests. This runner provisions a throwaway, loopback-only PostgreSQL database,
# applies the local harness + migrations 0001-0031, and runs the flow-BFF
# acceptance harnesses that exercise the RELOCATED production BFF
# (createFlowHttpServer + createFlowRepository).
#
# Portable pair run here (both must pass):
#   - pg-http.integration.ts     (owner/customer flow HTTP journey, CAS, idempotency)
#   - roster-http.integration.ts (roster provision/edit/snapshot over HTTP)
#
# DEFERRED (run manually; each needs its own disposable DB name + crypto-layout
# env + raw TCP sockets / backend-PID observation that CI cannot supply reliably):
#   - mode-flow-session.integration.ts        (lumin_mode_session_*)
#   - mode-installations.integration.ts       (lumin_installation_s1_*)
#   - mode-installation-transport.integration.ts (lumin_installation_s1_transport_*, sockets)
#   - mode-session-transport.integration.ts   (lumin_mode_session_transport_*, sockets)
#   - mode-owner-journey.integration.ts       (lumin_mode_owner_journey_*, http proxy)
#   - planning-allocation.integration.ts      (lumin_allocator_transport_*, group_lifecycle fixture)
set -euo pipefail
cd "$(dirname "$0")/.."          # apps/api
ROOT="$(cd ../.. && pwd)"        # repo root

export PGHOST="${PGHOST:-localhost}"
export PGUSER="${PGUSER:-postgres}"
DB="lumin_r2a_$$_$(date +%s)"

cleanup() { psql -q -c "drop database if exists ${DB} with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== provisioning disposable database ${DB} =="
psql -q -c "create database ${DB}"
psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "${ROOT}/supabase/tests/local_harness.sql"
for m in "${ROOT}"/supabase/migrations/0*.sql; do
  psql -q -d "${DB}" -v ON_ERROR_STOP=1 -f "$m"
done

export PGDATABASE="${DB}" LOCAL_HARNESS=1 FLOW_TEST_DISPOSABLE=1
TSX="${ROOT}/node_modules/.bin/tsx"

status=0
for harness in src/pg-http.integration.ts src/roster-http.integration.ts; do
  echo "== running ${harness} =="
  if ! "${TSX}" "${harness}"; then
    echo "FAIL: ${harness}"
    status=1
  fi
done
exit "${status}"
