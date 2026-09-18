# Native V2 repository qualification

Base `fa48d3594a838652f9e469f487d4a51bff5d5ec9`; isolated branch `codex/wave3-field-native-v2`.

This leaf qualifies the existing V2 repository against a fresh disposable local PostgreSQL database. It adds no HTTP route, production configuration, migration or provider activation. It preserves the previous45-step storage/legacy gates and adds a bounded native repository check as step46. Real hosted Auth, Linux exact-candidate CI and Release remain separate requirements.

Ownership: `/root/field_contract_builder` owns native harness and inert tests; `/root/text_draft_client` owns supervisor and inert tests; `/root/evidence_recovery_review` independently reviews source, adversarial safety and finite runtime evidence; `/root` owns CI, this evidence, ledger, Integration and local Runtime Guardian coordination. No builder may execute database tests before independent source review.

Main remains protected at152bb909; PR74 remains draft atc53deb; predecessorfa48d359 has no CI runs. The GitHub collaborator blocker remains unresolved. W3/W4 remain building. The final local native qualification passed as recorded below; hosted CI and Release remain unaccepted.

The new CI step permits15 minutes for two bounded420-second layouts plus cleanup margin; the job remains20 minutes. Existing unrelated jobs are unchanged. Native repository tests cannot prove HTTP authentication, hosted tenant isolation or uncertain-commit fault injection.

Pre-execution checks: offline locked222 dependencies79d1dd; eight ledger tests/RC-2 ancestry/unchanged repository, migrations and lock b12e91; contamination tests/scan d8fd4b passed with existing template warnings. Root supervisor eight inert tests129887 and API typecheck2477bc passed. Root returned the initial90-second harness watchdog because the supervisor allows60 seconds; builder reduced it to55 seconds before execution. No runtime result is inferred from these source checks.

Independent pre-execution review915621 verified all four frozen hashes; three native inert testsb5dbc0 and eight supervisor inert testsb5fd75 passed. Reviewer approved fresh disposable public/extensions execution. Root full API regressionb9d8a8 passed985 tests across29 files using explicit Node24.19 and two normal fork workers. Public runtime2ccb13 was then started; final results are recorded below.

Public native replay6ed11f passed all46 steps, exit0, UUID `20482fed-89c9-4c95-b7cf-d0830b3dddb1`, observed source digest `c2da66e8339a0b4920394cc536e9754932c645d3532d192e17132dff3b4d6930`. The digest records same-run source consistency, not independent provenance. Extensions replay and independent finite evidence review subsequently completed as recorded below.

Extensions native replay7048c9 passed all46 steps, exit0, UUID `258af183-2477-4e38-b8f6-521134b885e0`, with the same source digest. Independent public verification99b893 confirmed exactly93 regular bounded single-link files with no observed reparse points, zero stderr for native steps43–46, legacy6 races/45 parity cases, legacy HTTP9 groups/33 requests, V2 concurrency14 cases/32 parity cases and actual repository6 groups; all cleanup receipts passed. Final extensions/scope review passed as recorded below.

Final independent review b1ed28/99b893 accepted both layouts: the extensions evidence has the same46 successful steps, all native closure receipts, zero native stderr, exactly93 regular bounded single-link files, no observed reparse points and matching current source digest. Scope review212242 confirms exactly seven intended files and clean whitespace. `/root` concurs with Integration and local Runtime Guardian acceptance for tested review-branch publication. No additional database run is justified without a source change or new defect.

This qualifies the real V2 PostgreSQL repository for the six bounded case groups. It does not qualify HTTP authorization, hosted Auth, native uncertain-commit fault injection, exact-candidate CI, Release or full W3. Next add the opt-in V2 HTTP boundary and independently test request byte limits, authorization and receipt validation before any activation. No live migration or deployment occurred.
