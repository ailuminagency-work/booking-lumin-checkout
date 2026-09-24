# Main-line field contract prerequisite

Base: protected `main` at `c5663c59e134e71beb511f509b3287ab0046bdff`. This review branch imports only previously reviewed, pure field and publication contracts and six self-contained direct test suites into `packages/workflow`. Four historical suites that depend on absent V1 modules or exports remain deferred with their assertions unchanged. It does not register migrations, wire HTTP routes, change authentication, create bookings, or activate a provider. The historical parity candidate `885d8b6fc5a9712c4aa4ce69817a1867c10b6240` remains a separate Wave 3 review branch.

## Why this leaf comes first

Main now hosts the API under `apps/api/src` after PR #76, while the historical field work lives under `packages/action-api/server`. The parity helper depends on field document V2/V3, draft V2/V3, publication V1, and publication snapshot contracts that are absent on main. Moving the parity helper alone would leave unresolved imports and test harness dependencies. This leaf restores the pure workflow dependency layer without touching the host API entrypoint, Supabase JWT verifier, booking authority, or current migration ledger.

The migration histories also diverge. Main has `0013_platform_pii_hardening.sql` and `0031_overbooking_backstop.sql`; the historical Wave 3 stack has a different 0013–0018 order and `0031_mode_session_validation.sql` followed by field migrations 0032–0035. No historical migration may be merged or renumbered into main on the basis of filename alone. A separate semantic-delta review must preserve every accepted main migration and add only reviewed missing behavior.

## Review sequence

1. Builder imports the six named pure workflow modules and six self-contained direct tests. No shared exports or production wiring are changed in this leaf.
2. Run targeted and full relevant workflow tests, strict typecheck, independent source/domain review, and adversarial checks of malformed documents, duplicate IDs, boundary sizes, and prototype keys. Review exact path inventory and byte-for-byte or explained semantic differences from the reviewed historical sources.
3. Integration and Runtime Governors verify that main's accepted booking, tenant, payment, capacity, auth, and demo/live behavior remains unchanged. Exact-branch CI and Release review are required before acceptance into the main line.
4. Subsequent leaves: semantic migration-delta plan; safe additive migrations and RLS/concurrency harness; disposable API test-profile port; field publication helper and parity corpus port into `apps/api/src`; full application/native dual-layout checks and hosted acceptance. Each receives fresh source pins and independent review. Historical native receipts do not certify the port.

Open boundaries: current main's exact CI is green, but this branch has no exact-candidate CI until pushed and reviewed. GitHub's connected PR creator has returned `422 must be a collaborator`; do not claim a draft PR exists without verifying it. No live Netlify/Render/Supabase activation or real provider credentials are part of this leaf.

Local evidence: builder /root/choice_editor_builder_2043 verified all 12 imported files match the historical reviewed files, targeted tests 93/93 and strict workflow typecheck pass. Independent source reviewer /root/editor_design_review_2043 accepted dependency closure and bounded adversarial coverage. Root reran the full workflow suite: 180/180 across 12 files. The initial root full-suite invocation collected no tests because the sandbox denied Vitest temporary-file creation; an authorized rerun passed. Independent /root/editor_design_review_2043 granted scoped local Runtime acceptance for review-branch publication after a 13-path scope check. Root also ran the full workspace typecheck successfully. Exact-branch CI and Release review remain pending.
