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
# The provider CLIENT may still expose a refund method: a human-triggered refund
# path needs it. Only _shared/stripe.ts may contain the call site that performs it.
set -euo pipefail
cd "$(dirname "$0")/.."

# Where a provider refund PRIMITIVE may be DEFINED. Everywhere else, a refund call
# is a call site, and there must be none in production code.
#   - supabase/functions/_shared/stripe.ts : the edge-function provider client
#   - packages/adapters/src/*Payment.ts    : the PaymentProvider adapter implementations
# Test files are exempt: they exercise the primitive's own guards (over-refund
# rejection, partial-to-full accounting) without Booking Lumin initiating anything.
ALLOWED_RE='^(supabase/functions/_shared/stripe\.ts|packages/adapters/src/[A-Za-z]*[Pp]ayment\.ts)$'
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
