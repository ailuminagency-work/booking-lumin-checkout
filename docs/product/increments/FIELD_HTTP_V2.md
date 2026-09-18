# V2 draft HTTP component

Base `f9d48e3b3545a37582c4c5901f4874fcec0c12c4`; isolated branch `codex/wave3-field-http-v2`.

This leaf adds an unregistered handler for V2 field draft reads/saves. A trusted local composition must explicitly enable the entire capability; caller data cannot enable it. Authentication resolves a fresh actor server side. Tenant/flow selectors never grant authority; the repository and SQL independently enforce membership and state.

The handler bounds raw request bytes before fatal UTF-8 decoding and strict V2 parsing. It rejects invalid framing, versions, revision overflow and forged authority fields, then validates returned receipts and binds save receipts to the submitted definition/revisions. No V1 fallback, conversion, publication, route registration or provider activation is introduced. Outer transport remains responsible for origin policy, TLS, rate limits, authentication deadlines and rejected-body connection closure.

Ownership: `/root/field_contract_builder` implementation/unit tests; `/root/text_draft_client` separate adversarial tests; `/root/evidence_recovery_review` independent architecture/domain/source/test review; `/root` docs/ledger and Integration/local Runtime Guardian coordination.

Current status: component implementation and local review gates passed for review-branch publication; native composition and hosted acceptance remain pending. Component tests use simulated requests and repository callbacks, not real hosted Auth or native HTTP/PostgreSQL composition. Main remains protected152bb909; PR74 remains draftc53deb. Predecessorf9d48e3 has zero CI runs and GitHub collaborator access still blocks draft PR creation. W3/W4 remain building; whole-wave and release gates are not waived.

Preliminary evidence: locked offline222 dependency installationea95df; eight ledger tests, RC-2 ancestry and unchanged SQL/lock/CI f494ed passed. Contamination tests and scan5ddfd5 passed with existing template warnings. PR74 CI34743351848 remains successful atc53deb; this does not certify the current candidate. Root initial typecheck21b3be passed; final builder/reviewer evidence is recorded below.

Independent review895071 returned two request-boundary issues before acceptance: URL normalization could admit noncanonical path aliases, and disconnect state needed checking immediately before RPC dispatch. No authorization bypass was established; SQL remains authoritative. Builder must reject raw path aliases and prevent dispatch after observed disconnect, with targeted regressions. Outer authentication deadlines and Node header-parser responsibilities must be explicit; the handler body timer alone is not an authentication deadline.

First repair passed14 builder tests379288/API typecheck4e453d and17 adversarial tests42c773/typecheckcc7de5. Independent reviewbfa34a then returned a native stream semantics issue: a normally consumed IncomingMessage can be destroyed while its completed request and socket remain valid. Blanket destroyed checks could reject valid requests. The builder must distinguish an incomplete/aborted request or destroyed socket from normal completion, with explicit regression tests. The earlier component passes are not final acceptance after this return.

Root full API regression02e8bb passed1016 tests across31 files under explicit Node24.19/two normal fork workers before the second disconnect-semantics repair. Independent31-test replayf9d9ea also passed that earlier fake-request version. Final affected replay and typecheck must cover the second repair; no earlier pass waives it.

The second issue was reproduced independently by adversarial teste0b67e:18/19 passed, with the completed/destroyed request on a live socket incorrectly returning400 instead of200. This failure remains part of the evidence. The repair preserves aborted/incomplete-destroyed/dead-socket rejection immediately before dispatch while permitting normal completed request auto-destruction. Final affected replay is required below.

Final repair builder/adversarial combined34 tests passed593995 (15 unit +19 adversarial). Independent adversarial replay793216 passed19/19 on the repaired predicate. Root07601d verified source SHA256 `6DDD0DC5FBB2B6CC610C571E120EA69B1E0AEADB9C7C77011898720C3A723A7C`, unit `DFF45A2EDED1B1087A9726ADADB1A6ECBB89749B99C20B2521A1FF5432493F72`, adversarial `476A5C0B26EBD01C288A606731C0E35DE330B84D2FE7317D0EAC20BED45EF177`. Final independent review and typecheck passed as recorded below.

Final independent review649143 passed34/34 tests under explicit Node24.19/two workers; hash verification4e8fe9 confirmed the frozen repaired sources and clean whitespace. Final API typecheck7e3e65 passed. Both review returns are closed for the simulated-request component scope. `/root` concurs with Integration and local Runtime Guardian acceptance for tested review-branch publication only. V1 HTTP, the repository, SQL migrations, lockfile and CI remain unchanged725866.

Next qualify the handler through bounded real HTTP and the V2 PostgreSQL repository in disposable databases before enabling any route. Native authentication/request framing, hosted Auth, exact-candidate CI and Release remain unaccepted. No deployment or live migration occurred; W3 is not complete.
