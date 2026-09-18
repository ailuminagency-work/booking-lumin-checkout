# Read-only text draft conflict comparison

Base: `47947c173ac0032275af9fc03a8eb3b7be04d07e`, isolated `codex/wave3-text-comparison`. This continues [the owner preview increment](TEXT_PREVIEW.md) within W3 fields/workflows while draft PR access and exact-candidate CI remain blocked. It does not complete W3.

Previously a version conflict preserved local edits but required discarding them without seeing the saved definition. Check latest version now displays both definitions when it finds a different saved revision. The view compares stable field keys, exact labels (including omission), required settings, limits and positions. It explicitly describes the saved side as a fetched snapshot, which can become outdated.

Comparison never merges, saves, updates the local revision, or authorizes a write. The owner must explicitly discard/reload before saving after a changed revision. Existing server CAS remains unchanged. Repeated reads replace the snapshot; failed reads clear it. Context changes immediately hide it and ignore stale completions. Invalid local or saved definitions make comparison unavailable without discarding local edits. Customer answers, publication, live migrations and provider connections are unaffected.

## Ownership and gates

- `/root/field_contract_builder`: pure workflow comparator and tests, two exclusive files.
- `/root/text_draft_client`: shared comparison component and tests, two exclusive files.
- `/root`: editor integration/tests, existing SQL browser journey extension and evidence; integration and local Runtime Guardian coordination.
- `/root/evidence_recovery_review`: independent domain/architecture/adversarial review and finite runtime evidence review, no implementation edits.

The comparator strictly parses both unknown inputs through the existing contract, returns detached frozen entries and bounds the union to128 fields. It distinguishes additions/removals from metadata and order changes. It executes no getters. The UI renders React-escaped text, preserves whitespace visually, has accessible table headers and exposes neither internal keys nor action controls.

Builder comparator six tests and workflow typecheck passeddb535a/d37f0c. An initial test fixture inferred too narrow a type; the fixture was corrected before freeze, production logic unchanged. Component eight tests and typecheck passedeeda4b/0874e0. Root editor27 tests passed084fab, including seven new preservation/context/read-failure checks. Full workflow112 tests passedff95b7 and shared UI382 passed4dc9b0. Remaining final checks and independent runtime evidence are recorded below once observed.

Dependencies were installed from the existing locked offline cache with lifecycle scripts disabled. A wrong npm executable path failed before installation; the corrected sandbox invocation hit cache permissions. Owner-context offline installation then completed222 packagesa88468. No dependency or lockfile change.

## Remaining acceptance

Independent preexecution source/domain/adversarial reviewc52e62/4dcb67/a12cb1 passed. Independent focused suites passed six comparator3b67c6, eight UIb94bef and27 editor3a3e54; an initial wrong comparator test path found no tests and was corrected. Full portal155 tests passed3227e7; corrected assertion plus27 focused tests and production build passed74b6c2. Portal and strict journey fixture typechecks passedcd0891 after the initial550ee8 test-only unknown-body property error was corrected to a structural assertion.

An additional invalid-local-number regression passed in the final28-test editor run384b16. Independent narrow test/document/ledger review967f11 passed. Ledger status remains building; only its evidence link changes to this increment. Eight ledger tests0e3c4c and contamination checks1a880f passed, with the same existing vertical-template warnings. Local journeys and final cleanup are still pending at this checkpoint.

Subsequent fresh local journeys passed: publicb81c4e UUID `8d90c8e7-9567-46a6-93cc-b41d64984d04` and extensions5c67c0 UUID `1378faa7-d520-4cbb-ac61-fe6c2a50d257`, each actual exit0 and42 steps. Both observed source digest `ea3fab4eb585f4850c0acf84e7d3ed3c68616dcf7995a82e41869a0bd7d884d4`; this is same-run evidence rather than provenance. Independent public review2de99d verified85 bounded regular single-link files, no observed reparse, empty native stderr and complete closure: race6/45 parity, native9 groups/33 requests/24 text/6 legacy calls and6 browser groups. Raw SQL logs are not published.

Final portal typecheck, whitespace and RC-2 ancestry passed3ab50b. Source hashes observed91ab1a bind the frozen comparator `18FB93A966099D11F003B41A7D29D767B9EAD2D2F50F6F06E54B51866EB346C5`, shared UI `083FDA224E7C1633FB3333482F637E85C5C663742BDD9C6CF505F4B979B1675C`, editor `005522387645CFDB73A7FD09D5099E75DB82E0597DB6A36AC0AAB8C5431C2CE9` and browser cases `ED55AE1B08BCD981E5ED145A7E7D2CF1DE4287083B44FB006F02B13222E12392`.

Independent extensions reviewf5d009 verified the same complete counts, cleanup and finite85-file custody observations, with the current digest matching. Root cleanup4c6edc observed zero scoped browser processes and refused connections on ports4189/4191. Independent and root scoped Integration/Runtime decisions permit the nine-file tested review branch only. They do not substitute for exact-head CI, Release review, hosted authentication or whole-wave acceptance. No enduring artifact-custody guarantee is claimed.

Exact-candidate CI and Release Governor acceptance are mandatory and pending. Existing PR74 and all successor branch bases remain protected from rewriting. No branch push implies hosted authentication, full-wave completion or deployment. Continue remaining field/workflow capabilities after this local increment, preserving the nonpublishable public-runtime boundary.
