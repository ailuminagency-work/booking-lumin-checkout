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
#   - phase-a-rental-concurrency.integration.ts (resource-capacity race,
#     tenant isolation, replay, release, and no financial side effects)
#   - phase-a-detailing-flow.integration.ts (configurable detailing selection,
#     harness-local catalog binding, draft replay, and no financial side effects)
#   - phase-a-detailing-http.integration.ts (HTTP owner/staff detailing flow,
#     route isolation, replay, and separately scoped canonical persistence)
#   - phase-a-rental-http.integration.ts (HTTP rental flow plus scoped resource
#     race, replay, release, and no financial side effects)
#   - rental-confirmation, phase-a-http-golden, draft, reservation, confirmation
#     and mock-payment (the last five were runnable under this same
#     FLOW_TEST_DISPOSABLE contract all along, and were simply not listed)
#   - owner-payment-connection-stripe (P1 step 6: the same owner flow through the
#     REAL Stripe Connect adapter against an in-process Stripe stand-in: the account
#     is bound to the business, a disowned merchant is revoked and can reconnect, and
#     the flow makes only account and onboarding-link requests -- no money moves)
#   - owner-payment-connection-write (the owner handoff/record flow of step 5,
#     end to end against 0093: idempotent begin, the status the DATABASE derives,
#     and that an inconclusive provider answer leaves the row untouched)
#   - owner-payment-connections (the connection view 0093 records and nothing
#     could show; drives the connection through 0093's own RPCs, because every
#     direct write verb is revoked, and checks the four health verdicts)
#   - owner-payment-reviews (the parked-payment queue migration 0090 writes and
#     nothing could read: tenant scoping, owner+staff read, cross-business denial)
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
# Keep database creation, migrations, and every harness on the explicit
# disposable loopback contract. These variables can silently override the
# checked host or inject credentials/options from a caller's environment.
unset DATABASE_URL PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"

# A FRESH DATABASE PER HARNESS.
#
# These harnesses used to share one database, which coupled them: `reservation`
# and `mock-payment` pass on a pristine database and FAIL when they run after
# `draft`, so the list silently had to stay in a compatible order and could not
# grow. Verified by running all fourteen on a pristine database each: 14/14 pass.
#
# The migration chain is applied ONCE to a template, and each harness gets a
# `create database ... template ...` clone of it -- a file copy, so isolation
# costs one chain rather than fourteen. Nothing may be connected to the template
# while a clone is taken, which is why every admin statement here is -d postgres.
TEMPLATE="lumin_r2a_tpl_$$_$(date +%s)"
CREATED=()

cleanup() {
  # -d postgres, always: a `drop database X` issued while connected to X fails
  # with "cannot drop the currently open database", which the old `|| true`
  # swallowed -- leaving the database behind on every run.
  for db in "${CREATED[@]:-}" "${TEMPLATE}"; do
    [[ -n "${db}" ]] || continue
    psql -q -d postgres -c "drop database if exists ${db} with (force)" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

echo "== provisioning template ${TEMPLATE} (local harness + every migration) =="
psql -q -d postgres -c "create database ${TEMPLATE}"
psql -q -d "${TEMPLATE}" -v ON_ERROR_STOP=1 -f "${ROOT}/supabase/tests/local_harness.sql"
for m in "${ROOT}"/supabase/migrations/0*.sql; do
  psql -q -d "${TEMPLATE}" -v ON_ERROR_STOP=1 -f "$m"
done

export LOCAL_HARNESS=1 FLOW_TEST_DISPOSABLE=1
TSX="${ROOT}/node_modules/.bin/tsx"

status=0
n=0
for harness in \
  src/pg-http.integration.ts \
  src/roster-http.integration.ts \
  src/phase-a-golden.integration.ts \
  src/phase-a-http-golden.integration.ts \
  src/phase-a-health.integration.ts \
  src/phase-a-rental-concurrency.integration.ts \
  src/phase-a-detailing-flow.integration.ts \
  src/phase-a-detailing-http.integration.ts \
  src/phase-a-rental-http.integration.ts \
  src/rental-confirmation.integration.ts \
  src/draft.integration.ts \
  src/reservation.integration.ts \
  src/confirmation.integration.ts \
  src/mock-payment.integration.ts \
  src/owner-payment-reviews.integration.ts \
  src/owner-payment-connections.integration.ts \
  src/owner-payment-connection-write.integration.ts \
  src/owner-payment-connection-stripe.integration.ts
do
  n=$((n + 1))
  DB="lumin_r2a_$$_${n}"
  CREATED+=("${DB}")
  psql -q -d postgres -c "create database ${DB} template ${TEMPLATE}"
  echo "== running ${harness} on ${DB} =="
  # Every harness runs to completion even after one fails, so a single red
  # harness still reports the others.
  if ! PGDATABASE="${DB}" "${TSX}" "${harness}"; then
    echo "FAIL: ${harness}"
    status=1
  fi
  psql -q -d postgres -c "drop database if exists ${DB} with (force)" >/dev/null
done
exit "${status}"
