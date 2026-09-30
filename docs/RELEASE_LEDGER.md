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

## Phase A staging operationalization

`phase-a/staging-operationalization` is the protected implementation line from
`main`. Candidate `5afa46613880f1b7b8a3198df4871b2ea63c08cb` is pushed and
locally verified through typecheck, API tests, golden-flow tests, three
frontend builds, and staging configuration validation. GitHub currently exposes
no workflow runs or status checks for this branch because no PR/CI integration
is attached. Render and Netlify mutations remain pending connector/credential
access; no live database migration or real provider credential was used.
The full workspace suite also retains two pre-existing `@lumin/flow-ui`
failures (`modeDocument.adversarial.test.ts` timeout and
`modeDocument.test.ts` cross-realm `AbortSignal`); the candidate changes no
`flow-ui` files, so Release Governor holds promotion pending baseline repair and
CI integration.
Read-only Render inventory for confirmed workspace `My Workspace`
(`tea-d9pp87ad0e5s73enrog0`) shows only `leadgate-api` and `leadgate-backup`;
no Booking Lumin staging service exists yet. No Render mutation was performed.

The confirmation surface is intentionally fail-closed at `667090844990cae2837792a41a9f7b456fc8f552`:
it authorizes the tenant-owned booking but performs no payment, hold, booking,
or history mutation until a durable atomic payment-and-hold authority is
implemented. This keeps staging from claiming a confirmation that the current
database/provider boundary cannot prove.

Phase A candidate `f826320` adds the provider-neutral durable authority as
migration `0032_atomic_confirmation.sql`. Its service-role-only RPC accepts a
persisted payment id, derives all tenant, booking, service and pricing context,
requires a stored `succeeded` payment plus an exact active/consumed hold, and
atomically consumes/links/confirms with idempotent replay. Resource-linked and
planning services remain explicitly unsupported; the browser endpoint remains
fail-closed and no provider webhook or live database wiring was added. Source
candidate `bc0a95c8ea0197e4c7993a5ee660c20fbf0c2129` passed a fresh 32-migration
disposable PostgreSQL replay and independent review. Exact integrated-head
checks on `f826320` passed: workspace typecheck, API 27 tests, templates 31
tests, three frontend builds, staging config validation and `git diff --check`.
GitHub still reports no CI statuses/workflow runs because PR integration is
blocked; Render/Netlify mutations and live migration remain out of scope.
