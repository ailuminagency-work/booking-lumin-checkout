# W3 text-question editor — in progress

Base: `412510d474639287c39c901a693f7181a6603840`, preserved on the pushed `codex/wave3-text-draft` branch. This successor is isolated on `codex/wave3-text-editor`. Parent draft-PR creation and exact-candidate CI remain blocked; local work does not promote either candidate or the whole wave.

The next coherent increment gives business owners human-readable text-question labels and a bounded editor for persisted text definitions. Stable answer keys remain internal. Existing fields without labels require explicit owner input; the editor must not invent or persist labels from keys.

## Contract and compatibility

`prompt` is optional for legacy definitions, preserves exact text, and is limited to 200 Unicode code points. Validation rejects blank values, NUL, lone surrogates and line separators. SQL and TypeScript must use the same whitespace semantics. Existing limits, revision checks, tenant isolation and nonpublishable status remain intact; migration 0032 is immutable.

This is a coordinated disposable-local capability. New clients can read old definitions, but old strict clients cannot read prompted definitions. Hosted or mixed-version activation requires explicit version/capability handling. The HTTP server defaults prompt writes off; request data cannot enable them. Default launchers remain unchanged.

## Ownership and gates

- `/root/field_contract_builder`: text contract, independent prompt tests, new 0033 validator migration and SQL tests. No database execution.
- `/root/text_draft_client`: isolated `TextFieldEditor` component and component tests. No shared route or style edits.
- `/root`: server capability gate, shared integration, evidence and later supervised execution.
- `/root/evidence_recovery_review`: independent architecture, source and adversarial review. Architecture approval is conditional on the local server gate and compatibility restrictions above.

Cached installation completed with 222 locked packages (`94c70d`), offline with lifecycle scripts disabled. The initial sandbox attempt failed cache access; no dependency version change occurred.

Implementation and verification are in progress. The new prompt-write gate has four native test cases written but not yet executed against the pending contract. Required next gates include contract/SQL parity, editor isolation and stale-revision controls, independent review, fresh disposable database proof, integration, exact-candidate CI and Release review. Nothing is merged, deployed or activated with real credentials.

## Workspace confirmation and scoped validation — 2026-09-17

User confirmed Render My Workspace (`tea-d9pp87ad0e5s73enrog0`). Fresh read-only inventory includes only `leadgate-api` and `leadgate-backup`, both connected to the Leadgate repository. No Booking Lumin service is present in this inventory. No Render configuration changed.

Remote main remains `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead`, protected; branch response lists application and database required checks. Full administrative protection configuration remains separately unverified.

Independent reviewer `/root/evidence_recovery_review` accepted the bounded prompt contract and editor source: 11 contract tests (`e7c360`) and eight candidate-local editor tests (`2151fc`) passed. A sibling-toolchain replay failed matcher registration; unchanged candidate-local replay passed. SQL source review does not constitute SQL runtime acceptance.

Root API typecheck and four native prompt-capability tests passed (`7fcc9f` / `e6ecad`, exit 0). Default-off writes and inability to enable the capability through request data were exercised. Independent review of this root gate remains pending.

Next: update and independently review the disposable runner for migration 0033 and its SQL suite; run fresh parity/roundtrip proof; safely integrate parent editor dirty-state handling; complete integration and exact-candidate CI/Release. Parent draft PR access remains blocked as previously recorded. W3/W4 remain active; no wave, release or hosted acceptance promoted.

## Disposable runtime cycle — 2026-09-17 18:22 Pacific

Remote checks: main unchanged/protected at152bb909; PR74 remains open draft c53debbaa9e6fa2acc7bfe2aca96026e4450a194 over79bead0c, exact CI34743351848 success. Parent412510d still has no Actions runs. Existing PR access blocker remains; no stack changes.

Root updated the portable runner to require33 contiguous migrations, pin and execute the prompt SQL suite. SQL steps now end39, race40, native HTTP41; budgets unchanged. CI includes the prompt SQL suite after draft SQL. Independent reviewer `/root/evidence_recovery_review` passed nine inert runner tests e64607, and the server capability review with13 tests c333a2. Root replay15 contract/API tests and diff check passed a8e679.

Fresh disposable PostgreSQL runs passed all41 steps in both layouts:
- public d4279c77-fc08-4c07-a985-fb83ec9fa46b, cc76ef exit0.
- extensions401a6695-dea1-4c55-beb0-23b1b278c0be,2c38f5 exit0.
- Same sourceDigest500bded33dfaee935eb06b699a4d45f8c59e1cfb2848db090650e1c6cfa295dc. Fixed receipts retained under OS temporary lumin-text-draft-tests directories. Independent artifact review requested; no raw SQL output exposed.

This proves prompted SQL validation/roundtrip and legacy native HTTP regression, not prompted editor-to-database integration. The prompt-write gate is not mixed-version protection: stored prompts remain readable and a full unprompted replacement can remove them. Isolated coordinated local scope remains mandatory.

`/root/text_draft_client` reviewed parent integration without edits. Identified a prerequisite: add an onBusyChange callback to TextFieldEditor because an unchanged save can be in flight while dirty=false. Parent selection/tab/navigation guards must cover busy as well as dirty. Keep parent-only dirty separate from child dirty, preserve child across parent revisions, and leave ModeOwnerPortal capability absent by default. Next builder cycle must repair/test this callback, then independently review before parent wiring. Prompted native HTTP/database journey and full candidate gates remain incomplete. No release/whole-wave promotion, push, merge, live migration or deployment this cycle.

Independent artifact review completed: `/root/evidence_recovery_review` scoped Runtime PASS public5da8f5 and extensions7a07bd. Each directory has exactly83 regular single-link files with no observed ancestor/file reparse; native stderr empty, six race cases/45 parity cases and eight HTTP groups with closure observed. Recomputed source digest matches both receipts. Public receiptSHA2565a13ca681d00e360ae61c8398b35a865afb5c03d6eca83b0cd481fc26ae17822; extensions7786ec0d1d90760701ee90b1759028009a9871d75ec9383532ec4614268f3b9e. CI two-line addition source review c0f6ea passed; actual candidate CI remains absent. Next work remains busy-state repair and parent/prompted native integration.

## Active follow-up cycle — 2026-09-17 19:17 Pacific

Read execution workflow and validated dependency ledger. Remote main remains protected152bb909; PR74 remains draftc53deb with exactCI34743351848 successful; parent412510d still has zero Actions runs. Existing access constraints unchanged.

Exclusive builder ownership this cycle:
- `/root/text_draft_client`: TextFieldEditor.tsx and its test only, repairing busy-state callback across deferred operations and context/unmount boundaries before parent integration.
- `/root/field_contract_builder`: action-api/server/text-field-drafts.integration.ts and its colocated integration.test.ts only, adding ninth native group on tenantB for exact prompted typed-client/HTTP/SQL roundtrip, default-off rejection and stale revision preservation. No direct database runs by builders.
- `/root/evidence_recovery_review`: read-only independent review of frozen outputs and supervisor compatibility.
- `/root`: runner expected native group count9 and explicit SQL ordering assertions. Nine inert tests passed507820; fresh native execution awaits builder and reviewer.

Historical accepted41-step receipts cover the previous eight-group source only. They are not receipts for this in-progress candidate. Default launcher capability remains off; parent editor wiring still pending. No hosted changes or wave promotion.

Busy-state repair completed by `/root/text_draft_client`: component7BBD64B67AA0DE82D7E562B8065613902793D1CBDC1BF9D202CF6B520353140C/test1F3976847CE217727C1EE78C9149F026518CDDF7F60F7CB4E15C2E2AEF936DA0. Portal typecheck791e8b and12Reacttests a66a06 pass; independent replay98c7b2 passes. Busy notifications cover unchanged saves, context changes, unmount and generation fencing. Parent integration remains a separate gate.

Native builder froze3E2FC7F25921307EEFDBD0A75E2E53A9583DD3694FF20DEF6EF142CD11ED8630/testD167120F6882BC640BF96DE24308A2BC2A11D8D61796BFF4F256B6F938E71BB0. Independent pre-execution review844f9b passed6inert+9runner tests. Root API typecheck and10tests passedca3a6f. New ninth group uses synthetic B tenant, actual typed client and explicit local enabled HTTP server, exact Unicode/whitespace/markup text, stale CAS preservation, and default-off rejection before repository calls. Existing A-tenant revocation and legacy groups remain intact.

Fresh public runb8c835c3-aa21-491d-948a-315ff48e5481 completed41steps7fde5e exit0, digeste875730c3f5499b435288dc2ae51b759b05994a7af66d25a63b6b71e7f5c8eda. Extensions and independent artifact review in progress. No React/browser integrated journey claim.

Extensions run25cda07d-3413-4f62-a182-4fec46a7e63a passed41steps1ad155 exit0 with the samee875730c digest. Independent public RuntimePASS1b65e4 verified83regularsinglelinkfiles, no observed reparse, native stderr0, six races/45parity and nine native groups/33HTTP/24text/6legacy with server/connections closed. Public fixedreceiptSHA6ec8f36fe7500b16b39db38b94c183e7726b64e4a9dc32463f78f569c870b71e. Extensions artifact review pending at this entry.

Branch remains codex/wave3-text-editor at base412510d with isolated uncommitted candidate; diffcheck20d9e0 clean. Next dependency-ready builder work: integrate optional text client into ConfigurableEditor/VersionedEditor with separate parent dirty and child dirty/busy guards; preserve text across parent revisions and prevent unsafe navigation/tab/logout while busy. Keep ModeOwnerPortal/default capability absent until separately reviewed. Then full affected regression, independent integration/runtime, review-branch push and exact CI/Release remain required. No full-wave promotion.

Final independent extensions Runtime review6c9ff5 PASS: receiptSHA5cab4bcfc4551f12cd0e97a0d1e6413f80b3ffe42ce9e700cb86f0548c3782eb;83regularsinglelinkfiles/no observed reparse/native stderr0. NineHTTPgroups33requests24text6legacy and sixrace/45parity with observed closure. Independently recomputed currente875730c digest matches both layouts. Scoped prompted typedHTTP-to-SQL Runtime gate green; browser/parent integration and final candidateCI/Release still outstanding.

## Parent integration cycle — 2026-09-17 20:17 Pacific

Workflow reread and dependency ledger validated: W3.fields_and_workflows remains dependency-ready; W3/W4 active. Main protected152bb909 and PR74draftc53deb/CI34743351848 successful unchanged; parent412510d exactCI absent. Current isolated branch retains412510d base.

Exclusive work allocation:
- `/root/text_draft_client`: ConfigurableEditor.tsx and new ConfigurableTextEditor.test.tsx only. Optional disabled-by-default text editor composition, parent-versus-child dirty separation, synchronous busy/dirty guards, persisted V2 selection/context protection, parent-save preservation.
- `/root/field_contract_builder`: FlowPortal.tsx VersionedEditor export only and new VersionedTextEditor.test.tsx. Optional props forwarding and guarded V1/V2 switching; no FlowPortal or legacy Editor behavior changes/default activation.
- `/root/evidence_recovery_review`: read-only architecture and subsequent independent review of both leaves.
- `/root`: integration/evidence and outer navigation boundary assessment.

The application currently uses BrowserRouter. Component guards alone do not certify browser back or programmatic route navigation. No outer FlowPortal/ModeOwnerPortal activation is authorized by these leaves; route/navigation protection must be separately solved and tested before enabling the feature there. Existing prompted HTTP/SQL receipts remain scoped to their unchanged backend source; new React composition needs its own checks.

Architecture review `/root/evidence_recovery_review`: keep optional composition inactive in outer portals. Existing BrowserRouter cannot guarantee dirty/busy protection for POP/back/forward or programmatic redirects using click interception. Next activation leaf should use a dedicated local data-router host with a centralized blocker for PUSH/REPLACE/POP, dirty confirmation, busy hardblock, version/logout/business-switch guards and beforeunload. Do not monkeypatch history or attempt to undo navigation after editor unmount. Forced authentication changes must invalidate old display immediately; browser unload cannot guarantee database cancellation.

Independent root regression while UI builders run: full action-api918tests/24files passed3a358c; workflow typecheck+106tests/10files passedefb35a; flow-ui367tests/11files passed1f6e1d. These cover current backend/shared contracts, not unfinished UI integration. Historical unexplained browser CI failures remain outside this bounded acceptance.

Independent review RETURN on initial VersionedEditor36F306F7: replacing onTextStateChange did not immediately deliver existing dirty/busy state to the new observer; an outer guard could remain false until another child event. `/root/field_contract_builder` assigned regression and repair within original ownership. Initial boundary8tests/typecheck did not cover this case; no approval claimed. ConfigurableEditor builder still validating; no release/push decision yet.

Outer VersionedEditor observer defect repaired: E39B48979DC81C3525B0660D5606D26E29642B60069512BA43EE22F5BDCA1CDA/testCF694219AD7B544CED2C7632533B050D942A879D6F37FB56379D493E1FB314E5. Builder9UItests e2a4a3/typecheckdebbc3 and independent9test replay748f8c passed. Replacement observers now receive retained state at layout commit. No FlowPortal call-site activation.

Root found the same missing replacement notification in ConfigurableEditor's initial DAAB8EEB candidate; returned to `/root/text_draft_client` for equivalent regression/repair before combined review. Earlier12tests975f24 do not close that gap. Default capability still off.

Pre-repair full portal regression116tests/20files and production build passed141dc6. Independent reviewer subsequently found a missing capability-disable lifecycle case, so this success does not approve the pending repair. ConfigurableEditor RETURN: true-to-false removes child but retained parent textDirty can remain true; builder must clear text state on disable and prove late prior operations cannot restore it while keeping parent selection intact.

Contamination failure-mode tests and scan passed6902d1 (existing template-term warnings only); all8ledger validator tests passed. These do not replace UI review or exact candidate CI.

Final component repair B0BE08AEEEBB3F6916AEB0E6F632CDDECC53086A16D5A0AC504E6D0B65879847/test4338A9D286ACFA9F974A08F2A05B1B517C1DBCF3610E6F31B630E0BED956D113 passed14builder tests795dbe/typecheckeae673 and independent combined31tests26c005. Reviewer closed capability-disable RETURN; parent selection preserved and late save cannot revive text state. Root final fullportal117tests/20files plus build passed83d037/591624. Prior backend918/workflow106/flowui367 regression and dual-layout promptednative proof remain applicable to unchanged backend code. Contamination/ledger anddiffcheck passed.

Root performs Domain/Integration coordination; independent `/root/evidence_recovery_review` performs source/adversarial and bounded Runtime review. Optional component candidate is ready for tested review-branch publication only. Exact-candidate CI and Release Governor remain pending, and parent branch PR access blocker persists. No full W3 completion, route activation, browser-to-SQL journey, hosted proof, merge or deployment is claimed. Next separate leaf: local navigation-guard host before outer activation; preserve default portals unchanged.
