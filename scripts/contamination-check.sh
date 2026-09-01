#!/usr/bin/env bash
# Contamination sweep (see docs/CONTAMINATION_LEDGER.md).
# Tier 1 (FAIL): legacy-client identifiers — may appear nowhere except the ledger.
# Tier 2 (WARN): generic vertical terms ("junk removal" etc.) — allowed only in
#   docs/ and test fixtures (generalization proofs), reported elsewhere.
set -uo pipefail
cd "$(dirname "$0")/.."
EXCL=(--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude=contamination-check.sh)

FAIL_PATTERN='[b]ison'
HITS=$(grep -riEl "$FAIL_PATTERN" "${EXCL[@]}" . | grep -v 'docs/CONTAMINATION_LEDGER.md' || true)
if [ -n "$HITS" ]; then
  echo "CONTAMINATION (client identifier) FOUND in:"; echo "$HITS"; exit 1
fi

WARN_PATTERN='junk[- _]?(haul|removal)'
WARNS=$(grep -riEl "$WARN_PATTERN" "${EXCL[@]}" . \
  | grep -vE '^\./(docs/|packages/core/test/|packages/contracts/src/service\.ts)' || true)
if [ -n "$WARNS" ]; then
  echo "WARN: vertical-template terms outside docs/fixtures (review):"; echo "$WARNS"
fi
echo "contamination-check: clean (no client identifiers)"
