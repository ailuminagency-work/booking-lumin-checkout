#!/usr/bin/env bash
# Contamination sweep (see docs/CONTAMINATION_LEDGER.md).
# Tier 1 (FAIL): legacy-client identifiers — may appear nowhere except the ledger.
# Tier 2 (WARN): generic vertical terms ("junk removal" etc.) — allowed only in
#   docs/ and test fixtures (generalization proofs), reported elsewhere.
set -uo pipefail
for tool in dirname grep; do
  command -v "$tool" >/dev/null 2>&1 || { echo "contamination-check: required tool unavailable: $tool" >&2; exit 2; }
done
script_dir=$(dirname "$0") || { echo "contamination-check: directory resolution failed" >&2; exit 2; }
cd "$script_dir/.." || exit 2
# grep status 1 means no matches; status >=2 is a failed scan, never clean.
checked_grep() {
  local result=0
  grep "$@" || result=$?
  if [ "$result" -gt 1 ]; then return "$result"; fi
}
EXCL=(--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude=contamination-check.sh)

FAIL_PATTERN='[b]ison'
HITS=$(checked_grep -riEl "$FAIL_PATTERN" "${EXCL[@]}" . | checked_grep -v 'docs/CONTAMINATION_LEDGER.md') || { echo "contamination-check: scan failed" >&2; exit 2; }
if [ -n "$HITS" ]; then
  echo "CONTAMINATION (client identifier) FOUND in:"; echo "$HITS"; exit 1
fi

WARN_PATTERN='junk[- _]?(haul|removal)'
WARNS=$(checked_grep -riEl "$WARN_PATTERN" "${EXCL[@]}" . \
  | checked_grep -vE '^\./(docs/|packages/core/test/|packages/contracts/src/service\.ts)') || { echo "contamination-check: scan failed" >&2; exit 2; }
if [ -n "$WARNS" ]; then
  echo "WARN: vertical-template terms outside docs/fixtures (review):"; echo "$WARNS"
fi
echo "contamination-check: clean (no client identifiers)"
