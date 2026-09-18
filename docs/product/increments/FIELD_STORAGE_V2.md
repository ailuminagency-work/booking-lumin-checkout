# Isolated V2 draft storage candidate

Base `ee60d3ee919d0f0d742cc84f6828533fdb78428b`, branch `codex/wave3-field-storage-v2`. This additive migration candidate implements the [reviewed V2 draft boundary](FIELD_DRAFT_V2.md) in disposable local tests. It is not a live migration, deployment or HTTP capability.

## Storage invariant

Migration0034 introduces a durable tenant/flow draft-family claim, protected by a unique key, forced RLS and denied direct application-role access. Existing V1 sidecars are backfilled as family1 while migration table locks exclude supported writers. V2 definitions use a separate table and owner-authorized get/save functions, parent-version checks, two revision predicates and safe-integer overflow rejection. Stored definition JSON has a separate32KiB canonical SQL size limit; no customer answers are stored.

Both V1 and V2 sidecar triggers claim the same unique family identity; competing claims serialize through the unique index rather than relying only on a stale opposite-table query. Family and sidecar identities cannot be changed, and family claims cannot be deleted. There is no conversion or automatic family release. Legacy get/save functions are replaced additively in0034 to fail closed on a conflicting family; accepted0032/0033 files remain unchanged. Supported writes keep membership → flow → parent → family → sidecar lock order. Privileged maintenance can take different locks and is not certified as deadlock-free. Superuser trigger bypass is outside application RLS guarantees.

Repeatable-read writers with a stale competing claim must abort rather than create both families. Historical repeatable-read readers can see their old snapshot; this is not a promise of latest-value reads across isolation levels. No new HTTP route is exposed.

## Ownership and test design

- `/root/field_contract_builder`: migration0034, serial SQL tests and pre-upgrade fixture.
- `/root/text_draft_client`: bounded native concurrency/parity harness and its inert tests.
- `/root`: supervision scripts/tests, CI registration, documentation and ledger; Integration and local Runtime Guardian coordination.
- `/root/evidence_recovery_review`: independent architecture, source, adversarial and runtime evidence review; no implementation edits or database execution.

Two pre-execution returns were repaired. Root found that the race harness tried to read the denied authority table as service_role merely to establish a snapshot; it now uses pg_current_snapshot without weakening privileges. Independent review found missing upgrade coverage; a committed synthetic V1 revision2 fixture now runs after0033 and before0034, with mandatory post-upgrade exact-data/revision/backfill/V1-read/V2-denial checks.

The new runner uses a fresh UUID database and bounded private evidence. It runs34 migrations, the upgrade fixture, existing V1 serial/race/native HTTP gates, V2 serial assertions and14 observable concurrency cases plus32 SQL/TypeScript parity cases. Its exact successful total is45 steps. All roles are tested for denied direct table/helper access; races include both family winner orders, commit/rollback, read-committed/repeatable-read snapshots, competing V2 saves, parent changes and membership revocation. Actual runtime results follow below; test design alone is not acceptance.

Existing runners now expect34 migrations: legacy SQL/native total42 steps and legacy browser journey43. Their paired inert tests were updated without changing the existing acceptance assertions. The V2-specific pre-migration hook is opt-in and source-pins its fixture. Existing CI job identities/timeouts remain unchanged; a separate bounded V2 storage job and inert supervisor test are proposed for review.

## Evidence and remaining gates

Pre-execution review316d9f/059b9b approved local execution after verifying the repaired frozen sources. Independent inert11c57f/b66d24 passed5 new runner +9 legacy runner +3 journey tests; root17 tests passeda1c5f5. Native harness4 inert tests and API typecheck passed0d18a1/6cfe93. Full API regressionf02af1 passed925 tests/26 files under explicit existing Node24.19; no default runtime or test pool changed.

First actual public run994255 failed SQL at step40, UUID `7d2ee015-5dba-4121-a40b-29d7e9ed11c2`. Finite classification24553f confirmed a multiple-row scalar subquery: the committed upgrade fixture collided with the unchanged legacy suite's global fixture assertions. This was returned to the builder; no failing assertion was removed. The revised runner now executes V2 upgrade/serial verification immediately after0034, before legacy suites. That suite verifies the exact preexisting synthetic row, temporarily removes only that sidecar within its rollback transaction, then validates and removes that exact restored fixture sidecar after successful assertions. Its sticky family claim remains. No tenant/flow/authority deletion or permission weakening occurs.

The opt-in before/after migration hooks preserve ordinary legacy runner behavior. The revised V245-step sequence is fixture38, migration39, V2 serial/fixture isolation40, legacy SQL41–42, legacy race43, legacy native HTTP44, V2 race45. Inert ordering/failure tests prove a serial error stops before legacy execution; root10+3+5 tests passedb06b47. Failed artifacts remain preserved. Fresh runtime replay is required after this repair.

Second actual public run6d7700 failed legacy SQL step41, UUID `e24b2b61-2eb8-4c46-bb45-c0095d374505`. Finite classification237a32 confirmed the new sidecar trigger emitted FIELD_DRAFT_NOT_AVAILABLE for a missing composite parent, changing the legacy direct-insert FK error expected at test line105. Root returned this to the builder to preserve SQLSTATE23503 in the trigger while retaining the RPC's existing unavailable precheck. The upgrade verification step passed, but the run is not accepted. No legacy assertion or tenant-boundary check is waived.

The scoped foreign-key repair and new direct cross-tenant insert assertions for both families passed independent pre-execution review41df9b. Final migration hash `279254D065659738AA932337175AD4DFA0F4920F2265E08759A14641AA12836F`; final serial suite `1D61CC658A22E7E6E53C1F79BAE4D4C53711515ED684776331AC12BA722AD731`. Fresh public replay1ea948 then passed all45 steps, actual exit0, UUID `a5b8643d-7663-4dad-b47e-b1eef4fbe2d0`, source digest `6423518f25db5d11a234842af0f79587f38392f5366c6f49ccaebc12353dafe1`. The digest observes same-run sources rather than establishing provenance. Both earlier failed runs remain retained.

Eight ledger tests, contamination checks, RC-2 ancestry and unchanged0032/0033/lock verification passed799408. The added CI job has a20-minute overall limit and a13-minute two-layout step, preserving all existing job identities/timeouts; the increased step margin follows independent review. Linux exact-candidate CI has not run.

No exact-candidate CI, Release, hosted authentication, deployment or full W3 acceptance is claimed. W3/W4 remain building. After local storage qualification, implement the opt-in V2 repository/HTTP/client path under the same authorization gates; conversion and public publication require separate design and tests.

Final extensions replay49f45e passed all45 steps, exit0, UUID `93c8be9b-c988-4890-804d-de8da5722220`, with the same observed source digest as the successful public run. Independent reviewer `/root/evidence_recovery_review` verified both evidence sets (a7967f/a821d9): exactly91 regular bounded single-link files per layout, no observed reparse points, zero native stderr, legacy concurrency6 cases/45 parity cases, native HTTP9 groups/33 requests, and V2 concurrency14 cases/32 parity cases. All native connection/server closure receipts passed.

Independent scope review8e5608 confirmed exactly14 intended paths and clean whitespace; CI source reviewc22a0d accepted the proposed separate bounded job, pending actual Linux execution. `/root` concurs with scoped Integration and Runtime Guardian acceptance for tested review-branch publication only. Both failed runs remain recorded above. Exact-candidate CI and Release Governor acceptance remain pending; no live migration or V2 HTTP activation is authorized by this evidence.
