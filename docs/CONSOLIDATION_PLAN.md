# Consolidation Plan — reorganize the codex line into one coherent codebase

**Decision (owner):** *Consolidate & supersede.* The parallel "codex" line (27 stacked
PRs, cumulative tip `codex/product-mode-document`) is reorganized into a clean, reviewed
set of workstreams on `main`. The owner closes the 27 codex draft PRs once each clean
equivalent lands. This document is the governing artifact for that effort.

## Provenance & posture

The codex tip was independently surveyed (read-only) and dry-run on Postgres 16: **all 30
migrations apply in order, every `public` table has RLS enabled + FORCED, the RLS attack
suite passes, `apps/checkout/src/engines.ts` is byte-identical to `main`, no
`transition(...,"confirmed")` bypass exists, no float money, no client-readable secrets.**
The work is baseline-clean (R1/R2/R3/R5/R6/R9). The task is **classification and
de-duplication, not rescue.** Nothing lands without an independent adversarial review and
green CI, and no baseline invariant in `docs/BASELINE_INVARIANTS.md` may be widened.

## Target taxonomy (what each codex artifact becomes)

| Codex artifact | Disposition | Home |
|---|---|---|
| `contracts/worker.ts`, `roster.ts`, `installation.ts` | MERGE-IN (pure, additive) | `@lumin/contracts` |
| `workflow/publication.ts`, `configurablePublication.ts` | MERGE-IN (pure engine ext.) | `@lumin/workflow` |
| `@lumin/flow-ui` (renderer + transport clients) | KEEP (pure browser) | `packages/flow-ui` |
| `@lumin/runtime-client` (fail-closed Supabase fetch client) | KEEP (pure browser) | `packages/runtime-client` |
| `action-api/src/` (pure action dispatcher) | KEEP as pure `@lumin/action-api` | `packages/action-api` |
| `action-api/server/` (HTTP + `pg` BFF, 33 files) | RELOCATE + re-review (real verified-JWT + caller-scoped RLS) | `apps/`/`services/` — never `packages/` |
| `@lumin/realtime` (mock stream) | DEMOTE to test-double behind events | co-located with `@lumin/events` |
| `@lumin/observability` (mock health) | DEMOTE to infra/test-double | infra/telemetry slot |
| migrations `0016/0017/0019/0029/0030` (flow + mode data model) | KEEP (renumbered) | `supabase/migrations` |
| migrations `0021–0028` (worker + planning domain) | KEEP, STAGED behind per-RPC `SECURITY DEFINER` review | `supabase/migrations` |
| migrations `0013(integrity)/0014(serialization)/0020(quantity)` | KEEP (renumbered) — complementary to `0010`/`0012` | `supabase/migrations` |
| migration `0015_durable_outbox` | KEEP (renumbered) — the transactional half of `@lumin/events` | `supabase/migrations` |
| migration `0018_platform_financial_minimization` | RECONCILE with RISK-4 (see below); do **not** double-drop | `supabase/migrations` |
| Netlify preview, `preview/`, playwright, CI hardening (Node 24, SHA-pinned actions, `npm audit` gate, all-migrations CI) | KEEP (net-positive posture) | root / `.github` / `scripts` |
| `docs/product/**` (21 increments + maps) | KEEP (architecture record) | `docs/product` |

## Anchors (Batch 4 — in flight, independently reviewed)

These land first; everything below assumes them.

- **`0013_platform_pii_hardening`** (RISK-4) — canonical platform-admin financial
  least-privilege. Review: **APPROVE** (Postgres-verified, all RLS assertions pass).
- **`@lumin/notifications`** — the natural consumer of the outbox `booking.requested`.
- **`@lumin/events`** — owns outbound signed webhook delivery; the durable outbox
  (codex `0015`) is its transactional half; codex `@lumin/realtime` is its mock double.

## Migration renumbering (resolves the `0013` collision)

`main` ends at `0012`. RISK-4 is the canonical **`0013`**. The codex migration block is
shifted to sit **contiguously after** it, preserving codex's internal order, with the
semantic duplicate removed:

- `0013` = RISK-4 `platform_pii_hardening` (anchor).
- codex `0013_resource_tenant_integrity` → **`0014`**, then each subsequent codex migration
  shifts up by one, **skipping codex `0018`** (superseded by RISK-4). Net result: a
  contiguous `0014…0031` block with no gap and no duplicate financial-minimization migration.
- **RISK-4 ↔ codex `0018` reconciliation:** RISK-4 already removes platform-admin SELECT on
  `payments`/`refunds`/`audit_events`. Codex `0018` additionally applied a `tenant_is_active`
  gate. Fold *only* that incremental gate (if still wanted) into RISK-4 or a small follow-up
  migration — never a second `drop policy` on an already-dropped policy (would error).

The renumber is mechanical (order, not content, is the only coupling); the full
`0001→N` apply + RLS attack suite + every codex SQL security suite are re-run after
renumbering, and must stay green.

## Execution sequence (each = an isolated, reviewed, non-draft PR the owner merges)

- **C0 — anchors:** `0013` RISK-4, `@lumin/notifications`, `@lumin/events` (in flight).
- **C1 — pure engine extensions:** `@lumin/contracts` (worker/roster/installation) +
  `@lumin/workflow` (publication/configurablePublication). No migration; easy review.
- **C2 — pure client packages:** `@lumin/flow-ui`, `@lumin/runtime-client`.
- **C3 — pure action gateway:** `@lumin/action-api` `src/` only (server/ excluded).
- **C4 — migration reorganization:** renumbered `0014…0031` + reconciled RISK-4↔`0018`,
  all codex SQL security suites, full apply verified. The DB backbone.
- **C5 — app integration:** portal/checkout/command-center connected surfaces (flows,
  roster, ConnectedCommandCenter) on C1–C4; payment authority re-proven.
- **C6 — hosted API / BFF:** relocate `action-api/server/` to `apps/`/`services/` with real
  verified-JWT + caller-scoped RLS; independent re-review before any hosted exposure.
- **C7 — worker/planning activation:** the `0021–0028` domain wired, gated behind
  per-RPC `SECURITY DEFINER` privilege-escalation/tenant-leak review.
- **C8 — infra/CI/preview/docs:** Node 24, SHA-pinned actions, `npm audit` gate,
  all-migrations CI, Netlify preview, playwright harness, `docs/product/**`.

## Non-negotiable gates (every C-workstream)

1. Independent adversarial review by a reviewer that did not build it.
2. `typecheck` 0 / all tests green / `build` / contamination clean; DB workstreams also run
   the full `0001→N` apply + RLS attack + codex SQL security suites in CI.
3. Runtime-Guardian check vs `docs/BASELINE_INVARIANTS.md` — R1/R2/R3/R5/R6/R9 preserved;
   payment authority (`engines.ts` confirmation path) untouched; secrets server-only.
4. No `packages/` boundary break — no HTTP/`pg`/IO under `packages/` (the `action-api/server`
   relocation exists precisely to honor this).
5. Owner merges (branch protection); owner closes the superseded codex PRs.
