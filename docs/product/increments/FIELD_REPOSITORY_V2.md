# V2 draft repository candidate

Base `9e1c24771d37096d7c984345f39f72898c27d8f7`; isolated branch `codex/wave3-field-repository-v2`.

This increment builds an unregistered server repository for the reviewed V2 storage RPCs. It does not expose an HTTP endpoint, change migrations, enable publication, convert V1 drafts, or activate a provider. Request byte bounds and real authenticated HTTP composition remain separate required work.

## Ownership and gates

- `/root/field_contract_builder`: repository implementation and unit tests.
- `/root/text_draft_client`: independent adversarial tests, exclusive separate file.
- `/root/evidence_recovery_review`: architecture/domain and independent source/test review, no implementation edits.
- `/root`: documentation, ledger, integration and local Runtime Guardian coordination.

The repository must use fixed parameterized SQL, validate and copy arguments before acquiring a connection, preserve tenant/flow/actor identity, validate receipt versions and save association before commit, expose finite sanitized errors, and discard connections when a submitted commit has an uncertain outcome. The existing V1 repository and accepted storage migrations remain unchanged.

## Status

Implementation, unit, domain, independent and adversarial review passed for the standalone fake-client adapter scope. Integration and local Runtime Guardian accept review-branch publication only. Native PostgreSQL repository wiring and HTTP authority are not proven by fake-client unit tests. Main remains protected at `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead`; PR74 remains draft at `c53debbaa9e6fa2acc7bfe2aca96026e4450a194`. The predecessor storage candidate has zero hosted CI runs; draft PR creation is blocked by GitHub collaborator access. W3/W4 remain building, not complete.

## Execution evidence

Locked offline dependency installation ee8da7 installed222 packages with lifecycle scripts disabled. Eight ledger tests943b8d and contamination failure-mode/scan e6fbb5 passed; existing vertical-template warnings were unchanged. RC-2 ancestry and unchanged migrations, lockfile and CI were checked. Root API typecheck4abd6b passed. PR74 exact-head CI34743351848 remains successful; this is predecessor evidence only.

Independent review returned the runtime RPC-name guard: Object.hasOwn can coerce an unexpected object key. The builder must reject non-string names before that operation and test that coercion is never invoked. Final affected tests and independent acceptance remain pending. The finite mapping for exact FIELD_DRAFT_FAMILY_CONFLICT/23514 is CONFLICT; unrelated constraint errors remain INTERNAL_ERROR, with no automatic retry or conversion.

Root full API regression286d89 passed981 tests across28 files under explicit Node24.19, normal fork pool with two workers. That run began before the final RPC-name guard repair; final targeted replay is required to cover the repair and is recorded separately. It does not constitute native repository/database execution.

Builder repaired the RPC-name finding with a primitive-string guard before key lookup and an explicit hostile Symbol.toPrimitive regression. Final builder26 tests passed78ea68 and API typecheck5f6faf passed. Frozen source SHA256 `98AA881C118B48CB443BFE3D67FE278090C5D4F633ED9880E690C87E66EBEF72`; unit test `362060B14A7B7F642FA1A70EC81DFC4A62143BC92CE15A5B6B4078E4805DDCF3`. No native database proof is claimed for this adapter.

Independent adversarial cell final31 tests passedfffab4 and API typecheck9b0d94 passed. Test file SHA256 `DA3854C27C247B3A42E1ECEB289CEF7A513DA2E250DFE39364DD9561964E31A7`. An initial test-only failure compared JSON property insertion order; it was repaired to structural equality without weakening exact string, RPC identity, transaction order or argument binding checks. Final independent reviewer replay follows.

Final independent review ddf566 passed57/57 tests across both repository files using explicit Node24.19, normal fork pool/two workers. Reviewer verified all three frozen hashes bc39a9, repaired guard331bbb, exact five-file scope, clean whitespace and ledger link only with building status unchanged. `/root` concurs with scoped Integration and local Runtime Guardian acceptance for review-branch publication. This accepts fake-client adapter behavior only; native PostgreSQL adapter execution, authenticated HTTP composition, exact-candidate CI and Release Governor remain pending. Next implement and independently qualify a bounded disposable native repository harness before HTTP activation.
