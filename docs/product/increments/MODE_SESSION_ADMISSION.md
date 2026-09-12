# Local session admission safeguard

Status: BUILDING. This supporting W3 increment adds an internal, opt-in pool facade for trusted local composition. It is not wired into the accepted repository factory, customer HTTP flow or a deployed service. Full W3 and hosted acceptance remain incomplete.

## Scope and ownership

Base is PR71 candidate eb34e00d609f18923ca809c66c8edae53526ec43. Curie (/root/allocator_harness_builder) authored the facade and controlled tests in isolated work/mode-session-admission, commit 9620366a3cbc5a0b7b9c43bdb502a9c694c693ad. Chandrasekhar (/root/allocator_source_review) owns the independent native harness and fixtures. Maxwell (/root/allocator_harness_review) independently reviews both and runs external adversarial controls. Root performs Program, Architecture, Integration and final Release coordination; it owns CI, package registration and this ledger. No reviewer approves their own implementation.

The amended contract is 477913C05277ED05B84F9252EC50769CD4E0C844167E0FA86BD8CD422DD5A317. One trusted pool identity receives eight admission slots, reserved before connect. Uncertain histories remain quarantined for the facade lifetime. A clean, fully completed approved consumer operation can recycle its slot; ordinary driver release never proves physical closure or transaction certainty. Captured per-checkout release and generation ownership prevent an old wrapper from changing a successor. Bounded event views expose no raw driver objects or error payloads. Recognized SQL error classes are reconstructed from a static allowlist so existing repository classification is preserved.

Close stops admission and provides a bounded observation of the single underlying end operation. Its result is not a drain certificate. Broken-emitter cleanup stops admission and attempts bounded repair; it does not promise restoration against arbitrary faulty emitters. No reset, replacement pool, SQL parser, new migration, provider connection, browser export or production registration is introduced.

## Review and current evidence

Builder tests: 55 controlled cases passed (824c4a); typecheck passed (b8d699). Root affected API regression: 659 tests in 15 files passed with one worker (6942f1), without timeout changes. Maxwell independently closed four source returns and passed 17 external controlled groups (ae6730), with source and author-test hashes unchanged. Source SHA256 is 767F58F00A8564F61A6982A23470F7B0395605D8F3D59B17B9222E4495320B95; author tests are 5EF94F1AA1C3D1252C473DE3CAF7C63C5BABC1903E899313A8297E61C87D3616.

The returned defects were reentrant duplicate release, uncaptured native timer cleanup, partial listener-detach handling and lost SQL error classifications. Native harness review additionally required an exact group count, bounded failure reporting, partial-construction cleanup and actual listener handoff observations. These corrections are retained in the review history; initial provisional passes are not final acceptance.

Native source review passed for eight scenarios on fresh disposable PostgreSQL databases in both crypto layouts. Both fresh local layouts passed all eight scenarios on PostgreSQL 18.6: public in 24.40 seconds (f2ddbb), extensions in 25.24 seconds (f761fb). Neither 180-second watchdog fired; all four source hashes stayed unchanged. Native evidence is A6145FADFADF1CBE9710935B3740DD71499381F4A3D739A8219EE47E54FE6A1F. Exact-candidate CI, independent Runtime Guardian evidence review and Release review are pending. The CI addition uses separate fresh database names, all accepted migrations and a bounded test process; it does not apply live migrations.

## Remaining work

Complete independent native evidence review, integrate only approved bytes, verify the exact candidate through CI, and record final release evidence. A later session bridge still requires no-create validation, delivery/recovery rules, combined memory limits, HTTP admission and hosted identity evidence. This facade alone completes none of those capabilities. Preserve RC-2, main protection and the existing draft PR stack.
