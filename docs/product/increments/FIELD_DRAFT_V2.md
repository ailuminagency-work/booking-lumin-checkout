# Versioned mixed-field draft boundary

Base `29c42846e2ea79728a7e42fd62ba5d64301685f9`, isolated branch `codex/wave3-field-draft-v2`. This W3 increment defines save/read/receipt envelopes for the [mixed text/textarea contract](FIELD_V2_CONTRACT.md). It adds no route, client, database table, conversion or publication capability.

## Envelope rules

Save requires literal fieldDraftVersion2 and parentAuthoringVersion2, a schemaVersion2 definition, expectedRevision (zero creates only), and expectedFlowRevision (positive). Revisions are safe integers; negative zero is rejected. MAX_SAFE_INTEGER remains a readable/suppliable token; future storage must reject increment overflow. Tenant, actor, role, access and price fields are not admitted into these envelopes.

Receipts require positive draft, saved-parent and current-parent revisions, with current-parent at least saved-parent. runtimePublishable must be false. Staleness is derived from parent revisions; caller-supplied stale is rejected. Missing reads explicitly contain no definition, draft revision or fabricated stale status. Present reads contain one strict receipt. The parsers return detached frozen data and a finite public error for malformed input, including failed reflective traps. They do not authenticate a caller or execute CAS.

The parent authoring discriminator is not proof that a real parent is V2. A future server must resolve the tenant/flow, check current owner membership, actual parent version and both revision predicates transactionally. Revision identity is tenant + flow + draft family/version + revision + parent binding. Equal numeric V1 and V2 revision tokens are unrelated.

## Persistence and conversion plan

Existing V1 sidecar SQL and APIs remain immutable in this increment. V2 must have an explicit versioned route/capability/receipt; it may not use the V1 text endpoint or fall back to V1 decoding. No transport or database byte limits are implied by pure object parsing. A future route must enforce a reviewed raw-byte budget before JSON decoding and separately validate stored JSON size.

Before creating a writable V2 sidecar, implement one authoritative draft-family state per flow, serialized with the parent flow lock. Existing V1 writes and V2 activation must participate in that invariant. An initial V2 create on a flow already carrying a V1 draft must reject until explicit conversion exists. If inconsistent dual-family state is observed, fail closed instead of choosing the most recently read or modified sidecar. Independent writable families are not an acceptable intermediate production state.

Conversion is a separate, user-reviewed operation. Its transaction must bind source V1 revision, destination expected revision, parent revision and authoritative-family transition; preserve the source for audit/rollback, validate exact keys/order/prompt omission, and reject incompatible values rather than silently sanitizing. V1 readers after transition need an explicit unsupported/historical response policy. No automatic import, upgrade, destructive replacement or downgrade is implemented here. Eventual publication must bind an immutable combined identity, not a floating draft pointer.

## Ownership and verification

- `/root/field_contract_builder`: new fieldDraftV2 module and unit tests only.
- `/root/text_draft_client`: independent adversarial tests only.
- `/root`: named exports, cross-version boundary tests, documentation and ledger; integration/local Runtime Guardian coordination.
- `/root/evidence_recovery_review`: independent architecture/domain/source/adversarial review, with no implementation edits.

Builder six tests passedfd13ef and workflow typecheck6add52. The independent adversarial cell passed23 tests2e918d and workflow typecheck1d0959. Independent source/domain/adversarial review7aa9ca/f1e7d3 replayed all32 new tests including the root's three cross-family boundary cases. Full workflow regression7e8199 passed175 tests/18 files; downstream shared UI2cd426 passed382 tests/13 files. No test failures required a production repair.

Root typecheck chain0d15fe completed workflow and shared UI but then used the nonexistent apps/api path; it failed as an invocation error, not an application type error. The correct API package is packages/action-api; its result follows below. Eight ledger testsa8e815 and contamination checks7e5a0f passed with unchanged existing template-term warnings. V1 parsers, capability registry, migrations and lockfile were unchanged; whitespace and RC-2 ancestry passed7e5a0f.

Frozen module SHA256 `1E0242D2F4429C90C04ED56412B41BF6397419856C407AE1EC41C54166EF7B8B`, builder test `75BBFCA91540526DA2304B55F683EA83F9FE2A170229105BDC478E5F82E1D14F`, independent adversarial test `820F20CDDA2944D6B889F46A1FDF9DD84578E4251E9D7D0116CD8EFA6F76A0CE`. Dependencies were installed from the unchanged offline lock with lifecycle scripts disabled,222 packagesb0b11e.

Corrected API typecheck2c5505 completed without diagnostics, exit0, and the action-api package diff was empty. Frozen hashes remained unchanged0a3e34. Independent final seven-file reviewdb0adc passed; root Integration/scoped Runtime Guardian concur for tested review-branch publication only. No database/browser qualification is asserted for this pure transport contract. Exact-head CI and Release acceptance remain pending.

Pure contracts require no live migration, database or browser activation. W3 remains building; exact-candidate CI and Release review remain mandatory. Hosted acceptance and W4-W8 remain incomplete. Next implement and independently test the authoritative-family concurrency invariant and versioned persistence boundary before exposing V2 authoring in the portal.
