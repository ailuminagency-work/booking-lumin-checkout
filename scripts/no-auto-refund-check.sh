#!/usr/bin/env bash
# Booking Lumin never initiates refunds, including owner-triggered refunds.
# Owners act in Stripe; read-only reconciliation is not refund initiation.
# The Node guard preserves the blanket production prohibition and validates the
# sole dormant GET observer against its reviewed AST, not a path allowlist.
# Keep this entrypoint for existing CI/callers; Node also runs directly on Windows.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/no-auto-refund-check.mjs
