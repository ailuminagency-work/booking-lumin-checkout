# Continuation candidate evidence

## Verdict

LOCAL GATES PASS; REMOTE CI / RELEASE BLOCKED. Nothing pushed, merged, deployed or applied live. This is not unconditional RC-2/RC-3 certification or completion of all 18 workstreams. W5, W6, W16, W18 and CI coverage have new offline increments; remaining queues are planned in CONTINUATION_PROGRAM.md.

Base: e5f8ebad0f8975e967c6be167ee324d9ce3a96b9. Branch: codex/program-integration. Remote main was rechecked unchanged after integration. Final commit is recorded in the exported handoff report.

## Builder and independent gate ledger

| Slice | Source commits | Outcome |
|---|---|---|
| CI coverage | 95c1c3 | Independent review passed; integration added both new regression suites after reviewer caught missing wiring |
| Tenant resource relationships | 8d36cd3 | Regression failed before 0013; independent fresh/upgrade, nullable/cascade, parent/child UPDATE and dirty-data rollback attacks passed afterward |
| Overlapping capacity | 4407895 + 98241a6 | Builder and independent reviewer reproduced four double-grant cases before 0014 and verified one winner afterward; function ACLs/settings preserved |
| Mock event delivery | e6a7461 | Typecheck, 9 tests and independent concurrent/reentrant/conflict/tenant/unsubscribe attacks passed within declared mock scope |
| Mock health aggregates | f0829e5 + c07294b | Independent review FAILED mutable allowlist; returned to builder; frozen allowlists fixed it; 16 tests and unchanged independent attacks then passed |

Builders never approved their own changes. Review cells combined domain/independent/adversarial duties; do not claim three independently staffed teams. The coordinator performed Integration Governor and Runtime Guardian checkpoints and withheld Release Governor approval. Local commands are not remote CI.

## Combined local verification

- Clean locked dependency installation passed from cache. Only two local workspace entries were added; no external versions or integrity hashes changed.
- Full workspace typecheck passed, **454 unit tests passed**, all three production app builds passed.
- Legacy contamination check passed with existing informational vertical-template warnings. It is not a comprehensive secret scanner.
- Disposable fresh database: auth harness, ordered active migrations 0001–0014, RLS, capacity, resource RLS and tenant-reference regression suites all passed.
- Identical-final-slot concurrency passed. Four extra cases passed: capacity/resource different overlapping starts and capacity/resource different session timezones. Each yields one grant, one rejection, one hold.
- Independent clean upgrade and dirty-data rollback passed; invalid references abort 0013 without data cleanup or partial DDL.
- Diff/whitespace check passed. Existing apps, core, adapters, contracts, Edge Functions and migrations 0001–0012 are unchanged from observed main.

Local PostgreSQL is **18.6**; required GitHub CI targets **16**; live project reports **17.6**. Candidate PostgreSQL 16 CI has NOT run. Initial sandbox app test/build attempts hit directory-access errors; rerunning identical commands with local execution permission passed. Git Bash utility PATH errors were resolved before accepting contamination/concurrency results; the failed utility invocation's false-clean output was not accepted.

## Runtime and release decisions

Runtime Guardian: PASS for isolation of this offline candidate. Existing runtime imports neither new leaf package; no network collector, provider activation or existing authority edits. New migrations remain unapplied candidates. 0013 takes table locks and requires controlled migration scheduling. 0014 trades concurrency for serialization across one service/resource and assumes READ COMMITTED. These are material deployment/performance limits.

Release Governor: **BLOCKED**. GitHub connection has no write/admin access, so no candidate PR/remote CI exists. Main is unprotected. An owner-enabled repository connection, protected PR workflow, complete review evidence and green exact-candidate CI are required before promotion. Never merge solely because local checks pass.

Still open: RUNTIME-04 Auth/HTTPS verification; RISK-4 financial/audit access; transactional webhook confirmation/persistence errors; payment event-order handling; refund idempotency; quantity-aware resource allocation integration. None is closed by this batch. No real Stripe, Google, email, SMS, calendar, CRM or other provider credentials were connected.
