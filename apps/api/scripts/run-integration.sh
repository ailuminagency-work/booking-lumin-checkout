#!/usr/bin/env bash
# @lumin/api pg-backed acceptance harnesses (NOT part of `npm test`).
#
# These are standalone tsx scripts (top-level `await` + node:assert), not vitest
# tests. This runner provisions a throwaway, loopback-only PostgreSQL database,
# applies the local harness + all checked-in migrations, and runs the flow-BFF
# acceptance harnesses that exercise the RELOCATED production BFF
# (createFlowHttpServer + createFlowRepository).
#
# Portable harnesses run here (all must pass):
#   - pg-http.integration.ts     (owner/customer flow HTTP journey, CAS, idempotency)
#   - roster-http.integration.ts (roster provision/edit/snapshot over HTTP)
#   - phase-a-golden.integration.ts (first complete housekeeping adapter flow:
#     profile, availability, draft, hold, fake payment and atomic confirmation)
#   - phase-a-health.integration.ts (factory-bound local health contract and
#     route-boundary checks; hosted readiness remains a separate gate)
# The golden flow checks sequential replay and tenant isolation, not concurrent
# contention, browser behavior, hosted identity or real payment providers.
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

# The golden adapter harness requires canonical IPv4 loopback, not an alias.
case "${PGHOST:-127.0.0.1}" in
  127.0.0.1|localhost) export PGHOST=127.0.0.1 ;;
  *) echo "PGHOST must be IPv4 loopback (127.0.0.1 or localhost)" >&2; exit 1 ;;
esac
# libpq must not override the checked host with a remote address.
if [[ -n "${PGHOSTADDR:-}" && "${PGHOSTADDR}" != 127.0.0.1 ]]; then
  echo "PGHOSTADDR must be 127.0.0.1 when supplied" >&2
  exit 1
fi
export PGPORT="${PGPORT:-5432}"
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
for harness in src/pg-http.integration.ts src/roster-http.integration.ts src/phase-a-golden.integration.ts src/phase-a-health.integration.ts; do
  echo "== running ${harness} =="
  if ! "${TSX}" "${harness}"; then
    echo "FAIL: ${harness}"
    status=1
  fi
done
exit "${status}"
