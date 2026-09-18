# Versioned V2 draft client

Base `1d2845ee67c8c18858f79ee5f18be49c2f36ae2f`; isolated branch `codex/wave3-field-client-v2`.

This leaf adds an unwired V2 client for the reviewed draft HTTP contract. A trusted constructor flag defaults off; it is an explicit local opt-in, not server capability negotiation or authorization. The server still resolves identity and enforces tenant/flow membership. No V1 fallback, conversion, route activation, editor installation or public publication is added.

The client must preserve bounded UTF-8 request/response handling, fixed V2 paths, omitted cookies, redirect denial, no credential persistence/logging, generation invalidation, finite errors, a single request deadline and cancellation of late response bodies. Save responses must bind to an immutable pre-await copy of the submitted V2 definition and revision predicates. Browser/native transport integration remains a later gate.

Ownership: `/root/field_contract_builder` client/unit tests; `/root/text_draft_client` independent adversarial tests; `/root/evidence_recovery_review` architecture/domain/source/test review; `/root` docs/ledger and Integration/local Runtime Guardian coordination. No shared exports or production consumers are changed.

Status: scoped fake-fetch client gates passed for review-branch publication; native integration remains pending. Main152bb909 remains protected, PR74c53deb remains draft, predecessor1d2845e has no CI runs. GitHub collaborator access still blocks draft PR creation. W3/W4 remain building; exact-candidate CI, Release and hosted acceptance remain open.

Preliminary evidence: offline locked222 dependency install83e99d; eight ledger tests/RC-2 ancestry/unchanged SQL/lock/CI49dace and contamination tests/scanbdd3d1 passed. Existing template warnings remain unchanged. Independent source review9a79ac confirmed canonical definition binding uses the same reconstructing V2 parser on both sides and an immutable pre-await copy; final source/test acceptance is recorded below. The injected fetch adapter is a trusted seam, not a sandbox for arbitrary JavaScript objects.

Root flow-ui typecheck6d39e1 failed on possibly-undefined values in the in-progress adversarial tests. Returned to that cell to repair test typing without weakening assertions; final typecheck must pass before acceptance.

The test typing return was repaired without widening the production API; final flow-ui typecheckc3726d/28f04f passed. Builder nine fake-fetch tests074a3c and13 independent adversarial tests760600 passed. Root full flow-ui regression47fac1 passed404 tests across15 files under explicit Node24.19/two workers. Frozen source SHA256 `B8EFB64FF52E16FA2A06247459A234B69834FADCBEBC56C377745B3D0C7BECFE`, unit `2C0ABE9F1A4388CB8BDA933117598615FF552D658DCCA93F328C4BC6CD78DDB7`, adversarial `D9686120ABB3A9084A4B5C56DFFA590F653B1E154330C6286DC3BB0D9D048A2A` were verified by root7e38bb. Final independent source/replay verdict passed as recorded below.

Final independent replay7489bd passed22/22 targeted tests under explicit Node24.19/two workers. Source review364aa1/b2ac6f verified detached immutable requests, canonical definition binding, exact revision/status checks and lifecycle bounds; all three frozen hashes match. Scope reviewa01f3d and ledger/document review5a88d7 confirm exactly five intended paths and an evidence-link-only ledger update with building status unchanged. `/root` concurs with Integration and local Runtime Guardian acceptance for tested review-branch publication only.

No production consumer, native fetch/browser transport or hosted authentication is qualified by fake-fetch tests. Next qualify the client against the disposable native V2 HTTP/PostgreSQL harness before editor composition. Exact-candidate CI and Release remain pending; no deployment, live migration or provider connection occurred.
