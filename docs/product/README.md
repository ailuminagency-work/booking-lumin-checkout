# Approved product program

On September 9, 2026, the user approved starting the phased program with “go ahead and start”. The nine specifications in this directory are the reviewed planning snapshot. Their target architecture is accepted; the audit findings remain a historical planning snapshot. Current progress lives in wave-ledger.json and EXECUTION_WORKFLOW.md. Approval authorizes bounded implementation, not a production release or provider activation.

## Wave 1 scope

Integration branch: `codex/product-wave1`, based on `fb98a7b9feaadb429ca7656430590d790d394a1a`. Protected main was verified at `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead`. Accepted RC-2 reference is commit `6bbcd679a09741d3a2e978ddd2bb398f1d98a6f9`; do not rely on the absent tag.

| Cell | Branch | Exclusive ownership | Deliverable |
|---|---|---|---|
| Portal | codex/wave1-portal | apps/portal | Twelve-section navigation, compatible aliases, shared demo/connected shell with honest availability states |
| Publication | codex/wave1-publication | packages/workflow | Pure draft/version/installation contracts and validation; no persistence or live publication |
| Worker access | codex/wave1-worker-contracts | packages/contracts worker module and additive export/test config | Pure trusted-context access decisions and minimized job projections; no worker login or RLS deployment |
| Integration | codex/product-wave1 | Documentation, lockfile, reviewed integration | Exact-candidate verification and release evidence |

Three builders plus one coordinator are active. The 28 workstreams are durable queues, not 28 simultaneous agents. Reviewers rotate to code they did not build; governor roles performed by the coordinator are disclosed as such.

## Gates and release boundary

Builder → unit tests → domain review → independent review → adversarial tests → Integration Governor → Runtime Guardian → CI → Release Governor. A failed gate returns to its builder. Record exact commits, reviewer identity, checks and unresolved limits in the wave report.

No main changes, live schema changes, provider activation, worker permission widening, or production deployment belong to this wave. A pure contract does not prove server authentication or tenant isolation. Existing booking/payment authority, connected draft behavior, and demo/live separation remain required.

Netlify linking/deployment is an unresolved separate release dependency. Do not call a green build a live deployment. Authenticated runtime isolation and existing financial/audit minimization gaps remain open until directly tested and fixed.

## Reading order

Start with PRODUCT_MAP.md and PORTAL_INFORMATION_ARCHITECTURE.md. EMBED_BUILDER_SPEC.md, WORKER_EXPERIENCE_SPEC.md and COMMAND_CENTER_SPEC.md define the four surfaces. BACKEND_DEPENDENCY_DAG.md and DATA_MODEL_GAPS.md define authority and dependencies. MIGRATION_PLAN.md and PARALLEL_WORKSTREAM_PLAN.md define phased delivery and verification.
