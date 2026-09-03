# Security Ledger

Chronological record of security-relevant events, incidents, and their disposition
for Booking Lumin Checkout. Append-only; newest entries at the bottom.

| Date | Event | Disposition | Follow-up |
|------|-------|-------------|-----------|
| 2026-09-03 | `ecc-tools[bot]` opened unsolicited PR #2 injecting agent-config (`.claude` / `.codex` / `instincts` / `identity`). | Closed without merging or importing; none of the injected agent-config was pulled into the repo. | Recommend reviewing the `ecc-tools` GitHub App's write access to the org (an unsolicited config-injecting PR from a bot indicates broader write scope than warranted). |
| 2026-09-03 | RC-2 hardening (RISK-1 / RISK-2) authored on branch `security/rc2-hardening`: migration `0009_rc2_hardening.sql`, engine `transition()` guard, RLS attack ATTACK 12/13, CI workflow. | Implemented and validated on throwaway Postgres 16 (ALL RLS ATTACK TESTS PASSED) + typecheck/test/build/contamination green. Pending orchestrator review, live-DB apply of 0009, and PR. | See D-011 / D-012 and SI-14 / SI-15. |
| 2026-09-03 | Contamination gate hit: `docs/RC1_ACCEPTANCE_REPORT.md` quoted the raw legacy-client identifier in prose, tripping the Tier-1 `contamination-check.sh` FAIL pattern (only `docs/CONTAMINATION_LEDGER.md` is exempt). | Redacted the literal token to `the legacy-client-name` in that row; meaning preserved; `contamination-check.sh` clean. | None; the identifier survives only in the exempt contamination ledger by design. |
