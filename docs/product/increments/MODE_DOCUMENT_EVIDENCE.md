# Portable installation document — review evidence

This candidate adds a dedicated, inert HTML document handler and a bounded current-policy reader. It is a portable prerequisite for T3 customer delivery, not a running checkout or a deployment. Real public-policy HTTP/database composition, HTTPS/browser framing, T4 loader/controller, session bridge and hosted acceptance remain incomplete.

## Corrected defects

Independent review returned three implementation issues: redirected missing-policy responses were classified before transport validation; clock methods were not captured against later replacement; and a throwing timer cancellation could accumulate callbacks after completed requests. The final correction makes scheduler failure return an unavailable response, close admission and retain bounded cleanup accounting.

Chandrasekhar reproduced the last defect on the prior source: twenty calls succeeded with twenty retained callbacks. The same probe on corrected source returned unavailable for all twenty and retained only one callback. Maxwell independently preserved a failing regression against the old source and a passing result against the correction.

## Independent local checks

- Curie authored the portable source and 57 focused tests; corrected tests and package typecheck passed (7eb96d).
- Chandrasekhar independently reviewed the source, repeated boundary probes and all 57 builder tests (95bb66), and approved the documentation, ledger and root export. Source SHA-256: B5C5200C7BB6B2882AE5FD42C4974F2BDF361ED74B78EB0A026622125662C57B; builder test SHA-256: 954ED0B929EC73829DB4F2987031ED2828194219A8707B58459A01969BC5971B.
- Maxwell authored and ran 72 separate adversarial tests against that source; typecheck passed (75f1ed), tests passed (52834/8ca018). The clear-timer regression failed against the old source (ad66a0) before passing the corrected source.
- Tests use native Request/Response streams, controlled network promises and clocks, an existing DOM parser, and a real ten-second shutdown observation. They do not establish actual browser ancestor enforcement, TLS trust, PostgreSQL policy reads or hosted CDN routing.
- Limits are exercised with valid neighboring inputs: a genuine 16,384-byte padded JSON policy, UTF-8 framing, split streams and sixteen retained operations. Larger defensive HTML/bootstrap limits are not falsely described as reachable valid-schema boundary cases.

Root integrated the reviewed author and verifier commits. All workspace tests passed: 1,494 tests in 19 summaries (044b16, count bc9e4b). All workspace typechecks (01c818), application builds (566b76), 27 workflow/preview/artifact support checks (57dd80), and contamination controls (74384c/003407) passed. The generic vertical-template warning remains an existing reviewed fixture warning. Final clean-candidate Runtime Guardian, exact candidate CI and Release remain required at this checkpoint. Git normalization may change raw line-ending hashes; final integrated Git blob identities and candidate SHA must be recorded separately.

## Protected boundary and next work

No accepted migration or repository authority, legacy checkout, owner Portal route, Netlify registration, deployment profile or provider credential is changed. The handler emits no executable runtime and starts no session. Bootstrap metadata is public, inert and historical; it cannot authorize later booking/payment work.

Next: implement and review the separate public-policy API and guarded local composition; run genuine SQL/HTTPS/browser checks in both crypto layouts; then implement the loader/controller and public session boundary. Keep W3/W4 active and W5–W8 incomplete; W9 remains excluded.
