# Public policy API — candidate evidence

Status: local verification in progress. No exact-candidate CI or Release approval yet.

## Identities and ownership

Curie (`/root/allocator_harness_builder`) authored only the new API/local-composition source and tests plus the explicitly authorized portable deadline repair. Author commit `01e3977bf9344e334f2e8bdb9eeadffae2e611dc` was integrated by root as `8a7e530` on `codex/product-mode-policy-api`, based on PR60 `88f7d6f82f79492f24261057f4a8957d8f71fc9b`.

Maxwell (`/root/allocator_harness_review`) independently owns the six SQL/HTTPS/browser verifier files. Chandrasekhar (`/root/allocator_source_review`) independently reviews source, adversarial controls, integration and Runtime evidence. Root owns tooling, package scripts, CI, documentation, ledger and final integration. These four actual identities cover the governor roles; authors do not approve their own changes.

## Returns and corrections

- Native API and accepted portable document handlers sampled the response deadline before timer cleanup. Independent probe reproduced a success at 2,000 ms. The new branch samples after cleanup: 1,999 ms remains successful; 2,000 ms returns unavailable without bootstrap. Portable 59 tests and the original boundary probe independently passed (105f42,513de5).
- Two full API test attempts ended with a worker exit during the 10,000-entry map stress. The test transport was bounded to one owned keepalive socket; the same admission/map/no-eviction assertions remain. The unexplained worker exits are retained in builder evidence. All 55 tests then passed and were independently repeated (7fbaf2,700f96).
- Verifier review returned a browser-cache mismatch, ambiguous TLS rejection checks, insufficient observed PostgreSQL cleanup proof and unguarded partial-startup constructors. Corrections passed independent static review (62a3e1) before actual execution.

## Actual local evidence

Both fresh PostgreSQL layouts applied all 30 accepted migrations without modifying them. Native SQL/HTTPS verification passed all 19 scenario groups in each layout (public466225,extensionsa6f16a). Receipts include exit0, no timeout/output overflow, exact terminal count and observed one/two blocked-backend markers. This uses disposable local PostgreSQL, not Supabase production.

Four forced browser failures exercised assertion/fill, fixture setup, timeout and teardown. Each failed as intended; all eight generated files, including four private framework error-context files, were scanned with no secret sentinel present (4f82cd). The corrected public-layout browser run passed all eight cases and six screenshots (03f870, run5230b112-43a5-41f2-a5d4-3b9f88c8f11c), independently validated (8abbce). Its dirty worktree contains the exact reviewed copied source; this is diagnostic source evidence, not clean predecessor certification. The extensions run also passed eight cases and six screenshots (81a882, runc278b725-90b8-437c-b430-7f5c16f86d53) on a separate fresh database. Both used Node24.15, Playwright1.63 and asserted Chromium153.0.8010.12. Root visually inspected all six public screenshots: they correctly show the inert unavailable document, approved single/nested parent fixtures and no viewport overflow; this is not a functional checkout UX claim. The first browser attempt failed because a fixture text locator omitted the accepted final period and context/browser cleanup raced; corrected fixtures passed independent delta review, and the failed run is retained.

Root workspace tests passed 1,551 tests in 19 summaries with exit0 and no failure markers (87a6c8,451fc1). Workspace typechecks passed (6fae7c), builds passed (7635a2), all 43 new tooling checks passed (72339e), and eight ledger checks passed (c64b18). These checks do not replace real browser evidence or final clean-candidate CI.

## Required remaining gates

Integrate only the independently reviewed verifier files after real browser acceptance. Inspect minimized artifacts, clean preview and contamination controls; repeat affected checks after any repair. Record final source/tree hashes and Runtime review. Push the isolated review branch and open a draft PR based on PR60. Exact-candidate CI must show verify, database and the new document job all passing; prove checked-out candidate content and base. Only then may Release record bounded draft review approval.

Main remains protected at `152bb909c06fa8602d99f8b37d2cfe9f90aa5ead`; fresh remote check684e05 confirmed PR60 still open/draft/exact88f7 with successful CI34564995159. No merge, deployment, live migration or provider activation occurred. Hosted acceptance and W3-W8 completion remain outstanding.
