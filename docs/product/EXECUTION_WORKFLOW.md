# Continuous execution workflow

The user authorized continued work across all waves and pushing tested candidates on September 9, 2026. This supersedes the planning snapshots' “implementation not launched” status. It does not supersede the earlier prohibition on real provider credentials, the review loop, main protection, or explicit access approvals.

`wave-ledger.json` is the current implementation queue. Run `node scripts/program-status.mjs` to validate the combined DAG and list dependency-ready waves and evidence nodes. A verified candidate is not a merge, deployment or live certification. Detailed product requirements remain in the nine specifications; this ledger groups them into executable increments.

## Resume protocol

1. Read the ledger, this workflow, product specs, baseline invariants and previous wave evidence. Inspect local changes, remote main, current PR heads and CI before editing. Never overwrite unfinished work or assume a branch is accepted because its name resembles a release.
2. Resume BUILDING/REWORK work first. Dispatch only dependency-ready increments. At most three builders/reviewers plus the coordinator run concurrently; 28 domain queues do not mean 28 live processes. Each dispatch records base SHA, exclusive paths, contract version, test database and completion criteria.
3. Use isolated branches/worktrees. Root integration owns package lock, CI, shared exports, route registration and migration numbers. Each SQL cell uses its own disposable database. Accepted migration files stay immutable; new SQL is local/CI only until deployment is separately approved and reviewed.
4. Follow Builder → unit tests → Domain Lead → independent reviewer → adversarial tester → Integration Governor → Runtime Guardian → exact-candidate CI → Release Governor. Reviewers must not approve their own code. Record when one person performs multiple governor roles. A failed gate sends the work to its builder; changes invalidate affected approvals.
5. Integrate passing leaves, run full relevant checks, push the isolated branch, and open/update its draft PR. Preserve the PR stack and base SHA. Do not automatically merge past required GitHub review or treat a PR as a production release. Required CI includes application checks and database/RLS/concurrency checks.
6. Update ledger and wave evidence with actual outcomes, exact code/CI SHAs, independent reviewers, defects returned to builders, unresolved boundaries and next work. If a ledger-only commit follows tested code, run exact-head CI again; do not imply an earlier run covers new code.
7. Continue through all authorized dependency waves. When access or production-only proof is blocked, keep unrelated work moving and record the precise missing authorization/evidence. Never label missing live proof green. Optional real-provider activation remains excluded until separately authorized.

## Completion criteria by wave

| Wave | Scope and workstreams | Required exit evidence |
|---|---|---|
| W0 | Product agreement, P1 | Nine reviewed specs, ownership/route/data maps and approval record |
| W1 | Portal shell and initial publication/worker contracts, P1/P4/P10/P11/P25/P28 | Compatible URLs, explicit demo/live split, tested bounded contracts and independent attacks; PR32 |
| W2 | Action boundary, durable events, flow storage, P22/P23/P28/P11 | Authenticated-context contract rejects forged actors; SQL revision/tenant/immutability/lease fencing tests; no claim of wired HTTP authority |
| W3 | Persisted builder/runtime request journey, P9/P10/P11/P12/P13/P14/P21/P23 | Shared field renderer; draft editing/preview/publish through authenticated APIs; two generic presets; pinned sessions; real staging request persistence; no auto-confirmation |
| W4 | Workers, crews, schedules/resources/holds and field/map UI, P3/P4/P5/P6/P7/P8/P20 | Dedicated worker auth/RLS/DTO; assigned-job journey; atomic combined quantity allocation; concurrent/DST/revocation tests; synthetic confirmed jobs only |
| W5 | Pricing/invoices, separate merchant and platform payment operations, P14/P15/P16/P17 | Server quote authority, transactional fake financial completion, dedupe/reorder/refund/invoice reconciliation; GMV separate from platform revenue |
| W6 | Provider connections and background delivery, P18/P19/P22/P23 | Fake OAuth tenant/PKCE/replay tests; calendar/email/SMS delivery via durable jobs; connection UI never asks for pasted refresh tokens; providers disconnected |
| W7 | Full Portal, Command Center, AI actions and observability, P2/P3/P9/P13/P21/P24/P25/P26/P27/P28 | Real authorized projections where implemented, aggregate CC, scoped AI actions, explicit unavailable health, minimized logs; mobile/accessibility/i18n/performance checks |
| W8 | Staging integration and deployment synchronization | Authorized Netlify/Render/Supabase provenance and branch wiring; genuine tenant/admin/worker HTTP isolation; load/failure/rollback pilot; residual baseline risks closed for pilot scope |
| W9 | Optional real-provider activation | Separate authorization, credentials entered only through approved paths, provider-specific staging certification and controlled rollout; currently blocked by policy |

W3–W8 require multiple builder/review cycles, not one large speculative commit. Split each into independently reviewable leaves and persist progress in its evidence. Dependency readiness permits starting a contract leaf; it does not certify the parent wave's full journey or waive later runtime checks.

## Current PR stack and persistence

Main remains `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead` at launch. PR31 is `codex/program-integration` at `fb98a7b`; PR32 is `codex/product-wave1` at `ccdafde`. Wave2 starts from PR32 on `codex/product-wave2`. Reconcile remote state before using these historical references.

Hourly continuation is attached to this thread as `continue-booking-lumin-engineering-waves`. It resumes from this ledger; it does not bypass missing access or guarantee work while the desktop/runtime is unavailable. Stop the continuation once all authorized waves are verified and report any separately gated activation work.

## Schema2 evidence DAG and parent completion

The scope and completion criteria above remain mandatory. Schema2 separates parent-wave acceptance from implementation/evidence nodes. `readyNodes` identifies contract/local implementation work that can start; `ready` retains whole-wave dependency readiness. W0-W9 keep their original scopes and parent dependencies.

W3 remains BUILDING. `W3.1.local_candidate` records exact reviewed code `e3f4985f1875da104bd3b1f03f95b1caa826656e`, PR34 and CI34395974824 with all nine gates. It proves the bounded local persisted no-pay journey, not the full field builder, installation suite or hosted customer authentication. W3.2 and W4 implementation leaves may consume this reviewed contract without waiting for a staging pilot.

W3 completion still requires all three full-capability nodes (fields/workflows, publication/installation, runtime/presets) AND hosted_request_acceptance. Those nodes represent every applicable approved requirement, not a renamed bounded increment. W4-W7 likewise require full capability coverage and hosted acceptance, plus their original parent dependencies. Only the designated Wn.implementation node can establish implementation readiness for a BUILDING parent whose whole-wave dependencies remain incomplete. No arbitrary added node can promote a parent.

E.environment_access is an external prerequisite with no W7/W8 dependency. Authorized infrastructure access, trusted TLS and legitimate test identities may be prepared independently; missing access stays BLOCKED. W3.hosted_request_acceptance requires E plus W3 capabilities. W8.integrated_pilot requires W3 hosted acceptance and W4-W7 hosted acceptance. Staging preparation therefore does not wait for the pilot it enables. W9 remains BLOCKED regardless of other readiness; provider activation requires separately reviewed authorization.

The validator encodes mandatory core node kinds, owners, dependencies and parent completion requirements. Removing a required node/edge, reclassifying hosted proof, adding unknown fields/nodes, weakening the nine gates or introducing a parent/evidence cycle fails validation. New incremental node IDs require an explicit reviewed registry/ledger change; they cannot silently waive core requirements.

Verified implementation/capability nodes and nonplanning parents require a full40-character code SHA, exact repository PR and CI-run links and all distinct required gates. Verified hosted/external nodes additionally require hostedEvidence: matching candidate SHA, staging environment, named independent reviewer and a separate public-HTTPS evidence artifact. IP literals, loopback/fixture/example hosts, this ledger/status script, PR links and CI-run pages cannot be hosted proof. An updated ledger does not retroactively expand its historical receipt: root must run exact-head CI again for the new integration commit.

This validator checks recorded structure, not truth. It cannot authenticate CI SHA/results, reviewer independence, DNS or artifact contents. Governors must independently verify external receipts before marking VERIFIED. The validator's own green output or an entry repeating its own claim is not acceptance evidence. Preserve exact external evidence in the linked review/report; changes invalidate affected downstream approvals. Production/hosted acceptance and actual Auth remain incomplete wherever evidence is missing.
