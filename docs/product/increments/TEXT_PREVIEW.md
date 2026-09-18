# Owner text-question preview

This W3 fields/workflows increment adds an in-memory rehearsal to the existing owner text editor. It is based on `80744b33b171ecf0ad074e05dca942faff2889dc` and preserves the review stack. W3/W4 remain active; this is not full field-engine, publication, hosted-authentication or release acceptance.

The owner can try valid text definitions, check required answers and Unicode codepoint limits, and close the preview. Answers are never sent to a client, API or storage. Editing a definition, reloading, changing account/capability or leaving the page clears the preview. Preview interaction does not make the definition dirty. Saving continues to send definitions only. The existing disabled-by-default editor boundary and nonpublishable text runtime remain unchanged.

The shared component strictly parses unknown definitions before rendering, escapes text through React, distinguishes own answer keys from inherited properties, associates errors with inputs and prevents Enter from submitting an enclosing form. Exact answer strings are preserved. An edit exceeding 8192 UTF-16 units is rejected without truncation. These are owner rehearsal controls, not authorization or customer submission controls.

## Identities and ownership

- `/root/field_contract_builder`: new shared component and its tests only.
- `/root/text_draft_client`: portal editor integration and its tests only.
- `/root/evidence_recovery_review`: independent architecture, domain, adversarial and runtime evidence review; no implementation edits.
- `/root`: browser tests, evidence, integration coordination and local Runtime Guardian decision. Exact-candidate CI and Release Governor remain separate pending gates.

## Tests and returned defects

Root returned missing per-field invalid state, enclosing-form Enter behavior and inherited answer-key handling to the component builder. All were repaired before the frozen review. An editor test initially used an obsolete button label; the selector was corrected without weakening assertions. The context reset also releases the old preview-definition reference.

Frozen component/test SHA256: `389B8B7FA1C26BD56CCDF933ADD02E4BB4307BDCCC9B72203FB77681048DE9B8` / `CFD4510E8D2E0896325182DFF48E29BA463F169FF4605D9655D32C002A71EA7F`.
Frozen editor/test SHA256: `5447021CD52CE534BA86FAD435BB41E2954A406CD6B161522D5BDC86D5A361C8` / `56C307637D61C265868EFB92B013B834AB9A0350CF99BAC0DE3C8365A10819A7`.

Explicit existing Node24.19 Windows profile from WINDOWS_NODE_RUNTIME.md was used. No machine default runtime or test-pool configuration changed. Full shared UI: 374 tests/12 files (c83c04); full portal: 148 tests/24 files and production build (478ab2). Builder typechecks passed. Independent focused suites: seven component tests (801e80), twenty editor tests (702584). Standalone fixture/spec typecheck passed c340f8 with strict mode; the initial command omitted strict mode and failed43e2a6 in existing inferred contract types. No source was changed to hide that invocation error.

Synthetic browser012c3f: actual exit0, nine passed, zero failed/skipped. New cases cover local-only preview, exact inert markup/Unicode values, close/reopen, navigation without false dirty state, codepoint validation and account reset. Independent artifact reviewe85123 found only the bounded successful last-run receipt, regular single-link with no observed reparse; the exact case count comes from the process reporter rather than that artifact.

Fresh public-layout journey7d53e8: exit0, 42 steps, UUID `1b850e78-eb70-4ef1-85bf-9e18e2dbcde4`, source digest `8f35ef634b80f8dd0f2c5219d087cd0159c940efb737cd785f19e7dc351c95a7`. Existing six browser groups include the new assertion that preview creates no requests and leaves the stored draft unchanged. Race and native HTTP gates remain required. Private raw logs are not published. A source digest is a same-run observation, not provenance.

Fresh extensions-layout journey0fd88d: exit0, 42 steps, UUID `f3230366-dbe0-4171-b595-243160cd5a08`, identical source digest. Independent final Integration/Runtime review9cb7d6 verified each layout's exact85 bounded regular single-link files with no observed reparse, empty native stderr, six race cases/45 parity cases, nine native groups/33 HTTP requests/24 text/6 legacy calls and six browser groups. All server/browser/connection closure observations passed. Independent source digest matched both receipts. Final root cleanupc50817 observed zero scoped browsers and ECONNREFUSED on ports4189/4191.

Root Integration/Runtime concurs with the independent scoped pass for tested review-branch publication only. Eight ledger tests and contamination checks passedcba959; existing template-term warnings remain. RC-2 ancestry and whitespace checks passed96158f. The ledger records fields/workflows as building with this evidence, without changing acceptance requirements or promoting any wave. No main modification, migration application, deployment or provider activation is authorized by these local results. Draft PR and exact-head CI/Release remain pending.

## Remaining work

Obtain collaborator-capable GitHub access for stacked draft PRs and exact-candidate required CI. Continue the remaining W3 contract-backed field/builder/publication work without exposing incomplete text fields in the public runtime. Hosted tenant authentication, staging synchronization and W4-W8 acceptance remain incomplete. The older Node24.15 native-worker crash remains documented and unresolved.
