#!/usr/bin/env bash
# Contamination sweep: fails if legacy-client identifiers appear anywhere
# outside the contamination ledger itself. See docs/CONTAMINATION_LEDGER.md.
set -euo pipefail
cd "$(dirname "$0")/.."
PATTERN='bison|junk[- _]?haul|junk[- _]?removal|x-bison|bison_booking'
HITS=$(grep -riEl "$PATTERN" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . \
  | grep -v 'docs/CONTAMINATION_LEDGER.md' || true)
if [ -n "$HITS" ]; then
  echo "CONTAMINATION FOUND in:"; echo "$HITS"; exit 1
fi
echo "contamination-check: clean"
