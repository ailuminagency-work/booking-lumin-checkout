# W3 text editor navigation guard — in progress

Base: ac6c44ffb23f8227e7b4a01d1d72126111cb35ee on preserved pushed codex/wave3-text-editor. Isolated successor: codex/wave3-text-navigation in work/text-navigation.

## Resume evidence

Execution workflow and dependency ledger read. W3.fields_and_workflows remains dependency-ready; W3/W4 active. Remote main remains protected152bb909c06fa8602d99f8b37d2cfe9f90aa5ead. PR74 remains draftc53deb with successful exactCI34743351848. Parentac6 has no CI runs and draftPR creation remains blocked by collaborator access. RC-2 ancestry check passed before the subsequent missing optional config-file read; no branch protection changes.

Own dependencies installed offline from lockfile with lifecycle scripts disabled:222packages,cfd5aa. No dependency versions changed.

## Scope and ownership

- `/root/text_draft_client`: new TextNavigationGuard.tsx and its tests only; builder/domain implementation.
- `/root/evidence_recovery_review`: read-only architecture, independent/adversarial review.
- `/root`: branch isolation, integration, evidence and gate coordination.

Provide a data-router hook with current dirty/busy state and an explicit discard confirmation callback. Router PUSH/REPLACE/POP must consult the guard. Busy rejects navigation without confirmation; dirty requires confirmation; cancelled changes preserve route and editor context. Internal non-router destructive actions use the same decision through requestChange. Do not combine requestChange with navigate in this contract, which would otherwise cause duplicate confirmation. Document unload protection is best effort and does not cancel database transactions.

No App, BrowserRouter, FlowPortal, ModeOwnerPortal, provider, API or database activation belongs to this leaf. Existing defaults remain unchanged. The new guard must be hosted above routed editor content before it can protect a complete local journey.

## Following host integration

A separate explicitly local host will use a data router with persistent guard ownership above the editor route. It must keep authoritative dirty/busy state outside routed content; wire non-route version/logout/business switches through the same guard; preserve inputs and URL on cancelled POP/PUSH/REPLACE; invalidate old account display on forced auth changes; and test late requests against changed context. Real browser tests remain necessary for history/back/forward/unload behavior. Memory-router tests alone are not browser acceptance.

Capability activation remains coordinated disposable-local only. No old/new-client compatibility or prompted publication is implied. Exact-candidate CI and Release review remain required before acceptance; no wave promotion.

Local installed router inspection (32e739) confirms it supports one blocker at a time and registers useBlocker through effects. The next host must use one persistent instance and not advertise navigation protection before registration. Guard implementation should decide in the predicate, never save denied destinations for later proceeding. Root requested immutable-state and actual callback-identity replacement tests because mutable test fixtures can conceal stale ref bugs. Browser POP timing remains outside memory-router certification.

Initial guard sourceACC2EFD9/test926DC9E2 passed9builder testscc9832/typecheck085d4a and independent synchronous memory-router tests e3fc3a. Root fullportal126tests/21files plus build passedcf5ccc.

Root/independent review then RETURNED a concurrent-render defect: assigning the authority ref during render can expose an uncommitted clean state from a suspended/aborted render while the committed editor is still dirty/busy. Prior green synchronous tests do not close this case. Builder must add an actual Suspense/transition regression and use a committed snapshot. Future host must explicitly coordinate synchronous busy admission; calling setState then navigate in one stack is not a proven guard contract. No readiness/push/activation claimed pending repair and review.

Concurrent-render failure reproduced5291e3: both committed dirty and busy allowed an internal action during a suspended clean proposal. Builder repaired with a layout-committed copied snapshot (source6FBEC303CD31D726776D45728CB56623C2EB96BD15EF5C93DB746BEBB7BCD950; testFF792D9DD3EDE07206856BF206ABB88E79C5C04FE542C9F64C8492CFB9A5F406). Eleven tests passedb6ae67; portal typecheck344e68 passed. Regression verifies committed editor remains displayed and both internal/router changes remain denied while the clean render suspends. Independent replay and final fullportal checks pending at this entry.

Final independent source/adversarial replay8634a5 passed11tests and closed the concurrent-render RETURN against exact hashes. Root final fullportal128tests/21files passeddb17cb and buildfa3bfe. Contamination scan/diffcheck0d9251 passed; only existing template-term warnings. No backend/SQL files changed and no database run was necessary for this leaf.

Root acts as Integration coordinator, with `/root/evidence_recovery_review` supplying independent component/runtime-harness review. This proves the isolated hook under memory-router/React tests only; native browser Runtime, real host integration, exact candidate CI and Release remain pending. Ready for a tested review branch, not activation. Next: persistent dedicated local data-router host, synchronous operation-admission authority, browser PUSH/REPLACE/POP and document-exit tests, then component/client/HTTP/SQL joined acceptance. Preserve parentac6 and all default routes.
