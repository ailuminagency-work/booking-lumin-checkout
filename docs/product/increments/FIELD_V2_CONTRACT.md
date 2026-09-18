# Versioned text and multiline question contract

This W3 increment starts from `4bbae7f98bb3e49b80c014a167a6f2ee34453fd0` on isolated `codex/wave3-field-v2`. It extends the approved field model with a separately named schemaVersion2 contract for mixed text and textarea definitions. It does not change existing schemaVersion1 text drafts, APIs, SQL validators, UI, publication or customer answer retention.

## Contract and compatibility

Both definition and answer envelopes require literal schemaVersion2. Only text and textarea kinds are admitted. Keys, optional single-line prompts, required flags and length bounds retain the established definition rules. Documents accept at most64 fields/answers. Parsers reject unknown properties, invalid prototypes, accessors, symbols, sparse arrays, duplicate keys and unknown answer keys; accepted results are detached and frozen. Reflection on hostile proxies can execute traps, so callers must not treat arbitrary JavaScript objects as a sandbox.

Answers preserve exact strings, with no trimming or Unicode/newline normalization. Text rejects CR, LF and Unicode line/paragraph separators. Textarea accepts these sequences literally; CRLF counts as two codepoints. Both kinds reject NUL and unpaired surrogates. Required whitespace-only answers fail; optional whitespace bypasses the minimum, not the maximum. Each value is bounded to8192 UTF-16 units and its configured maximum of4096 codepoints. The sum of provided values is bounded to65536 UTF-16 units. These content limits are not transport-byte limits: a future HTTP adapter must enforce a separately reviewed raw byte limit before decoding JSON.

V1 intentionally remains unchanged, including its existing NUL answer behavior. Existing textDraftVersion1 routes and SQL require schemaVersion1 and cannot accept this contract. There is no automatic conversion or migration. The current capability registry continues describing the existing contract; its renderer, persistence and publication flags remain false. Named V2 exports do not imply V1 or public-runtime support.

Browser textarea controls can normalize line endings. Exact parser preservation does not certify a browser import/export round trip. A later renderer must document that behavior rather than silently promising byte equality.

## Ownership and gates

- `/root/field_contract_builder`: two new parser modules and their two unit-test files.
- `/root/text_draft_client`: independent adversarial test file; no production edits.
- `/root`: named package exports, cross-version boundary tests, evidence and ledger; integration and local Runtime Guardian coordination.
- `/root/evidence_recovery_review`: independent architecture/domain/source/adversarial verification; no implementation edits.

Architecture review confirmed that migration0032 hard-requires schemaVersion1 and has a separate SQL size limit. Those constraints are preserved. A future persistence increment requires a versioned capability/route/receipt and an explicit old-reader compatibility design. No public field activation is included here.

## Evidence and remaining work

Locked dependencies were installed offline with lifecycle scripts disabled (222 packages,14b0c4); lockfile and dependency versions remain unchanged. This pure contract increment requires no live provider, database migration or browser deployment.

Builder nine unit tests passed7c7f19; independent adversarial cell19 tests passed667c6d; root package-boundary three tests passedcc5729. Initial workflow typechecks66e5f8/ed24c0 observed the root boundary test before the named exports had been integrated, so they failed for missing exports. After the planned export integration, workflow typecheck passeda65774. No parser logic or assertions were weakened. Independent reviewer replay283b55 passed all31 new tests and accepted architecture/domain/adversarial scope after source reviewsb59775/dffa6f. Full workflow regression166c7f passed143 tests across15 files, including unchanged V1 suites.

Frozen builder source hashes: document `112095B9CF9FA952E1764A3B33BB797BE3CC4852E22198C7605E2FC34D8CC9D7`; answers `5D0E22A84A3A9BD6AB9E10EDDBD9D5AFB2910693AA177A7F28A10F97F533688F`. Independent adversarial file `17BBDBE376E5C63C1997BAB3CBF5D4852BF8E8940E08FC7C46358D91C7B2C917`. The reviewer confirmed no mutation/persistence/customer-runtime path was added. Pure executable contract tests establish only this local validation boundary, not database or hosted acceptance.

Downstream shared UI regression80fde2 passed382 tests. Eight ledger tests94db78 and contamination82d5b1 passed with unchanged existing template-term warnings. The same verification confirmed unchanged V1/parser/registry/SQL/lock files, whitespace and RC-2 ancestry. Frozen source hashes remained stable8ebd44. Independent final nine-file scope review005ba0 passed; workspace typecheck completion is the remaining local publication condition at this checkpoint.

Final workspace typecheck7180c8 exited0 after all workspaces, satisfying the independent review's remaining local condition. Root Integration and scoped Runtime Guardian concur with review-branch publication only. No database or browser acceptance is asserted or needed for this parser-only change. Exact-head CI and Release remain pending.

W3 remains building. Exact-candidate CI and Release Governor acceptance remain required. Next define the versioned persistence and conversion boundary under independent review before wiring these definitions into the owner editor or customer runtime. W4-W8 and hosted acceptance remain incomplete; no full-wave completion is claimed.
