# Wave 3: persisted customer request

Status: building; no runtime or release approval yet. Parent baseline is Wave 2 candidate `7d3aa25db68cdaeb91443f0b6b65499225f6f84c`, verified by CI run 34392916629. Changes remain additive and isolated from main.

## Increment boundaries

W3.1 implements a runnable local Portal → draft → immutable publication → pinned customer session → unconfirmed booking request journey. It uses synthetic identities and disposable PostgreSQL. It must not claim production authentication, hosted origin certification, payment collection or reserved availability.

W3 remains unfinished until the workflow's full acceptance criteria are met, including two generic presets and staging request persistence. Missing deployment access must remain visible; a local harness cannot replace that gate. Existing connected checkout remains compatible.

## Ownership

| Cell | Branch | Owned changes |
|---|---|---|
| Storage | codex/wave3-storage | Additive migration 0017, SQL assertions and transaction races |
| API | codex/wave3-api | HTTP boundary, service repository, owner/customer credential separation, runnable local harness |
| Experience | codex/wave3-ui | Portal flow editor, hosted customer entry, shared question renderer and HTTP client |
| Integration | codex/product-wave3 | Interface approval, dependency lock, CI, integrated verification and evidence |

Independent review rotates away from authors. Governor checkpoints are review responsibilities, not separate simultaneous agents or GitHub approvals.

## Required evidence

| Scenario | Required outcome | Status |
|---|---|---|
| Owner saves and refreshes | Persisted service binding, configuration and revision restored | Pending |
| Concurrent editors | One compare-and-set winner; loser preserves input and receives conflict | Pending |
| Foreign service, staff, platform or anonymous mutation | Rejected with no writes | Pending |
| Publish then edit service/draft | Existing session retains its immutable version and question schema | Pending |
| Two service presets | Same engine and renderer; no industry-specific source branch | Pending |
| Valid customer request | One draft booking, correct provenance and one outbox event in one transaction | Pending |
| Concurrent identical retries | Same reference; no duplicate customer request or event | Pending |
| Changed retry input | Conflict without overwriting accepted input | Pending |
| Outbox failure | Booking, provenance and session completion all roll back | Pending |
| API restart | Previously accepted retry still resolves from database | Pending |
| Invalid session, origin or answer | Expiry, revocation, inactive service, tenant substitution and invalid choices rejected | Pending |
| Price/state injection | No client-supplied amount, confirmed state or payment side effect | Pending |
| Browser owner journey | Actual HTTP save, reload and publish observed | Pending |
| Browser public origin | Trusted HTTPS origin required; certificate warnings are not bypassed | Pending |
| Runtime regression | Existing application tests/builds and all migration/RLS/race suites pass | Pending |
| Exact candidate CI | Both required contexts pass on pushed candidate SHA | Pending |
| Hosted staging | Authorized deployment, real authenticated isolation and persisted request verified | Blocked: infrastructure/access and identity evidence unresolved |

Local automated HTTP tests may send a fixture HTTPS Origin to test the comparison. That does not prove browser CORS or hosted origin enforcement. If no trusted local certificate exists, record the browser limitation rather than changing the production allowlist policy.

## Review cycle

Builder → tests → domain review → independent review → adversarial tests → integration → Runtime Guardian → CI → Release Governor. Any failure returns to the builder and invalidates affected approvals. Record tested commits and limitations before advancing the ledger.
