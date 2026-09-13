# Existing-session validation

W3 implementation in progress on an isolated branch based on reviewed PR72 c1f7dde8592f9502098319868a9ab4d5ae3c20d3. This increment does not complete the session bridge or hosted booking journey.

One new server-internal validator checks an already-issued session against current authoritative policy and its original immutable publication, service and lifetime. It cannot issue, replace or renew a session. A new additive service-role SQL function uses source-first locks and rechecks expiry after waits and rendering. Accepted migrations, issuance/submission operations and the admission facade remain unchanged.

The consumer shares the accepted eight-slot admission facade with the repository and admits at most two local validation operations. SQL rejection permanently charges the affected admission slot; it cannot be followed by a claimed acknowledged rollback through the quarantined lease. COMMIT uncertainty remains read uncertainty and never changes original issuance certainty. Receipt delivery requires acknowledged read completion and final local checks. Raw driver release faults hidden by the facade are not inferred from aggregate counts. Validator close is only an idempotent stop signal; repository close remains composition-wide shutdown.

The local expiry budget floors remaining microseconds to a bounded whole-millisecond duration and compares elapsed time. It may deny less than one millisecond early, while retaining the exact wall-expiry check. No deadline or lifetime is extended.

## Ownership and required gates

Curie owns validator implementation, controlled tests and the native harness. Chandrasekhar owns additive migration0031 and SQL unit tests. Maxwell supplies independent source/adversarial review. Root owns shared test inventory, registration, documentation, integration and release coordination. Native proof must be reviewed independently and exercise both crypto layouts, genuine COMMIT/ROLLBACK/response loss, locks, no-create/write attempts and shared admission before exact-candidate CI and Release review.

The validator has passed 91 controlled tests and nine independently authored adversarial groups. Independent review closed an acquisition-deadline cleanup defect and corrected a test that had installed its fault after the dependency was captured. The first actual SQL run passed all 31 migrations and five retained suites, then failed in the new test helper before validator assertions. After independent review of the test-only correction, fresh public and extensions databases each passed all 31 migrations and all six SQL suites on PostgreSQL 18.6. The failed attempt is retained. These SQL checks do not establish native transport or concurrent wait behavior. The full action API regression suite passed 750 tests. A separate fresh native run passed all eight groups in both crypto layouts, alongside all 31 migrations and six SQL suites; public completed in 49.49 seconds and extensions in 43.41 seconds including setup. Six frozen source hashes were checked before and after execution. Group 08 observed actual queued-checkout rejection; it does not claim the unobserved late-delivery branch ran. Independent native Runtime review, exact-candidate CI and Release remain pending. The previous PR72 candidate passed CI34722632069 and independent bounded review, including both16-case runtime layouts; its earlier42ac hosted01 failure remains an unexplained historical risk, not a claimed product fix.

No HTTP route, browser capability, token cache, acknowledgement, controller operation, real credential, deployment or live migration is activated. Full W3-W8 acceptance remains incomplete.

## Exact-candidate CI return

PR73 candidate a7cb1735de8a10fde5bea95ef80f4a3e2dcee796 failed CI34732747598. Verify, database (including both native validation layouts) and document jobs passed; the runtime browser job failed runtime01 after8241ms. Its retained schema2 summary reports UNKNOWN; the other15 cases passed. This is a required gate failure, so Release remains blocked. The original artifact is retained; no harmless-flake or shared-cause claim is made.

Independent review identified a diagnostic compatibility defect: pinned Playwright serializes an ordinary Error with an `Error: ` prefix, while the phase mapper only accepted bare fixed literals. An actual bounded no-browser Playwright control reproduced this loss of phase. Correcting the finite allowlist is diagnostic repair only; it cannot recover the historical phase, identify the failing assertion or establish runtime correctness. The repair must retain exact matching and privacy guards, pass independent tests/review and receive new exact-candidate CI. No runtime assertion, deadline or retry policy may be weakened.


## Corrected candidate disposition

PR73 head `79bead0cbcb43329274384709b6c89579386317e` passed exact CI34733593350: four jobs, 114 steps, zero skipped. The tested merge tree matches the candidate tree. Both local runtime layouts produced complete16-case PASS summaries and six screenshots each; independent artifact verification and bounded draft Release review passed. The final14-file artifact SHA256 is BEEDCFF7CEC1C3442D662076D2E71ED6A3EDFBACF9EE15ED8DEED7EE3F39F637. The phase diagnostic repair is accepted only within that bounded reviewed candidate. Neither historical runtime01 failure has a proven underlying cause or behavior repair. PR73 remains draft and unmerged; no hosted acceptance or deployment is implied.
