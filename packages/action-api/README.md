# Controlled Action API and local persisted flow server

`src/index.ts` remains the pure five-action booking dispatcher introduced in W2. Its getBooking/findAvailability/assignWorker/rescheduleBooking/cancelBooking domain handlers are still unwired: the new server does not silently implement those operations.

`server/` adds the W3.1 **LOCAL_HARNESS** composition: Node HTTP → fixed parameterized PostgreSQL RPCs from migration0017 → persisted draft/publication/session/request. It runs on loopback only with synthetic identities and has no real Auth, TLS deployment, provider credentials, payment/hold actions or production startup mode. W3.1 is not the full W3 acceptance gate.

## Run the disposable local harness

Apply the local Postgres harness and migrations0001..0017 to a dedicated disposable database. Set LOCAL_HARNESS=1, FLOW_TEST_DISPOSABLE=1, PGHOST=127.0.0.1, PGPORT to the local port, PGUSER to the test database user, and PGDATABASE to an explicitly named lumin_* disposable database. Never use a live Supabase database. Then:

- `npm run local:seed -w @lumin/action-api` seeds two generic A services and a foreign B service with zero pricing; owners, staff and platform-only synthetic identities.
- `npm run local:serve -w @lumin/action-api` listens at http://127.0.0.1:8787 (FLOW_API_PORT may select another unprivileged port).
- `npm run test:flow-http -w @lumin/action-api` performs the mandatory real PG HTTP journey. Missing harness/database configuration fails; it never silently skips.

Owner browser Origin is exactly http://127.0.0.1:5174. Customer origin is exactly https://booking.local.test. Synthetic owner token local-owner-a-synthetic-token and tenant a3100000-0000-4000-8000-000000000001 are fixture credentials only; pass bearer tokens in headers and keep them in browser memory. Staff/platform fixture identities cannot publish. Health reports LOCAL_HARNESS; no token/password/database URL is logged.

Do not bypass certificate warnings. Automated HTTP tests sending the synthetic HTTPS Origin prove origin matching and actual persistence, not browser TLS/CORS. Owner browser interaction can run on local HTTP; full customer-browser acceptance remains pending a trusted TLS setup. Published Netlify packaging must exclude harness configuration. Existing Supabase runtime paths remain separate.

## Flow HTTP boundary

Owner GET services/flows/requests and flow draft require a synthetic authenticated user; SQL rechecks current tenant membership. Draft save/publish require current owner and active tenant. These use `?tenantId=` only as an untrusted tenant selector. Caller actor/role/version-snapshot fields reject. Customer issuance uses a published installation locator plus exact allowed Origin; submission uses a32-byte random opaque session token. Only SHA256 token hashes reach storage. Sessions are not tenant members.

JSON request bodies are limited to32KiB; headers16KiB; request/header timeouts10s; loopback clients have120 requests/minute. These are bounded local safeguards, not a distributed production rate-limit design. CORS permits only configured exact origins and named headers/methods; SQL additionally checks installation/session origin. Fixed RPC names and typed placeholders prevent caller-selected SQL. Every repository transaction sets local service_role, parses its allowlisted result before commit, and rolls back/releases on error. Pool transactions are not a generic table proxy. Production requires a separately reviewed verified-JWT composition and caller-scoped RLS/narrowly reviewed RPC authority.

W3.1 supports unconditional ordered question steps only, all service questions exactly once, fixed required flags, and single_choice/multi_choice/quantity answers. Service fixtures have no prices, tax, items, add-ons or rental rules. Unknown fields, unsupported conditions/effects, paid state, client tenant/service overrides and malformed answers reject. SQL derives immutable render snapshots and rechecks pinned/live constraints. Customer requests stay draft/unconfirmed with empty pricing and no hold/payment. Current origin/expiry/revocation/active policy applies even to retries; only an already-committed identical request bypasses the new-effect future-date check.

## W2 booking dispatcher boundary remains intact

Construct createActionApi with a server-owned authentication verifier and explicit domain handlers. It accepts strict bounded JSON16KiB, named actions, schema version1 and safe versions; mutations include idempotency/expectedVersion metadata. Owner may request five actions, staff reads only, workers are a distinct rejected broad-booking scope, platform role implies no tenant membership. No configured verifier means unauthenticated; no handler means NOT_IMPLEMENTED.

Handlers must validate every nested record's tenant, preserve RLS, recheck current permission/state inside the committing transaction and persist idempotency receipts. No in-memory cache pretends to make durable exactly-once writes. Responses/errors are allowlisted and redacted. Availability offers must be unexpired and within the requested interval; they do not reserve capacity. A response suppressed after expiry or output failure does not imply a committed effect was rolled back. Real booking/refund/assignment implementations remain later work.

## Evidence limits

Package tests exercise synthetic verifier/handler boundaries and actual loopback HTTP parsing/CORS/error behavior. Mandatory PG HTTP acceptance seeds two presets, checks current owner/staff/platform/foreign-tenant decisions, persistence across HTTPserver/pool restarts, CAS conflicts, pinned render sessions, concurrent identical requests, durable retry and one booking.requested outbox row. It verifies draft/no-money/no-hold/provenance data directly in the disposable DB. SQL-specific rollback, lease and policy races remain in their separate suites. Neither test set certifies hosted Auth, browser HTTPS, providers or the complete W3 program.


Configurable request increment: explicit `/api/configurable-flows` owner list/draft/publish endpoints use reviewed workflow V2 normalization plus authoritative PostgreSQL RPCs. V1 endpoint payloads remain unchanged; session output is a strict legacy/V2 union selected by stored version. The catalog endpoint remains the full palette; V2 drafts return an effective preview projection. Body strings that PostgreSQL cannot represent (NUL/isolated surrogates) reject with stable400, including shared customer input; valid V1 strings are unchanged. The pure workflow library accepts a broader JavaScript string domain than PostgreSQL transport. No prices, availability, confirmation or payment authority is conferred by configuration.

`test:flow-http` now requires migrations through0019 and validates V1-to-V2 adoption guards, restart durability, immutable version pinning, required/hidden answer enforcement and catalog-ordinal idempotent retries against real disposable PostgreSQL. Unit mocks are not persistence proof. Local HTTP transport remains a harness; hosted TLS/Auth acceptance is separate.
