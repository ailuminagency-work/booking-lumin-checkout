# Local owner publication and installation — verification receipt

This increment composes the accepted draft, installation and session repositories into an explicitly local business-owner Portal. It supports saved standard/configurable questionnaires, publication, separate hosted/iframe installation configuration, policy/version changes, historical receipt recovery and minimized request history. Customer delivery is disabled; synthetic credentials are accepted only by the guarded local harness.

## Independent ownership

| Identity | Exclusive work and review |
|---|---|
| Curie, `/root/allocator_harness_builder` | API/composition and HTTP harness builder; independent Portal review |
| Chandrasekhar, `/root/allocator_source_review` | Portal/client builder; independent API, root tooling and browser-harness review |
| Maxwell, `/root/allocator_harness_review` | Browser harness and actual browser tester; independent product Runtime review |
| Root, `/root` | Shared entry, packages, CI, preview protection and evidence; independent harness checks; Integration and Release coordination |

These are four actual identities with combined roles, not nine separate reviewers. No builder's self-review substitutes for independent acceptance.

## Local evidence

- Corrected application source passed **1,365 tests in 19 workspace summaries**, including 91 Portal tests. All workspace typechecks, application builds and preview build passed. Preview packaging retained 17 support checks.
- Workflow/tooling controls: 27 passing checks plus contamination failure-mode tests and a clean client-identifier scan. Generic vertical-template warnings were reviewed as existing generic fixtures/templates.
- All 30 active migrations applied to fresh local disposable databases. Eighteen existing SQL regression suites passed, covering RLS, resources, workers, planning, finance boundaries, outbox and flow storage. Accepted migration/repository source was unchanged.
- Eighteen new real HTTP/PostgreSQL scenario groups passed separately in both `public` and `extensions` crypto layouts. Three observed lock waits are evidence inside those groups, not extra scenarios. Writer-order tests combine a trusted SQL holder with an actual HTTP writer; deadline simulation uses a controlled monotonic clock after a genuine commit.
- Seven actual Chromium journeys passed in each fresh database layout: standard and configurable cycles; committed-response loss and historical recovery after later policy advancement; delayed-response tenant switch; archived completed/cancelled summaries and privacy; native unsaved-edit confirmation; and stale policy CAS rejection without replay.
- Browser runs: `e9244d85-80fd-4aa0-a4e1-8b3c0edbaa3d` (public) and `f40d1016-ba4c-445e-bb50-38473a2a48b5` (extensions). Each has seven passing events and six bounded screenshots. Root independently validated both manifests and visually reviewed all six public captures at 320/768/1440 widths. This is scoped usability evidence, not a general accessibility certification.
- Four deliberately failing browser privacy controls passed their artifact inspection: eight generated files, including four framework error contexts, contained no synthetic sentinel. Reviewed output includes only explicit bounded screenshots and fixed summaries; arbitrary framework diagnostics are not uploaded.
- Playwright packages are pinned to 1.63.0; tested Chromium is 153.0.8010.12. Local PostgreSQL is 18.6; required CI uses PostgreSQL 16, so remote CI remains separate evidence.

## Returns and corrections

Actual tests and independent review returned two Portal defects: selecting a form could start duplicate installation reads before Publish, and draft-only saves could clear a failed authoritative-refresh lock. Commit `75d0844e33740f4102e8590e96683e608521c594` fixes both by restricting panel refresh/lock clearing to a successful selected-flow authoritative refresh. Independent review ran all 19 focused controller tests; the actual browser subsequently confirmed successful publication with one read in flight. Server limits and mutation retries were not weakened.

Earlier harness failures are retained in continuation evidence. Corrections included exact accessible select locators, awaiting panel refresh before selecting a row, and waiting for the actual intercepted committed response rather than treating a pending UI as commit proof. No failed run was relabeled green or reused as a fresh database.

Reviewed browser author commit: `8fefb4de7e1313715e4712f0844a41e62c79a561`. Reviewed HTTP harness author commit: `599caf094e33bac9b601c8e1dbb7d7bcf1bf6a28`. The final integrated candidate and exact CI receipt are recorded through the stacked draft PR and continuation report; these author commits alone do not identify the complete candidate.

## Release boundary

This receipt records local verification. Exact-candidate CI and Release approval remain required after the review branch is pushed. No merge or deployment is authorized by a green local test. Runtime review must preserve the accepted RC2/main foundation, tenant isolation, server authority and demo/live separation.

W3/W4 remain active and W5–W8 incomplete. Document/loader/session-bridge work, hosted authentication, genuine multi-origin HTTPS acceptance and Netlify/Render/Supabase reconciliation remain incomplete. This local journey does not finish the full publication capability or any whole wave. No live migration or real provider activation occurred.
