# Program Governance & Control Plane

Operating model for continuous, parallel evolution of Booking Lumin Checkout without
uncontrolled regression of the accepted baseline. Three planes: Control (protect),
Execution (build in isolated branches/worktrees), Verification (disprove).

## Baseline protection status

| Control | State | Compensation |
|---|---|---|
| Branch protection on `main` | **NOT settable** via the session's GitHub token ("Resource not accessible by integration"). Recorded limitation. | No direct pushes to `main`; all change via branch → PR. Enforced by process + Runtime Guardian. |
| Required CI | Present (`.github/workflows/ci.yml`: verify + database jobs). | **CI must be green before any merge, docs included.** |
| Required review | Process gate (independent reviewer who did not build the change). | Release Governor merges only after review + Runtime-Guardian check. |
| Migration validation | CI `database` job applies `0001..000N` + runs RLS attack suite. | — |
| Contamination scan | CI `verify` job runs `scripts/contamination-check.sh`. | — |

**Ask for the repo owner:** enable GitHub branch protection on `main` (require PR, require
the `verify` + `database` checks, require 1 review, disallow direct pushes). Until then the
above process is the compensating control.

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
