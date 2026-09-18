# V2 editor preview composition

Base `ed4d27f8e931fbbe6015d83201e3359561cc736d`; branch `codex/wave3-field-preview-editor-v2`.

This leaf adds explicit local preview opening/closing to the isolated V2 draft editor, reusing the reviewed V2 preview and parsers unchanged. Preview requires a valid eligible current draft and never submits answers, changes dirty state or modifies saved definitions. Preview identity must retire on editor/context/parent changes and on read/save operations; hiding it temporarily is insufficient because answers must not reappear when eligibility returns. Existing V1, host, shared exports, routes, SQL and provider code remain unchanged.

Ownership: `/root/field_contract_builder` editor and new preview-unit tests; `/root/text_draft_client` new separate adversarial tests; `/root/evidence_recovery_review` independent architecture/source/replay/local Runtime review; `/root` docs/ledger, Integration and local Runtime Guardian coordination. Component evidence does not certify native-browser behavior or hosted authentication.

Baseline03f639 confirms main152bb909 protected, PR74c53deb open draft, predecessor ed4d27f CI0; accepted PR74 CI34743351848 remains successful at the exact head. Ledger still W3/W4 building, W8 environment blocked. New worktree6fe114 isolates the candidate. Eight ledger tests and RC-2 ancestryeb4fda passed. Implementation and final gates pending; existing collaborator access blocks draft PR creation. No live deployment/migrations/provider activation.

Offline locked222 dependency install354fda and contamination tests/scan37ada3 pass with unchanged template warnings. Preliminary independent source review6df111 accepted identity design: a fresh identity object on committed state/context/parent/ack/conflict change prevents eligibility roundtrip resurrection; read/save admission clears preview even if transport later fails. Root diff0dd13a agrees no transport payload or prior authorization logic changed. Unchanged protected source families557394 verified. Final full regression and independent tests remain pending.

Builder final53-test focused regression39aa20 (27 existing editor,19 host,7 new preview tests) and portal typecheckf3901d passed. Adversarial17 tests248515 and typecheck3d099f passed, including pre-layout identity absence, same-stack busy/open, edit/reorder/kind/limits/remove retirement, parent eligibility roundtrip, conflict/failure gating and exact save payload exclusion. No implementation defect required a repair cycle in this increment.

Root full portalc4741b passed226 tests across30 files. Independent24 new-test replay8b8e01 passed. Frozen source SHA256 `A4BAA5096365192962D15419F4A200AF86477FE7626392CC15DB0DB0BDED2634`, unit `7B6BD3435C5E46BFC0C47F5A22EBEF34CA7C12D985F39BEE35AB5383F7E02AFA`, adversarial `4126477B4817D51DE8F59A72442558AEBEA1C826AE764D7351C1D5F365A4ABE8`; independently verified0010c2 and rootab3aff. Existing editor/host tests, V1 and preview component are unchanged. All tests use qualified Node24.19; DOM results do not certify a real browser.

Next: actual browser qualification of the local V2 host/editor/preview, including keyboard, responsive layout, navigation/discard, context replacement and no submission. Exact-candidate CI, Release and hosted acceptance remain pending; no full-wave promotion or production registration.

Final independent scope2440a5 and staged whitespace/five-path checkef87ff pass. Builder freeze/typecheckf3901d and root full226 regression satisfy every scoped local review condition. `/root` concurs with independent Integration/local Runtime Guardian acceptance for review-branch publication. Earlier pending local-review statements are historical checkpoints now resolved; hosted CI/Release and browser gates remain explicitly open.
