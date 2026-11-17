# Program Governance & Control Plane

Operating model for continuous, parallel evolution of Booking Lumin Checkout without
uncontrolled regression of the accepted baseline. Three planes: Control (protect),
Execution (build in isolated branches/worktrees), Verification (disprove).

## Baseline protection status

| Control | State | Compensation |
|---|---|---|
| Branch protection on `main` | **Protected**, verified through the GitHub branch API on 2026-10-04 at `c5663c59e134e71beb511f509b3287ab0046bdff`. The earlier session limitation is historical. | No direct pushes to `main`; preserve protection and require review, CI and Release Governor. |
| Required CI | Present (`.github/workflows/ci.yml`: verify + database jobs). | **CI must be green before any merge, docs included.** |
| Required review | Process gate (independent reviewer who did not build the change). | Release Governor merges only after review + Runtime-Guardian check. |
| Migration validation | CI `database` job applies `0001..000N` + runs RLS attack suite. | — |
| Contamination scan | CI `verify` job runs `scripts/contamination-check.sh`. | — |

GitHub currently reports `main` as protected. Recheck the effective rules before any
production promotion; this flag alone does not prove every required check or bypass
restriction. Staging execution does not authorize changing those rules or merging the
accumulated draft integration PR.

## Isolation rule (Execution plane)

Builders operate on **isolated branches in their own git worktree** — never the
orchestrator's working tree, never `main`. A builder leaves its change as a branch/PR for
review; a broken branch can never damage the accepted runtime. (Correction: an early RC-3
build shared the orchestrator's clone; subsequent builders use worktree isolation.)

## The loop (no builder bypasses it)

BUILDER → unit test → domain-lead review → **independent reviewer (never self)** →
adversarial test → Integration Governor → **Runtime Guardian vs BASELINE_INVARIANTS.md** →
CI → **Release Governor** (only role that authorizes promotion toward `main`).
Any failed gate returns to the builder; the relevant loop restarts. Never merge because
"most tests pass."

## Promotion states

Destructive DB operations, real external-provider connections, and production secrets each
require explicit human approval. Three environments: LOCAL/MOCK → STAGING/TEST →
ACCEPTED BASELINE. Builders cannot self-promote.

## Evidence & risk ledgers

Per-task evidence uses the status ladder in the charter (PROPOSED … RELEASED …
RUNTIME_VERIFIED) — never a vague "done". Standing risks (RUNTIME-04, RISK-4) are tracked
in `BASELINE_INVARIANTS.md` and may not be widened by feature work.
