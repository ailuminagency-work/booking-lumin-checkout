# W3 isolated local text editor host — in progress

Base3c70c353aef3449cbf6910834d1eda5945f104ad; successor codex/wave3-text-host in work/text-host. Parent navigation/editor branches remain preserved. Main protected152bb909 and draftPR74c53deb/CI34743351848 success unchanged. Parent3c70 has no exact CI; collaborator access still blocks draftPR creation. W3.fields_and_workflows dependency-ready; W3/W4 active. Execution workflow read; no whole-wave promotion.

## Ownership and design

- `/root/field_contract_builder`: new TextGuardStore.ts/test only.
- `/root/text_draft_client`: new TextStoreNavigationGuard.tsx/test and LocalTextEditorHost.tsx/test only.
- `/root/evidence_recovery_review`: independent architecture/source/adversarial review.
- `/root`: dependency installation, integration, runtime evidence and release coordination.

Architecture review requires synchronous external authority rather than flushSync during child lifecycle. A stable store replaces its immutable snapshot before notifying subscribers; navigation reads getSnapshot directly. React subscription drives display only. Context reports are generation-bound; old operations cannot clear a new context's busy state. Disposal fails closed. Store reports originate only from committed lifecycle/events/settlements, never render.

The host is a persistent data-router root above its outlet. LocalTextEditorRoute renders actual TextFieldEditor with explicit injected client/context; parentRevision changes preserve text state. This protects text drafts only and does not claim parent questionnaire edits are guarded. Force-changed authentication/context immediately gates old display and invalidates old clients; no old tenant content is reused.

No App, FlowPortal, ModeOwnerPortal, server launcher, provider, DB or deployment activation. All defaults remain unchanged. Real browser history/unload plus joined client/HTTP/SQL acceptance are later gates; memory-router tests do not replace them.

## Required acceptance

Same-stack report busy then router.navigate/internalaction must deny even before React rerender. Store must preserve independent dirty/busy fields as reported, ignore stale context reports, maintain snapshot identity when unchanged, and notify safely. Beforeunload reads current store synchronously. Dirty cancelled PUSH/REPLACE/POP preserves URL and inputs; accepted transition must not replay. Context replacement and late request settlement cannot revive removed editor state. Exactly one persistent guard is supported; requestChange is for non-router actions only.

Own cached dependency install completed70701e with222lockedpackages. Architecture added committed-location epoch rotation: a cancelled transition keeps edits; only committed departure retires old context and clears guard; returning reloads persisted data. Accepted search/hash transition also discards the old epoch explicitly. A persistent store is not proof against pending loader navigation; this first host is restricted to synchronous static local routes without loaders/actions/lazy transitions until operation-admission during pending navigation is separately solved.

Root requested StrictMode effect-replay coverage because disposing a render-created store in replay cleanup can poison its next setup. Preserve permanent fail-closed disposal semantics rather than reopening a disposed store.

Store builder frozen8F067ACACDDF21F71AB640D4236C763AFBE61A1C7CC14FB49258CBF2497C737B/testA960A9EF85E24EA1A96509D59D37A9D44EC29D6E8553F5E7F95CA39DBD6DBECE; five tests passed3a4308. Independent source review in progress. Host/guard remain in construction; no gate advancement or activation.

Independent store-only review b09e0a passed five tests and exact hashes. Scope reports replace full state; host must preserve the other flag in separate dirty/busy callbacks. Store disposal remains terminal; no route approval inferred.

Host source pre-review finds no hostname enforcement; the exported components remain an injected static local-test harness, not a production security boundary. Root requested strengthening the forced-account test by starting a new-context deferred read before settling the old save, proving the old generation cannot clear current busy authority. Final host tests/source review remain pending.

Final builder host/guard7tests91f2f3 and portaltypecheck4e189b passed; initial ambiguous status-selector testfailureeb525a corrected without changing protection rules. Independent combined12tests21c31d passed with all six hashes verifiedd4a969. Actual TextFieldEditor reports busy before injected client navigation; new-context busy survives old-save settlement; StrictMode, committed departure/search/hash resets, back re-entry and revision-preserved edits pass.

Root fullportal140tests/24files and build19694e passed. Contaminationef427e clean with existing template warnings. No backend/DB files changed. Root Integration coordinates this bounded candidate; independent component/runtime-harness review remains scoped to memory router. Exact-candidate CI/Release, native browser verification and joinedHTTP/SQL acceptance remain required. No default activation or hostname enforcement is implied; no service/deployment/provider changes.

Next leaf: isolated browser fixture using this persistent host with synchronous static routes, exercise actual browser PUSH/REPLACE/POP/unload and preserved context under deferred fake requests. Only after native browser gates pass should the local browser be joined to the existing disposable SQL/API harness. Keep no-loader restriction until pending-navigation operation admission has an explicit design and test.
