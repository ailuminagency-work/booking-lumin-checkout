#!/usr/bin/env bash
# no-auto-refund-check.sh — enforces a standing product rule mechanically:
#
#   Booking Lumin must NEVER issue a refund automatically.
#
# A refund moves a customer's money. It may only happen because a person decided
# it should. Recording a refund that a person already made at the provider is
# fine and expected (that is the inbound charge.refunded accounting path); what
# must never exist is server code that CALLS the provider's refund API on its own.
#
# History: supabase/functions/stripe-webhook/index.ts once shipped a
# "deterministic refund-on-oversell" that refunded automatically when a capacity
# hold expired between capture and webhook delivery. Migration 0090 replaced it
# with a park-for-human-review. This check exists so that cannot come back
# unnoticed -- CI does not otherwise typecheck or test the edge functions at all.
#
# The provider client no longer exposes a refund method at all. There is no
# human-triggered refund path inside Booking Lumin either -- no owner button, no
# partial-refund button, no cancel-and-refund. A person who decides to refund does
# it in the provider's own dashboard, under that merchant's own credentials, and
# this system learns about it from the inbound charge.refunded webhook. So the
# allowlist below is EMPTY: there is nowhere a refund call may legitimately live.
set -euo pipefail
cd "$(dirname "$0")/.."

# Empty by construction: no production file may define or call a refund primitive.
# A regex that cannot match any path, rather than an unset variable, so `set -u`
# still catches a typo here.
#   Kept deliberately empty -- adding a path back to this list is the edit that
#   re-arms automatic refunds, and it should look exactly that deliberate.
# Test files stay exempt: the fake Stripe server implements /v1/refunds exactly as
# Stripe does, which is what lets the tests prove the adapter never CALLS it, and
# the reconciliation tests need charge.refunded fixtures.
ALLOWED_RE='^$'
TEST_RE='(/test/|\.test\.ts$|/fakeStripe\.ts$)'
SCAN_DIRS='supabase/functions packages apps'
status=0

# A refund CALL is code, never prose, so comment-only lines are not offenders --
# the files here document the rule and name the thing they must not do.
code_hits() { # $1=file ; prints "line:text" for non-comment matches only
  grep -n -e '\.refund(' -e 'v1/refunds' "$1" 2>/dev/null \
    | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' || true
}

offenders=''
while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  [[ "${f}" =~ ${ALLOWED_RE} ]] && continue
  [[ "${f}" =~ ${TEST_RE} ]] && continue
  [[ -n "$(code_hits "${f}")" ]] && offenders="${offenders} ${f}"
done < <(grep -rl --include='*.ts' -e '\.refund(' -e 'v1/refunds' ${SCAN_DIRS} 2>/dev/null | grep -v node_modules || true)

if [[ -n "${offenders// /}" ]]; then
  echo "no-auto-refund-check: FAIL — provider refund call in production code:" >&2
  for f in ${offenders}; do
    echo "  ${f}" >&2
    code_hits "${f}" | sed 's/^/      /' >&2
  done
  echo >&2
  echo "  Booking Lumin must never refund automatically. Park the payment for a" >&2
  echo "  human instead (public.payment_reviews, migration 0090)." >&2
  status=1
fi

# The one allowed file must contain the refund DEFINITION only, never a self-call.
EDGE_CLIENT='supabase/functions/_shared/stripe.ts'
if [[ -f "${EDGE_CLIENT}" ]]; then
  selfcalls="$(grep -nE '(stripe|client|provider)\.refund\(' "${EDGE_CLIENT}" \
    | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' || true)"
  if [[ -n "${selfcalls}" ]]; then
    echo "no-auto-refund-check: FAIL — ${EDGE_CLIENT} invokes its own refund method:" >&2
    echo "${selfcalls}" | sed 's/^/      /' >&2
    status=1
  fi
fi

if [[ ${status} -eq 0 ]]; then
  echo "no-auto-refund-check: clean (no automatic provider refund call)"
fi
exit ${status}
