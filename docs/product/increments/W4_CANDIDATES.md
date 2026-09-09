# W4 reviewed local prerequisites

These receipts describe isolated draft candidates, not a merged or deployed program. W4 remains building in the wave ledger. Full capability, authenticated hosted acceptance, group orchestration and real provider activation are separate gates. Internal independent agent reviews do not substitute for GitHub branch-protection approval.

| Candidate | Exact head | Verified result | Required CI |
|---|---|---|---|
| [PR37 resource quantities](https://github.com/ailuminagency-work/booking-lumin-checkout/pull/37) | `3f3c7388513c536aa2e9cb111534402d60cc9a80` | Shared legacy/new unit accounting; corrected expiry after row-lock waits; all20 migrations/10 SQL suites/local HTTP and observed races | [34401368908 passed](https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/34401368908) |
| [PR38 worker rosters](https://github.com/ailuminagency-work/booking-lumin-checkout/pull/38) | `e255ae0a7c67754dd9a5eb5cbb7fe7136d78288d` | Seven tenant-scoped tables/seven owner RPCs; roster CAS, no worker tenant role; all21 migrations/11 SQL suites/local HTTP and permission/CAS races | [34402679136 passed](https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/34402679136) |
| [PR39 planning-only policy boundary](https://github.com/ailuminagency-work/booking-lumin-checkout/pull/39) | `1a3b956e522654c60d683b3ed425b4b341f4375a` | Explicit opt-in/required policy values; legacy consumer boundary and observed activation races; all22 migrations/12 SQL suites/local HTTP | [34404105422 passed](https://github.com/ailuminagency-work/booking-lumin-checkout/actions/runs/34404105422) |

Each candidate passed builder tests, domain/independent/adversarial review, integration, Runtime Guardian, exact CI and bounded local Release Governor acceptance. Builders and independent reviewers were distinct: quantities root/architecture versus security; roster architecture versus security; policy baseline versus root, with security Runtime Guardian review. Root coordinated integration and release. Exact clean preview packaging passed for each candidate. Accepted earlier migrations were preserved as source files; changes are additive migrations with explicit compatibility boundaries.

The policy candidate's first CI run failed a version-specific test expectation: PostgreSQL15 and18 returned different referential-integrity codes for the same correctly rejected deletion. The corrected assertion requires the specific constraint and retained rows. No database protection was weakened. Its initial failed run is not a verified receipt.

The next owner-roster slice follows [the accepted contract](OWNER_ROSTER_CONTRACT.md): complete bounded snapshot, strict owner APIs, worker/crew/eligibility controls and read-only formatted shifts. Shared schema review alone does not certify the SQL/API/UI implementation. Atomic combined holds, worker job access, confirmation/payment handoff, friendly shift editing, production Auth and hosted deployment remain open.

Netlify synchronization and live infrastructure activation are not certified by these source/CI receipts. Real provider credentials remain prohibited. See the main product specs, execution workflow and wave ledger for full program requirements.
