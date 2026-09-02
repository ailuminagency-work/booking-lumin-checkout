# Release Ledger

Owner: Release Governor. Merge gates: G1 scope · G2 contract · G3 unit tests ·
G4 integration · G5 tenant isolation · G6 security review · G7 migration safety ·
G8 observability · G9 independent review · G10 release approval.

| RC | Contents | Gates passed | Status |
|----|----------|--------------|--------|
| RC-0 | Bootstrap: workspaces, contracts v1, governance docs | G1 G2 G3 | released |
| RC-1 | Core engines, adapters, DB schema+RLS, 3 apps, adversarial pass + all 6 fixes | G1 G2 G3 G4 G5 G6 G7 G9 G10 | released — pushed to origin/main 2026-09-02 |

RC-1 gate evidence: G3 unit tests 107 green; G4 cross-package integration (checkout drives real core+adapters); G5 tenant isolation — RLS attack suite 25/25 on PG16; G6 security — all 13 invariants mapped + 6 review defects resolved; G7 migrations apply clean in order on an empty DB; G9 two independent adversarial reviewers. G8 observability (audit_events + event contract) present but runtime wiring is post-deploy. G10 (Release Governor final push) waits on a remote repository.

Release strategy: small coherent batches to `main`; each batch leaves
`typecheck`, `test`, and `build` green at the root. Deployment to any hosted
environment happens only after a remote repository and a NEW (non-legacy)
Supabase project exist, and G5/G6 pass.
