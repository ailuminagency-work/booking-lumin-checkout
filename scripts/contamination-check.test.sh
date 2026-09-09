#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
BASH_EXEC=$(command -v bash)

expect_scan_failure() {
  local code=0
  "$@" >/dev/null 2>&1 || code=$?
  if [ "$code" -ne 2 ]; then
    echo "Expected scan failure (2), received $code" >&2
    exit 1
  fi
}

expect_scan_failure env PATH='' "$BASH_EXEC" scripts/contamination-check.sh
expect_scan_failure "$BASH_EXEC" -c 'dirname() { return 2; }; grep() { return 1; }; export -f dirname grep; bash scripts/contamination-check.sh'
expect_scan_failure "$BASH_EXEC" -c 'grep() { return 2; }; export -f grep; bash scripts/contamination-check.sh'
expect_scan_failure "$BASH_EXEC" -c 'grep() { if [[ "$1" == -v* ]]; then return 2; else command grep "$@"; fi; }; export -f grep; bash scripts/contamination-check.sh'
"$BASH_EXEC" -c 'grep() { return 1; }; export -f grep; bash scripts/contamination-check.sh' >/dev/null
echo 'contamination-check failure-mode tests PASS'
