# Field publication rollback proof

Parent3babbc639e25ca2ce2a99e4cd155a3be1af7288b; isolated branch codex/wave3-field-publication-rollback-proof. Test-only hardening of the unregistered storage candidate. No candidate SQL, accepted migration, API, provider or supervisor change. Existing56steps/113artifacts and time limits remain fixed.

## Ownership and gate scope

/root/next_leaf_review_1941 is fixture builder, exclusively supabase/tests/field_publication_storage_v1_tests.sql. /root/editor_design_review_2043 independently handles domain/source/actual-native Runtime review. /root/choice_editor_builder_2043 independently adversarially reviews new fixture additions, not its own unchanged SQL. Root owns this evidence and ledger, serial checks and integration.

Preflight84740e/de8340: narrowly scoped AFTER INSERT injection on a valid unpublished tuple, distinct custom SQLSTATE/message, exact full artifact/source/legacy state before/after; remove trigger and retry same UUID/revisions successfully. Separate post-success exception inside a subtransaction proves rollback of a successful RPC and retry without poisoned reservation. Explicit role restoration and outer fixture rollback. This is sequential failure recovery, not independent-connection race proof or HTTP authentication.

## Resume

Heartbeat2026-09-20T06:51Z workflow/prior evidence7cfff5; clean parent. Main152bb909 protected flag and PR74draftc53deb unchanged; parentActions0. Branch a4eb9a. Ledger0ce8a1 W3/W4active; unchanged supervisor12/12inert passed. Detailed protection403 and collaborator422PR blockers remain; no invented exactCI/Release. W3-W8incomplete,W9excluded. No live migrations/deployment/merge.

Source freeze, independent reviews, both fresh native layouts and scoped final Runtime review completed as recorded below. Race testing, comprehensive TS/SQL parity, post-candidate full regression and migration registration remain next gates; this proof cannot substitute for them.
## Local evidence

Builder1fbe96 fixtureA8F9EF8D7F490D02B1A219719789EFAA4EE9CC43EE06DFC0E44DB6DD11CC168F; root7095aa confirms unchanged. Independent domain/source74e857 and adversarial ebb690/e9db01 accepted actual additions before native. Exact PZ001/PZ002 message/state plus positive handler flags reject false positives; unexpected exceptions propagate. Full18table ordered row snapshots cover authoritative source, artifact and legacy state. Existing assertions retained.

Unchanged supervisor12/12inert0ce8a1, ledger8/8 33d3d0, contamination50037e passed. No weakened settings or implementation failure. Public fresh56steps2f4e30 passed rund3a90be5-018f-44e0-b954-29ae7e5a167e digest882990cc8aaba925dddb7c2b306d4d3b71e359230f73a92788416be5ac7b3982. Independent actual-artifact review and extensions completed as recorded below. This proves neither crash recovery nor concurrent publication isolation.

Fresh mainCI34298760622/PR74CI34743351848 remain successful on older exact heads only. Current CI/Release pending and collaborator access blocker persists; no PR fabricated. No full wave or storage promotion.
Public independent audit8de720 accepted113artifacts/384currentpins/matchingdigest/strictpriorreceipts/candidateCOMMIT/fixtureROLLBACK/zero56; root9c560b independently observed zero sessions. Extensions56stepscec433 passed run232fb362-b681-4aa3-b9a2-6ed4e1b123db with same digest; independent final audit32ebca passed. Rootf64644 confirms unchanged candidate/supervisor/inert hashes and whitespace. Candidate-specific validation now covers insert-stage and caller-subtransaction rollback with retries, not process/database crash recovery.

Next bounded work: reviewed independent-connection publication race harness (parent edit, sidecar save, archive, owner revocation and duplicate publication orderings), then broader generated TypeScript/SQL parity. Migration registration/harness compatibility, post-candidate full regression, API/runtime consumers and hosted/CI/Release remain unqualified. No accepted system changes.
Final independent Runtime /root/editor_design_review_2043: extensions audit32ebca accepted113artifacts/384currentpins/matchingdigest/custody/strictreceipts/SQLclosures/zero; public8de720 also accepted. Root separate extensions7975b4 observed zero sessions. Three-path finalscope512185 and whitespace clean; ledger remains building. Root integration accepts sequential rollback/retry evidence only. Historical pending wording reconciled before commit. Exact-candidate CI and Release remain pending; no promotion, deployment or full-wave acceptance.
