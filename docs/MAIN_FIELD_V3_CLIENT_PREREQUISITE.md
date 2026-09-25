# V3 field draft client prerequisite

This isolated Wave 3 branch restores the V3 owner draft client contract in `@lumin/flow-ui` and exports it by name. The client stays default-off. Its caller opt-in enables only client transport, including to an HTTPS origin; it is not server authorization or a feature negotiation signal. V3 uses its own route and parser without falling back to V1/V2. Server-side identity, tenant membership, sidecar selection, draft revision checks and publication authority remain mandatory.

Base: `6925d1305bc5d2f8fb15e89570c26693349bb626` (`codex/main-field-v2-client`). Scope is the V3 client, its focused tests, named package export and this evidence note. No current-main server route, portal editor, migration, checkout flow, payment/capacity authority, provider connection or deployment is changed. The client cannot power a hosted editor until the API and storage dependencies in the Wave 3 map are reconciled and independently qualified.

## Candidate gates (2026-09-25)

- Builder: `/root/field_publication_export_builder`; root `/root` owns the package export and this note.
- Unit and adversarial tests: 37/37 focused V3 tests; the full workspace suite passed. The flow UI suite passed 231/231 tests across 10 files. Its first run had one unrelated five-second timing timeout under load; that test passed 72/72 in isolation and the complete flow UI rerun passed 231/231.
- Workspace typecheck and production build passed. The first build attempt could not read the Vite configuration due to local filesystem sandbox permissions; the same candidate built successfully with workspace access.
- Independent domain, security, adversarial, integration and scoped Runtime Guardian source review: `/root/field_v3_reviewer`, pass. The reviewer confirmed default-off V3-only routing, bounded payloads, stale receipt/abort handling and the absence of a live editor or server authority claim.
- Local install: a stale `node_modules` junction initially resolved `@lumin/workflow` to an older worktree. Reinstalling this worktree's dependencies corrected the link; tests and typecheck then passed. No dependency manifest or lockfile changed.
- Exact-candidate CI and Release Governor remain pending until the review branch has a draft PR and Actions run. This note does not certify a live route, deployment, or Wave 3 completion.
