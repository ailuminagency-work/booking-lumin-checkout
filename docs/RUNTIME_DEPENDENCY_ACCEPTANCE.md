# Runtime dependency acceptance

The pg-backed acceptance CI job runs the existing HTTP Housekeeping golden journey
in its own fresh database under `apps/api/scripts/deny-external-network.mjs`.
The preload self-tests external fetch/TCP denial and fails the process if the
application attempts an external call, even if the application catches that error.
Only loopback connections are allowed by these in-process hooks. This is not an OS
firewall and does not cover subprocesses or custom transports.

The journey uses synthetic owner identity and staging_mock payment. It covers
server-computed availability, draft, hold, simulated payment, confirmation, replay,
tenant denial, tampering rejection and durable single-payment state. It does not
certify hosted Google login, browser/Portal persistence, or real-provider recovery.

`dependency-outage-http.test.ts` adds deterministic unit/HTTP boundary injection:
real identity verifier network rejection produces 401 before availability; pool
connection rejection produces generic 500; mock-payment callback failure produces
generic 500 without a success receipt or confirmation invocation. These are not
proof of transaction rollback after a real charge or ambiguous-charge recovery.

Run: `npm run test --workspace=@lumin/api -- --run src/dependency-outage-http.test.ts`
Run the isolated pg-backed CI suite: `bash apps/api/scripts/run-integration.sh`.
The runner requires local Postgres and creates a fresh database per harness.
Windows manual equivalents must use UTF8 databases and remove ambient libpq service
overrides; reusing a populated golden database violates single-business fixtures.
