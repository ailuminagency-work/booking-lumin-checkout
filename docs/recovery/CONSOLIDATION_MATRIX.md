# Consolidation Matrix (Lane B) — path to ONE coherent tree

`main` @ `152bb90`. Two development lineages were reconciled into a clean consolidation
(governed by `docs/CONSOLIDATION_PLAN.md`): (1) the clean `@lumin` line (this program), and
(2) the parallel `codex/*` line (27 stacked PRs `#31-#60`). Decision on record:
**consolidate & supersede** — the codex tip's content is reorganized into clean, reviewed
PRs; the owner closes the 27 codex PRs as each clean equivalent lands.

## Merge queue for one coherent tree (owner merges; `main` is branch-protected)
Two lineages; merge each in order. All are independently reviewed + CI-green.

**Package/app lineage** (stacked — merge in order):
| PR | Branch | Brings | Review | Merge order |
|---|---|---|---|---|
| #62 | feat/c1-engine-extensions | contracts(worker/roster/installation)+workflow(publication) | APPROVE | 1 |
| #63 | feat/c2-client-packages | @lumin/flow-ui + @lumin/runtime-client (+vitest align) | APPROVE | 2 |
| #64 | feat/c3-action-api | pure @lumin/action-api dispatcher (server/ deferred → C6) | APPROVE | 3 |
| #66 | feat/c5-app-integration | codex connected surfaces into checkout/portal/command-center | review in-flight | 4 |

**Migration lineage** (independent — merge in order):
| PR | Branch | Brings | Review | Merge order |
|---|---|---|---|---|
| #49 | security/0013-platform-pii | RISK-4 `0013` **hybrid** (active-tenant gate + platform null-audit) | security APPROVE (re-review after hybrid) | 1 |
| #65 | feat/c4-migrations | renumbered codex `0014-0030` + 19 SQL security suites + CI gating | security APPROVE (PG 30 mig + 19/19 suites) | 2 |

**Anchors** (independent — mergeable any time):
| PR | Branch | Brings | Review |
|---|---|---|---|
| #50 | feat/w15-notifications | @lumin/notifications (mock) | APPROVE |
| #51 | feat/w16-events | @lumin/events (mock) | APPROVE |
| #61 | docs/consolidation-plan | consolidation plan doc | green |

## Remaining consolidation lanes (still to build)
| Lane | Scope | Status |
|---|---|---|
| **C6** | relocate codex `action-api/server` (HTTP+`pg` BFF, 33 files) out of `packages/` → an app/service tier with **verified-JWT + caller-scoped RLS**; re-review before hosting. **This is the seed of the Render API service (§11).** | TODO |
| **C7** | activate worker/planning domain (`0021-0028`) end-to-end + wire into portal roster/scheduling; per-RPC `SECURITY DEFINER` review. | TODO |
| **C8** | infra/CI/preview/docs: Node 24, SHA-pinned actions, `npm audit` gate, all-migrations+concurrency CI, Netlify preview, playwright, `docs/product/**`. | TODO |

## codex PRs `#31-#60` (27, `codex/*` stacked)
Superseded incrementally by C1-C8. Do NOT merge directly. **Owner closes each as its clean
equivalent lands.** They are the source-of-record the consolidation reorganizes from
(`origin/codex/product-mode-document` tip = their cumulative state).

## `ecc-tools[bot]` / other bots
`ecc-tools` config-audit is quota-exhausted (no-op); `netlify`/`coderabbit` are informational.
None gate correctness. No `ecc-tools` bundle PRs are open.

## Product-model drift guard
The codex line introduced **modes/installations/flow-sessions** and **worker/planning**. These
are net-new operational capability (kept), but the Product-Profile correction (Lane D) must
ensure ONE tenant → ONE activated profile drives navigation/terminology/schema — see
`PRODUCT_PROFILE_MAP.md`. No second application per vertical.
