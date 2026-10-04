# Release Ledger

Owner: Release Governor. Merge gates: G1 scope · G2 contract · G3 unit tests ·
G4 integration · G5 tenant isolation · G6 security review · G7 migration safety ·
G8 observability · G9 independent review · G10 release approval.

| RC | Contents | Gates passed | Status |
|----|----------|--------------|--------|
| RC-0 | Bootstrap: workspaces, contracts v1, governance docs | G1 G2 G3 | released |
| RC-1 | Core engines, adapters, DB schema+RLS, 3 apps, adversarial pass + all 6 fixes | G1 G2 G3 G4 G5 G6 G7 G9 G10 | released — pushed to origin/main 2026-09-02 |

RC-1 gate evidence: G3 unit tests 107 green; G4 cross-package integration (checkout drives real core+adapters); G5 tenant isolation — RLS attack suite 25/25 on PG16; G6 security — all 13 invariants mapped + 6 review defects resolved; G7 migrations apply clean in order on an empty DB; G9 two independent adversarial reviewers. G8 observability (audit_events + event contract) present but runtime wiring is post-deploy. G10 (Release Governor final push) waits on a remote repository.

Release strategy: small coherent batches to `main`; each batch leaves
`typecheck`, `test`, and `build` green at the root. Deployment to any hosted
environment happens only after a remote repository and a NEW (non-legacy)
Supabase project exist, and G5/G6 pass.

## Phase A staging operationalization

`phase-a/staging-operationalization` is the protected implementation line from
`main`. Candidate `5afa46613880f1b7b8a3198df4871b2ea63c08cb` is pushed and
locally verified through typecheck, API tests, golden-flow tests, three
frontend builds, and staging configuration validation. GitHub currently exposes
no workflow runs or status checks for this branch because no PR/CI integration
is attached. Render and Netlify mutations remain pending connector/credential
access; no live database migration or real provider credential was used.
The full workspace suite on the current candidate retains one pre-existing
`@lumin/flow-ui` failure: `modeDocument.test.ts` rejects the test helper's
cross-realm `AbortSignal` (`RequestInit: Expected signal ... to be an instance
of AbortSignal`). The adversarial mode-document suite passed (its deliberately
bounded close case takes about ten seconds). The candidate changes no
`flow-ui` files, so Release Governor holds promotion pending baseline repair
and CI integration.
Read-only Render inventory for confirmed workspace `My Workspace`
(`tea-d9pp87ad0e5s73enrog0`) shows only `leadgate-api` and `leadgate-backup`;
no Booking Lumin staging service exists yet. No Render mutation was performed.

The confirmation surface is intentionally fail-closed at `667090844990cae2837792a41a9f7b456fc8f552`:
it authorizes the tenant-owned booking but performs no payment, hold, booking,
or history mutation until a durable atomic payment-and-hold authority is
implemented. This keeps staging from claiming a confirmation that the current
database/provider boundary cannot prove.

Phase A candidate `f826320` adds the provider-neutral durable authority as
migration `0032_atomic_confirmation.sql`. Its service-role-only RPC accepts a
persisted payment id, derives all tenant, booking, service and pricing context,
requires a stored `succeeded` payment plus an exact active/consumed hold, and
atomically consumes/links/confirms with idempotent replay. Resource-linked and
planning services remain explicitly unsupported; the browser endpoint remains
fail-closed and no provider webhook or live database wiring was added. Source
candidate `bc0a95c8ea0197e4c7993a5ee660c20fbf0c2129` passed a fresh 32-migration
disposable PostgreSQL replay and independent review. Exact integrated-head
checks on `f826320` passed: workspace typecheck, API 27 tests, templates 31
tests, three frontend builds, staging config validation and `git diff --check`.
GitHub still reports no CI statuses/workflow runs because PR integration is
blocked; Render/Netlify mutations and live migration remain out of scope.

The integrated confirmation API candidate `d4b4015ff4b0fe13a63358e3e0c5c10d4d3e7351`
now reaches the durable authority only from a tenant-authorized booking's
persisted `payment_id`. It commits only after strict receipt and final binding
checks; absent payment linkage or an unapplied migration remains
`UNSUPPORTED_CONFIG`. Exact-head checks for the source integration passed with
workspace typecheck, API 32 tests, templates 31 tests, three frontend builds,
staging config validation and `git diff --check`. The candidate is still not a
hosted staging certification: no Render service, Netlify deployment, or live
Supabase migration is present.

The owner/staff draft candidate `6385ec2f655d3900cfde9fc77e74f30999c9bee4`
adds a bounded authenticated booking-creation boundary without changing the
customer flow route or the legacy anonymous draft RPC. Exact-head verification
passed workspace typecheck, API 37 tests and `git diff --check`; the builder's
fresh 32-migration disposable PostgreSQL harness passed staff creation/replay,
tenant and service isolation, interval replay conflict and no-payment/no-hold
side-effect checks. Independent review passed. This remains an unhosted
staging candidate: no Render service, Netlify deployment, live migration or
provider credential was used.

The corrected HTTP golden-flow candidate `62c61a6609f505adfe0691dedda250a0b134fe80`
adds `apps/api/src/phase-a-http-golden.integration.ts`. It exercises the
complete synthetic loopback HTTP path from profile and availability through
draft, reservation hold, staging mock payment, and confirmation, with replay,
tenant/auth denial, amount-tampering rejection, server-derived payment,
consumed-hold, state-history, and capacity assertions. The correction rejects
remote `PGHOSTADDR`, `PGSERVICE*`, `PGPASSFILE`, and `PGOPTIONS` overrides and
requires `PGUSER=postgres` before pool construction. Independent review passed;
builder typecheck and a fresh 32-migration HTTP run passed. No hosted auth,
browser, live database, deployment, or provider activation is claimed.

The candidate is integrated locally on `phase-a/staging-operationalization` at
`938aa73` (six commits ahead of the recorded remote integration head). The
integration push was attempted after exact-head checks but remains blocked by
the local Git transport credential error `SEC_E_NO_CREDENTIALS`; GitHub write
operations also remain unavailable to this session. The builder branch
`codex/phase-a-golden` and its implementation commit are already pushed, so the
source is preserved remotely while the integration line awaits restored write
credentials. No merge, deployment, live migration, or provider activation was
attempted.

The read-only staging smoke candidate `ae36f68aad1d26acf151d31d4b4bbd970cfe0bb5`
adds `npm run smoke:phase-a`. It verifies the liveness/readiness probes and,
when explicitly supplied with a staging token, tenant, service and origin,
checks authenticated profile and availability responses. It is GET-only,
rejects mutation flags, redirects, invalid roots and partial credentials, and
caps time and response bytes without logging secrets or response bodies. The
offline self-test, help path, syntax check, exact-head typecheck, API 37 tests,
templates 31 tests and staging-config validator passed. Independent review
passed. This remains a read-only local/staging tool; no credentials or hosted
runtime were used.

The staging-fake payment candidate `f5120464d47ec1916334234f28a25ae8ce6c98db`
adds a narrowly scoped `POST /api/bookings/mock-payment` completion boundary.
It is unreachable unless `BOOKING_LUMIN_ENV=staging` and
`BOOKING_LUMIN_FAKE_PAYMENTS=1` are both explicit. The caller supplies only a
booking ID; tenant membership, service ownership, amount, currency, persisted
payment evidence, hold validity, and confirmation are server/database
authoritative. It supports only simple base-price services and performs no
provider I/O. Builder typecheck, API 42 tests, and a fresh 32-migration
disposable PostgreSQL harness passed; an independent security review passed.
The exact-head workspace typecheck passed, while local Windows nested-worktree
Vitest/build execution remains environment-blocked by esbuild path access and
the integration shell script requires Bash. This is not hosted staging proof:
no Render service, Netlify deployment, live migration, or provider credential
was used.

The staging configuration candidate `c97e0450c22799cc71a71b2e7258984155f2eaf4`
declares the two explicit staging gates required by the mock-payment runtime
in `apps/api/render.staging.yaml`, keeps Render auto-deploy disabled, and leaves
all external endpoints and secrets as `sync: false`. The validator now checks
the exact service identity, gate values, uniqueness, allowed environment keys,
and absence of inline secrets; seven negative configuration fixtures pass.
Independent review and API typecheck passed. No Render mutation occurred.

The local golden-flow candidate `1b374de4af40b9da35616e1e9be85bac05f80877`
adds `apps/api/src/phase-a-golden.integration.ts`, an explicitly disposable
loopback PostgreSQL harness for the first complete housekeeping adapter path:
profile, availability, draft, hold, staging mock payment, and atomic
confirmation. It uses per-run fixture IDs, rejects non-disposable settings,
and checks tenant boundaries, server-derived pricing, replay behavior, payment
linkage, state history, hold consumption, and occupied-slot exclusion. The
builder passed API typecheck and two fresh 32-migration disposable runs;
independent review passed. The harness is sequential and does not replace the
dedicated concurrency suites. No hosted runtime, browser/auth proof, Render or
Netlify mutation, live migration, or provider credential was used.

The runner follow-up `59a21f6bdbced5bb1c74b16aea96ce6b52e29d01` registers that
golden flow in `apps/api/scripts/run-integration.sh` after the existing HTTP
and roster checks. It enforces IPv4 loopback for the disposable database,
rejects remote host/address overrides, and preserves cleanup and lexical
migration replay. Bash syntax and negative host/address fixtures passed with an
independent review. The complete runner was not executed in this Windows slice;
the previously recorded disposable PostgreSQL golden-flow runs remain the
runtime evidence. No hosted/live/provider action occurred.

Draft-PR creation for `codex/phase-a-http-golden` was attempted after review
and was rejected by GitHub with `422 must be a collaborator`. The tested
builder branch remains pushed and the corrected implementation is integrated
locally; this access blocker does not change the implementation or staging
evidence gates.

The local health-factory candidate `ea8a83d13c79814a91af0deb2f36e94f01e3a133`
adds `apps/api/src/phase-a-health.integration.ts`. It runs the actual
`createFlowHttpServer` on IPv4 loopback, asserts the exact local `/health`
response and hardening headers, verifies route-boundary non-GET rejection, and
checks `/ready` denial both without credentials and with a valid synthetic owner
credential, proving the factory does not expose the production readiness
handler. Ambient libpq routing and credential overrides are rejected before pool
creation, and cleanup is explicit. Independent review and API typecheck passed;
focused execution was blocked by Windows Node `uv_os_get_passwd ENOMEM` before
module load. No hosted or production readiness proof is claimed.

Draft-PR creation for `codex/phase-a-health-runtime` was attempted after the
independent PASS and was rejected by GitHub with `422 must be a collaborator`.
The reviewed builder branch remains pushed, while the corrected implementation
and evidence are preserved locally on the staging integration line. This is an
access blocker only; no merge, deployment, live migration, provider activation,
or protected-main write was attempted.

The Phase A runner follow-up is integrated locally at `a72cf0d` (preceded by
`059fc03`). It registers the accepted local health-factory harness alongside
the HTTP, roster, and housekeeping harnesses. Before any `psql` database setup,
the runner clears ambient `DATABASE_URL`, `PGHOSTADDR`, `PGSERVICE`,
`PGSERVICEFILE`, `PGPASSFILE`, and `PGOPTIONS`, then explicitly exports the
disposable loopback identity. This closes the environment-inheritance gap
identified in independent review while preserving the existing migration and
cleanup behavior. API typecheck, smoke self-test, staging-config self-test,
and whitespace checks passed; Bash syntax and the full disposable runner were
not executable on this Windows host because Bash/PostgreSQL service tooling is
unavailable. The integration branch was previously local-only while the Git
transport credential error was active; it is now pushed at the exact candidate
below. No hosted deployment, live migration, provider activation, or
protected-main write was attempted.

Draft-PR creation for `phase-a/staging-operationalization` was attempted after
the exact-head checks and push, but GitHub again rejected it with `422 must be a
collaborator`. The implementation branch is nevertheless pushed at
`74d9a6ef98424c0c645bc24b04442e607ab488bf`; this PR access issue does not
block further implementation work and is recorded separately from the code
and test evidence.

The rental/resource concurrency candidate `e877327` adds
`apps/api/src/phase-a-rental-concurrency.integration.ts` and is integrated on
the staging line with the runner registration. It uses the authoritative
`public.reserve_resource` and `public.release_resource_holds` RPCs against a
disposable loopback database, proves one grant versus one capacity rejection
for concurrent requests on a capacity-1 vehicle, checks tenant/resource
isolation with a foreign booking, replay identity, release, and absence of
payment or confirmed-booking side effects. Independent review returned a
cross-tenant fixture defect; the builder corrected it and the re-review passed.
API typecheck, smoke/config self-tests, and whitespace checks passed. Direct
execution hit Windows Node `uv_os_get_passwd ENOMEM` before module load, and no
PostgreSQL listener is available on `127.0.0.1:5432`; this is not hosted or
live proof. No deployment, live migration, provider activation, or protected-
main write occurred.

Draft-PR creation for the updated `phase-a/staging-operationalization` head was
attempted after push and again rejected by GitHub with `422 must be a
collaborator`. The exact candidate `407e8c7c93e905b37859687d913b1fde9c959703`
is pushed; GitHub reported no workflow run for that commit. The PR permission
issue remains separate from the implementation, review, and local test gates.

The detailing-flow candidate `6b3aaca` adds
`apps/api/src/phase-a-detailing-flow.integration.ts` and registers it in the
disposable integration runner. The reviewed harness seeds a configurable
detailing service with vehicle/package questions, a package item, and an
add-on; it verifies tenant/profile and availability isolation, canonical
Selection v1 persistence, harness-local question/catalog binding with
separate invalid-answer and invalid-catalog cases, idempotent draft replay,
exact empty pricing/payment state, zero payment/capacity/resource side effects,
and fail-loud cleanup. Its explicit service-role scope does not claim caller
authentication or production RPC catalog authority. Independent review passed
after one correction cycle. API typecheck, smoke self-test, staging-config
self-test, and whitespace checks passed. Direct execution remains blocked by
Windows Node `uv_os_get_passwd ENOMEM` before module load and no PostgreSQL
listener on `127.0.0.1:5432`; no hosted/live/provider action occurred.

The exact detailing candidate was pushed to
`phase-a/staging-operationalization` at `2cb8a0c65f8d8cd018c401d48750d9a840f6d753`.
Draft-PR creation was attempted with GitHub CLI, but this environment has no
authenticated GitHub CLI session (`gh auth login` is required); previous
authenticated attempts on this repository were rejected with `422 must be a
collaborator`. The branch push, local checks, and independent review remain
valid; no merge, deployment, live migration, provider activation, or protected
main write was attempted.

The A16 detailing HTTP candidate `f62ceda` adds
`apps/api/src/phase-a-detailing-http.integration.ts` and registers it in the
disposable integration runner. It exercises fresh per-run owner/staff/foreign-
owner HTTP profile and availability checks, owner/staff draft authorization,
foreign-owner and cross-tenant/service denial, replay, strict route input
rejection, and separately scoped service-role canonical Selection v1
persistence with zero payment/capacity/resource side effects. Independent
review passed after correcting shared-fixture identity cleanup and clarifying
that the direct canonical helper bypasses HTTP caller authentication. API
typecheck, smoke self-test, staging-config self-test, and whitespace checks
passed; direct execution remains blocked by unavailable loopback PostgreSQL.

The A16 implementation and registration are pushed at exact head
`0bdbd97d62bd8bb19a95f262983b0c0df1c9a2d3` on
`phase-a/staging-operationalization`. Draft-PR creation remains blocked by
the unauthenticated GitHub CLI session in this environment (and the prior
repository collaborator restriction); no merge or release action was taken.

The A17 rental HTTP candidate `4f83b8d` adds
`apps/api/src/phase-a-rental-http.integration.ts` and registers it in the
disposable integration runner. It covers fresh-identity HTTP health/profile/
availability/draft authorization and replay, then a separately scoped
service-role resource race because the current HTTP API has no resource route.
The harness proves one `GRANTED` versus one `NO_CAPACITY` on capacity one,
foreign-resource denial, replay, release, and no payment/capacity-hold/
confirmed-booking side effects. Independent review passed after correcting the
foreign-owner profile status expectation. API typecheck, smoke self-test,
staging-config self-test, and whitespace checks passed; local PostgreSQL is
unavailable, so focused runtime remains unverified.

The A17 implementation and registration are pushed at exact head
`0d6e6d2` on `phase-a/staging-operationalization`. Draft-PR creation remains
blocked by the unauthenticated GitHub CLI session in this environment and the
previous repository collaborator restriction; no merge, deployment, live
migration, provider activation, or protected-main write was attempted.

The A18 configurable-selection candidate `1813099` extends
`apps/api/src/draft.ts` and `apps/api/src/draft.test.ts` with a strict,
tenant-scoped Selection v1 boundary. The service catalog is reconstructed from
server rows and validated through the pricing engine; simple-service omission
remains compatible, while omitted configurable/cart/rental selections fail
closed and rental periods are required. Client pricing/payment/state fields are
never accepted, and the authoritative draft RPC receives only validated input.
Independent review returned a high omitted-selection bypass; the builder fixed
it and re-review passed. Focused draft tests passed 9/9, the full API unit suite
passed 46/46, API typecheck passed, and smoke/config/whitespace checks passed.
No hosted/live/provider action occurred.

The A18 implementation and evidence are pushed at exact head
`42cbbe9` on `phase-a/staging-operationalization`. Draft-PR creation remains
blocked by the unauthenticated GitHub CLI session in this environment and the
previous repository collaborator restriction; no merge or release action was
taken.

The A19 detailing HTTP Selection candidate 582d44d updates apps/api/src/phase-a-detailing-http.integration.ts to exercise canonical Selection v1 through the authenticated owner/staff draft boundary, prove exact persistence and replay, reject invalid question/catalog selections before any booking row, and assert no payment/capacity/resource side effects. Independent review returned a high fixture mismatch; the builder corrected the optional package item minimum and re-review passed. Focused draft tests passed 9/9, the full API unit suite passed 46/46, API typecheck passed, and smoke/config/whitespace checks passed. Local PostgreSQL remains unavailable; no hosted/live/provider action occurred.

The A19 implementation and evidence are pushed at exact head 4f976d9 on phase-a/staging-operationalization. Draft-PR creation remains blocked by the unauthenticated GitHub CLI session in this environment and the previously observed repository collaborator restriction; no merge or release action was taken.

The A20 rental Selection candidate 065eb789 updates apps/api/src/phase-a-rental-http.integration.ts for the server-enforced non-simple draft boundary. Owner/staff requests now carry canonical rental Selection v1 with rentalPeriods, local drafts assert exact persistence/state/empty pricing/null payment, missing periods reject before creation, and the resource race/replay/release plus no-financial-side-effects checks remain. Independent review found a foreign tenant selection/service mismatch; the builder corrected it and re-review passed. Focused draft tests passed 9/9, the full API unit suite passed 46/46, API typecheck passed, and smoke/config/whitespace checks passed. Local PostgreSQL remains unavailable; no hosted/live/provider action occurred.

The A20 implementation and evidence are pushed at exact head c62d65e on phase-a/staging-operationalization. Draft-PR creation remains blocked by the unauthenticated GitHub CLI session in this environment and the previously observed repository collaborator restriction; no merge or release action was taken.

The A21 mock-payment candidate ad02de6 narrows staging fake-payment authority to simple services with server-reconstructed pricing and adds an explicit runtime archetype guard. Configurable/cart/rental selections and substituted non-simple rows fail closed before payment insertion or confirmation. Independent review returned a test-quality gap; explicit configurable/cart/rental service-row tests were added and re-review passed. Focused mock tests passed 7/7, the full API unit suite passed 48/48, API typecheck passed, and smoke/config/whitespace checks passed. No provider, live database, migration, hosted deployment, or protected-main action occurred.

The A21 implementation and evidence are pushed at exact head 8a0ca3e on phase-a/staging-operationalization. Draft-PR creation remains blocked by the unauthenticated GitHub CLI session in this environment and the previously observed repository collaborator restriction; no merge or release action was taken.

A22 rental mock-payment fail-closed correction:
- Builder: /root/phase_a_rental_mock_payment_builder
- Independent reviewer: /root/phase_a_detailing_review (PASS after correction)
- Source commits: 0166096, f0567e6, 32d7867
- Integrated commits: 8088888, 7664fe5, d1664ec
- Exact candidate checks: focused mock tests 8/8; full API unit suite 49/49; API typecheck; phase-A smoke self-test; staging frontend/API validator; git diff --check all passed.
- Scope: canonical rental Selection v1 now reaches the tenant/service lookup, then remains rejected by the original persisted-selection shape check and runtime archetype guard. No payment insert, confirmation RPC, resource reservation query, or commit survives. Simple-only fake payment remains unchanged.
- Runtime status: no hosted runtime, provider credentials, live migration, or live database action.

A22 push verification:
- Authoritative implementation branch: phase-a/staging-operationalization
- Pushed exact head: 3107c6e (3107c6e9c98b22e130f13e7359882ad5a3a7cb52)
- Remote verification and working-tree cleanliness are recorded separately below.
- Draft PR remains blocked: gh is unauthenticated in this environment and prior authenticated collaborator validation returned GitHub 422; no PR, merge, protected-main write, deployment, live migration, or provider activation was attempted.

A23 rental preflight fail-closed candidate:
- Builder: /root/phase_a_rental_payment_authority_builder
- Independent reviewer: /root/phase_a_detailing_review (PASS after high/medium correction cycles)
- Source commits: 6d795f1, 196f0d1, 5ac3961, fc6055a
- Integrated commits: 8e31fb3, 626319c, fe9de9c, e52d2ea
- Exact candidate checks: focused rental preflight tests 7/7; full API unit suite 56/56; API typecheck; Phase A smoke self-test; staging frontend/API validator; git diff --check all passed.
- Scope: validates tenant/service/resource/hold authority, persisted reservation quantity, resource capacity, DB-clock expiry, and exact slot equality, then intentionally fails closed before payment or confirmation because the current atomic confirmation migration does not support resource-linked rentals or deposit-aware pricing. Simple mock-payment behavior remains unchanged.
- Runtime status: no hosted runtime, provider credentials, live migration, or live database action.

A23 push verification:
- Authoritative implementation branch: phase-a/staging-operationalization
- Pushed evidence head: 9ec78eb (the exact remote head is verified after the blocker record below)
- Draft PR remains blocked: gh is unauthenticated in this environment and prior authenticated collaborator validation returned GitHub 422; no PR, merge, deployment, live migration, provider activation, or protected-main write was attempted.

A24 rental confirmation authority:
- Builder: /root/phase_a_rental_confirmation_migration_builder
- Independent reviewer: /root/phase_a_detailing_review (PASS after correction cycle)
- Source commits: 5901d80, d4545f9
- Integrated commits: 2898112, f9d3ef7
- Exact candidate checks: full API unit suite 56/56; API typecheck; Phase A smoke self-test; staging frontend/API validator; git diff --check; SQL static guard confirming supported JSON helpers, simple advisory lock, and finite-expiry predicate all passed.
- Runtime contract: migration is prepared and pushed but not applied to any live database. Disposable PostgreSQL execution is blocked because no loopback PostgreSQL listener is active. Rental confirmation is now server-authoritative and atomic when the migration is applied; no provider activation or hosted deployment occurred.

A24 push verification:
- Authoritative implementation branch: phase-a/staging-operationalization
- Pushed evidence head: 44e59d2 (exact remote head verified after the blocker record below)
- Draft PR remains blocked: gh is unauthenticated in this environment and prior authenticated collaborator validation returned GitHub 422; no PR, merge, deployment, live migration, provider activation, or protected-main write was attempted.

A25 rental mock-payment runtime and HTTP boundary:
- Builder: /root/phase_a_rental_payment_runtime_correction (source `a254b45`, corrected writer tests `4e1cb53`)
- HTTP fixture correction builder: /root/phase_a_rental_payment_http_correction (source `f9edea7`)
- Independent reviewer: /root/phase_a_rental_payment_http_review (PASS)
- Integrated candidate: `0ace15e` on `phase-a/staging-operationalization`
- Exact candidate checks: focused writer+HTTP tests 6/6; full API unit suite 62/62; API typecheck; workspace build (checkout, command-center, portal); Phase A smoke self-test; staging frontend/API validator; git diff --check all passed.
- Scope: staging-only rental mock-payment route accepts only bookingId; server code derives pricing/payment state, rechecks tenant/resource/hold authority, calls the atomic confirmation function, and supports consumed replay. The HTTP test correction preserves strict malformed-input rejection and explicitly verifies foreign-tenant context is passed to the authoritative writer, which returns 404 after its own tenant checks.
- Runtime status: no hosted runtime, provider credentials, live migration, or live database action. Disposable PostgreSQL runner remains unavailable on this Windows host (no Bash and no loopback PostgreSQL listener).

A25 push status before Release Governor:
- Authoritative implementation branch: phase-a/staging-operationalization
- Candidate is locally integrated at `0ace15e`; it has not yet been pushed because the next exact-candidate push gate is still pending.
- Builder branch remains pushed at `4e1cb53` before the HTTP fixture correction; after correction, source branch remote head is `f9edea7`.
- Draft PR remains blocked: `gh auth status` reports no logged-in GitHub host; prior authenticated collaborator validation returned GitHub 422. No PR, merge, protected-main write, deployment, live migration, or provider activation was attempted.

Current runtime verification after A25:
- GitHub remote `phase-a/staging-operationalization` resolves to `d601e788b04fc1cb544bd962d1f308e482c14e28`; builder branch `codex/phase-a-rental-confirmation-authority` resolves to `f9edea79170a4af18bc1b38cdffdce2d6a87764e`.
- The existing Netlify site `gregarious-longma-6158a8` is linked to `ailuminagency-work/booking-lumin-checkout`, allows `main` and `codex/reviewed-preview`, and its ready production-context deploy is `c5663c59e134e71beb511f509b3287ab0046bdff` from `main`. It does not publish `phase-a/staging-operationalization`, so A25 is not live there.
- Render read-only inventory is blocked by an expired local Render token (`render services list` requested `render login`); no Render mutation was attempted. A Booking Lumin staging API health check is therefore not claimed.
- `gh auth status` reports no logged-in GitHub host; no draft PR, merge, protected-main write, live migration, or provider activation occurred.

A26 host-runtime acceptance candidate:
- Builder: `/root/phase_a_host_runtime_health_builder`
- Independent reviewer: `/root/phase_a_host_runtime_health_review` (PASS)
- Integrated and pushed candidate: `9d0010f1021cbd8acd2d9fc7d1abcb4653929649` on `phase-a/staging-operationalization`
- Scope: real `apps/api/src/main.ts` host process is started with synthetic configuration and exercised over a bounded loopback port. `/health` is asserted as exact 200 `{status:"ok"}` with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; `/ready` is asserted as fail-closed 503 `{status:"unready"}` against unavailable loopback PostgreSQL. Process closure is bounded and platform-aware, and captured output must not contain the synthetic database password.
- Exact candidate checks: focused host-runtime test 1/1; full API unit suite 63/63; API typecheck; workspace build for API, checkout, command-center, and portal; Phase A smoke self-test; staging frontend/API validator; `git diff --check` all passed.
- Runtime status: this proves local host-runtime behavior only. No hosted Render staging deployment or health check is claimed because Render access remains blocked by an expired local token. No live migration, provider credential, or production runtime was touched.

A26 push verification:
- `phase-a/staging-operationalization` is locally at `9d0010f1021cbd8acd2d9fc7d1abcb4653929649`; its local `origin/phase-a/staging-operationalization` tracking ref resolves to the same SHA after the builder push.
- Draft PR creation remains blocked by unauthenticated GitHub CLI access; no merge, protected-main write, hosted deployment, live migration, or provider activation occurred.

A27 hosted golden-flow harness:
- Builder/implementation: `/root` after a bounded hosted-flow builder cell was interrupted before modifying the integration line.
- Independent reviewer: `/root/phase_a_hosted_golden_flow_review` (PASS)
- Integrated and pushed candidate: `5c853821b4398535a55e940452a0244048dc17e5` on `phase-a/staging-operationalization`
- Scope: adds `scripts/phase-a-staging-golden.mjs` and `golden:phase-a`. The harness performs no work unless `BOOKING_LUMIN_GOLDEN_FLOW=1` and all explicit staging inputs are valid. It then exercises the existing owner HTTP contract through profile, availability, draft/replay, hold/replay, staging mock payment/replay, and confirmation replay, with strict schemas, bounded JSON/timeout handling, redirect rejection, and secret-safe output.
- Exact candidate checks: offline golden-flow self-test; API typecheck; full API suite 63/63; workspace build; Phase A smoke self-test; staging frontend/API validator; `git diff --check` all passed.
- Runtime status: hosted execution is intentionally unverified pending isolated staging API/database/token/origin access. No deployment, live database write, migration, or real provider credential was used.

A27 push verification:
- `git ls-remote` confirms `phase-a/staging-operationalization` at `5c853821b4398535a55e940452a0244048dc17e5`.
- Draft PR creation remains blocked by unauthenticated GitHub CLI access; the branch is pushed and main remains untouched.

A28 local migration replay runner:
- Builder/implementation: `/root` after a bounded migration-runner builder cell was interrupted before modifying the integration line.
- Independent reviewer: `/root/phase_a_windows_migration_runner_review` (PASS after duplicate-script correction)
- Integrated and pushed candidate: `b0573b9a894a28acf06fb4b23d9e14c449734b34` on `phase-a/staging-operationalization`
- Scope: adds a Windows-safe Node runner for the local harness plus sorted `0*.sql` migrations. It is explicit-opt-in, loopback-only, requires `PGDATABASE=lumin_phase_a_*`, rejects remote/service/password/options overrides and `DATABASE_URL`, and invokes `psql` with `-X` and `ON_ERROR_STOP=1`. It never creates or targets a hosted/live database.
- Exact candidate checks: offline migration self-test; workspace typecheck; full API suite 63/63; workspace build; Phase A smoke self-test; staging frontend/API validator; hosted golden self-test; `git diff --check` all passed. The first review found and the correction removed one duplicate root script entry.
- Runtime status: no local PostgreSQL listener is available, so no migration application is claimed. Hosted staging remains blocked by expired Render access.

Phase A hosted service creation (PH-A29):
- Render service `booking-lumin-api-staging` was created separately in My Workspace (`srv-db0142btqb8s73e4e1rg`) from the pushed `phase-a/staging-operationalization` branch at `191687e59915f626efcb41fe416227b088bc43d9`.
- Configuration is isolated from LeadGate: repository `ailuminagency-work/booking-lumin-checkout`, root directory `apps/api`, build `npm ci --prefix ../.. && npm run build`, start `npm run start`, `/health` check, Oregon region, free plan, and auto-deploy disabled. Only non-secret staging gates were set (`BOOKING_LUMIN_ENV=staging`, `BOOKING_LUMIN_FAKE_PAYMENTS=1`, `NODE_ENV=staging`, `PORT=8080`).
- Render built the candidate successfully, then the first deploy exited with status 1 because `DATABASE_URL` is missing. This is expected until an isolated staging Postgres/Supabase endpoint is provisioned and authorized. No database credential was entered, no migration ran, and no provider or production resource was touched.
- Service URL: `https://booking-lumin-api-staging.onrender.com`. Hosted `/health` is not certified because the service is not running without the staging database contract.

A28 push verification:
- `git ls-remote` confirms `phase-a/staging-operationalization` at `b0573b9a894a28acf06fb4b23d9e14c449734b34`.
- GitHub CLI remains unauthenticated; no draft PR or merge was created, and `main` remains untouched.

## Phase A implementation batch: locked owner navigation and staging runtime contract

- Pushed 5435a311da449ac6a451c39ecbd3a7af507cfcee on phase-a/staging-operationalization.
- Changed packages/runtime-client/src/publicConfig.ts and its tests so staging-only aggregate surfaces can use VITE_RUNTIME_MODE=mock; production mock mode fails closed.
- The same implementation line already contains the five-area portal navigation. GitHub CI 37079577432 is green for typecheck, tests, build, contamination, migration replay, RLS attacks, and domain security.
- Netlify previews for checkout, portal, and command center were loaded and checked without console errors.
- Isolated Supabase staging branch creation remains pending explicit confirmation of the displayed recurring branch cost ($0.01344/hour); no live migration or provider activation occurred.

## Hosted readiness recovery batch — 2026-10-03 UTC

- Builder / integration: `/root`. Independent reviewer: `/root/portal_recovery_review`. No protected-main merge or LeadGate changes.
- Portal implementation: `acaf8606a2bf273a4fef079c21cbab9f0744dc5a`, pushed to `phase-a/staging-operationalization`; draft PR #97 retained. Non-forced SPA fallback, Netlify-selected config mirror, authenticated tenant membership discovery, explicit STAGING/TEST banner, fail-closed unbound booking submission.
- Portal CI: run 37098754815 success. Runtime-client 21/21, Portal 91/91, typecheck/build and deployment contract checks passed. Independent review passed after fixes.
- Canonical Portal deploy: Netlify `6ac08d598ae8e2000823eca5`, ready at acaf8606; https://booking-lumin-portal-staging.netlify.app. Preview #97 also ready. Direct URLs, refresh/login and navigation verified for /, /bookings, /embed, /services, /settings; nested booking/settings URLs return SPA HTML rather than Netlify404. Route loading does not certify feature completeness.
- Isolated staging: Supabase development branch `booking-lumin-staging`, ref `hqgtjztrsizjrsidtlqt`, migrations through0033. Controlled owner and housekeeping service fixture created only here. Hosted owner authentication, membership and real service read passed. Sessions currently end on refresh; service editing, builder and operational booking detail remain incomplete.
- API trust fix: `5cc3f039721b133de4b225b81dc11a4115fd2014` public official Supabase root certificate + NODE_EXTRA_CA_CERTS; validator corrected in `1c2d5073aa0d2f8a509d4de677bae211588599d0`. Independent provenance/security review and3contracts/8negative fixtures passed. Exact1c2d507 CI37099557184 success.
- Render environment now targets isolated hqgtjztrsizjrsidtlqt, proper publishable auth key, exact canonical/preview Booking Lumin origins, verified TLS. Parent/live database not migrated; no real payment provider activated.
- Readiness observability: cb181027d0ade62fb9520de5f080a4b189159d19 logs fixed DB_AUTH/DB_TLS/DB_NETWORK/DB_UNAVAILABLE categories only. Focused test/typecheck passed; reviewer caught node:test versus Vitest runner mismatch, corrected in b41819c. No raw credential/error detail logging.
- Render last observed deploy dep-db093sou01pc739cfaj0 LIVE at cb181027. /health200; /ready503. New safe log proves DB_AUTH, after certificate trust repair. Service is NOT database-ready and golden flow is NOT certified. Isolated password reset form prepared for user final submission; credential never printed or committed.
- Score: Portal30 ->40 for real routing/auth/catalog evidence. Staging40 unchanged pending ready recovery. Overall hosted business readiness remains35/100: no full hosted booking/payment/confirmation flow passed. All other subsystem scores retain user baseline.
- Immediate executable continuation: complete prepared isolated password reset, redeploy only booking-lumin-api-staging, verify ready200; then implement customer installation-session availability/hold/confirmation and connected Portal booking visibility. Current checkout saves unconfirmed requests only; owner-authenticated hold endpoints must not be exposed by bypassing tenant auth.

## Connected booking visibility and readiness recovery — 2026-10-04 UTC

- Builder/integration/runtime guardian: `/root`; independent reviewer: `/root/booking_list_review`. Review accepted final five-file implementation diff after repairing the navigation test double. No main merge, LeadGate mutation or database migration.
- Connected Portal now reads all seven persisted booking states, including confirmed records, through an authenticated tenant-filtered client query. Rejects foreign-tenant rows, unknown states and invalid timestamps; removes unsupported universal financial labels. Navigation regression verifies confirmed records and logout removal.
- Local validation: runtime-client 23/23; Portal 91/91; Portal typecheck and production build passed. Hosted authenticated booking-list acceptance remains pending a controlled owner session; local tests are not hosted golden-flow evidence.
- Render recovery verified: deploy `dep-db0plp5g1s2s73f5e3vg` LIVE at `6372dac6d279a28c79f5d6035cbdb838c9d24415`; `/health` 200 and `/ready` 200. This supersedes the previous DB_AUTH/readiness blocker. Isolated staging target remains hqgtjztrsizjrsidtlqt.
- Scores: Portal remains40 pending hosted acceptance of this list change; Staging40 ->45 for restored hosted database readiness. Overall remains35; no hosted housekeeping/detailing/rental golden flow certified.
- Next executable task: verify this Portal batch on canonical Netlify, then connect the public installation-session availability/hold/confirmation journey without reusing owner credentials or weakening tenant authority.

## Goal 1 customer availability capability — 2026-10-04 UTC

- Builder/integration/runtime guardian: `/root`; independent review accepted by `/root/booking_list_review` after adding planning-only rejection and observed-lock expiry evidence.
- Added GET /api/flow-sessions/availability: installation-session bearer + exact customer origin, bounded seven-day window, no caller tenant/service identity. SQL derives scope, checks active authority and expiry, holds row locks, excludes planning/resource allocation and rechecks expiry before commit. Existing owner availability calculation is reused without replacing owner authorization.
- Added migration0034 and transactional SQL attacks; local replay through0034 passed. RLS, capacity, overbooking and customer scope attacks passed. Real local integration demonstrated blocked session/origin mutation and denial after an observed tenant-lock wait outlived expiry.
- Added transport and final-expiry regressions. Host subprocess test now uses Node's direct tsx loader and writable TEMP/TMP; its health/readiness/shutdown assertions are unchanged.
- No financial authority was widened, no confirmation writer added, no production or LeadGate mutation. Customer holds/payment remain next implementation steps; this batch does not certify the housekeeping golden flow or raise scores.
- Staging migration/deploy and hosted success/denial checks are required after exact-candidate CI passes. Preserve PR97 as draft. Next executable cell is customer hold bound to the same session and request provenance; do not substitute an owner identity.

Customer availability hosted verification:
- Pushed candidate `55c942c292eb1b6b1b97df2ea76458b682c2790d`; exact GitHub CI `37174382801` succeeded, including migration replay and observed-lock expiry integration. API suite passed 73/73 with the threads pool.
- Migration0034 applied only to isolated staging `hqgtjztrsizjrsidtlqt`. Render deploy `dep-db0siudg1s2s73fg28tg` is LIVE at the same SHA; health and readiness both HTTP200.
- Hosted synthetic installation session returned15 available slots. Tenant spoof was400, missing bearer401, foreign origin403 and unknown session403. Tokens stayed in process memory; output evidence contains no credentials.
- Canonical Portal deploy `6ac1c8de4d23ca0009e88b90` and Checkout deploy `6ac1c8de2df2c6000895bcef` are ready at55c942c. Browser then reproduced a Checkout direct-link Netlify404 at `/checkout/flow/:installation`; this is a deployment routing defect, not a hosted golden-flow pass.
- Active exclusive cells: `/root/customer_hold_builder` owns API/session hold + migration0035 in `work/customer-hold-cell`; `/root/customer_availability_ui_builder` owns flow client and HostedFlow UI in `work/customer-availability-ui-cell`. Root owns Checkout static routing and ledger/CI integration. No payment or confirmation authority is widened.
- Scores remain overall35, Portal40, Staging45. Full hosted booking, payment, confirmation and Portal acceptance are still incomplete.

Goal1 customer hold integration:
- Builder `/root/customer_hold_builder` supplied aeb96b1 and4a8326a; independent `/root/booking_list_review` accepted capability, shared reservation primitive, migration0035 and CI integration. Root integrated owner/capability regressions: API82/82 and typecheck PASS.
- Root replayed harness plus0001–0035 in fresh local `lumin_phase_a_hold_root`; SQL attacks PASS. Actual integration PASS: provenance, identical retry, owner denial, capacity conflict, mismatched service, authority locks, concurrent final-capacity exactly one winner and expired blocked reservation rollback. Existing populated test database initially collided on fixture IDs; the fresh isolated replay resolved that test setup collision.
- CI now runs customer hold SQL attacks and real concurrency/expiry harness in a dedicated freshly migrated database. No payment/confirmation writer changes. Hosted hold verification remains required after exact-candidate CI and migration0035 staging application.
- Root repaired Checkout nonforced SPA routing after browser-reproduced404. Slot-picker builder is correcting the independent review's cross-midnight range defect before integration.

Customer slot-picker and Checkout runtime integration:
- `/root/customer_availability_ui_builder` supplied cbbd0cd/c411483; independent `/root/booking_list_review` returned midnight-boundary defect, builder fixed it with actual-core output regressions, and reviewer accepted final client/UI. Root Checkout full suite46/46, typecheck and build PASS; selected-date slots retain valid midnight-crossing bookings without accepting the next date's starts.
- Browser reload proves Checkout deep-link rewrite now opens the application. It then exposed missing deployed API settings: canonical Checkout had configuration_file_path null and zero site environment entries. Root added mirrored Checkout staging build configs with exact Render API/flow origins, removed placeholder auth/tenant values and selected `deploy/netlify/checkout/netlify.toml` on the verified Booking Lumin Checkout site only.
- Hold batch bff2b6797c59e4a78c42f2d0cb069ef1f67853ac exact CI37175326558 succeeded. Migration0035 applied successfully only to isolated hqgtjztrsizjrsidtlqt. Latest UI/config candidate still needs its own CI/deploy/browser acceptance; do not claim complete golden flow or increase readiness scores.

13d4d02 hosted batch acceptance:
- Exact candidate `13d4d02a09ce240c3663c20fdbae97698a7a5600` pushed; CI37175603656 both verification/database jobs SUCCESS. PR97 remains OPEN/DRAFT.
- Render `dep-db0sv1c9v7es73ct27n0` LIVE with matching remote SHA; health200/ready200. Netlify Checkout `6ac1ced8e674bd0008bf852e` and Portal `6ac1ced8e1666e00084a1960` ready at sameSHA.
- Real hosted customer API fixture creates draft request and one active hold; repeated hold returns identical holdId, spoof body400 and missing bearer401. Database read confirms correct isolated tenant/service/slot and one hold. Fixture remains zero-priced/unconfirmed; payment and hold consumption are not certified.
- Chrome direct published link and refresh load connected session, real date/slots and selected server slot. Browser submitted controlled request LMN-8317BAB0C68E4586B84C0F4CDD1ADD9A; database confirms correct fixture tenant/service/date and draft state. Screenshot and secret-free machine evidence saved in workspace outputs. Browser input initially timed out; observed receipt proved request succeeded, so no duplicate submission was issued.
- Scores unchanged overall35/Portal40/Staging45. Next active cells: explicit customer hold UI; customer test-payment/confirmation capability. Existing legacy published flow requires zero price/questions whereas protected mock-payment primitive requires positive simple service/no questions; paid public-flow support is a genuine implementation dependency, not hosted certification.

Customer payment capability and explicit hold UI integration:
- API builder `/root/customer_hold_builder` commit61e3729; independent `/root/booking_list_review` accepted owner-auth-preserving mock transaction extraction and capability wrappers. Root fullAPI92/92 including host startup and typecheck PASS. Fresh local replay through0036/SQL attacks PASS; actual confirmation integration PASS for controlled persisted payment evidence, concurrent replay, revoked replay denial and expiry rollback after observed payment-lock wait. This is not a complete paid published journey.
- UI builder `/root/customer_availability_ui_builder` commits85d1ab1/cfa835e; reviewer caught and builder fixed actual receipt schemaVersion mismatch, missing request/booking binding and false certainty after ambiguous hold attempts. Final review accepted actual HTTP envelope regression, strict canonical reference/UUID binding and uncertainty-preserving retry messages. Explicit action does not take payment or claim confirmation.
- CI includes customer payment SQL attacks and a dedicated fresh database concurrency/expiry harness. Next paid public-flow V3 cell is active in `/root/customer_hold_builder`, narrowly supporting one server-priced simple positive service without changing legacy zero-price V1/V2 contracts or adding a confirmation writer.
- Integrated hold UI verification: Checkout53/53 and client12/12 (including actual HTTP envelope) PASS; Checkout/flow-ui typechecks and Checkout build PASS. Migration0036 applied successfully only to isolated staging hqgtjztrsizjrsidtlqt. Hosted verification of this new batch remains pending exact-candidate CI/deploy; earlier13d4d02 evidence remains the certified partial flow.

6e4a8dd hosted hold acceptance:
- Exact candidate6e4a8dd5436a8ba0e1dbf0f4d3fc1913a1cc6bd9 pushed, CI37176540610 SUCCESS. Render dep-db0t7utg1s2s73figul0 LIVE, health200/ready200. Checkout6ac1d325e674bd0008bffa3a, Portal6ac1d3256a136600087e1885 and CommandCenter6ac1d3252ff8490008b4d903 ready at sameSHA. PR97 remains draft.
- Real browser saved request LMN-67359F673F0344D6BD0FE3A122119D6B, explicitly requested hold and displayed validated temporary expiry. Database confirms correct tenant/service/date, draft state, exactly one active hold and zero payments. Hosted API retry returned identical hold; forged tenant400, missing bearer401, forged payment400, unsupported legacy payment422 and confirm without payment422.
- Screenshot/customer-hold-6e4a8dd.png and secret-free machine batch evidence saved under workspace outputs. Initial connected form had no horizontal overflow at320/375/390/430/768/1280; viewport reset. This is partial request/hold acceptance, not paid booking/confirmation/Portal golden flow. Scores remain overall35/Portal40/Staging45.
- Next active implementation ownership: API builder/customer_hold_builder owns explicit paid-simpleV3 SQL/API/workflow schema; UI builder/customer_availability_ui_builder owns matching session union/client/HostedFlow and tests. Preserve legacyV1/V2 request semantics, server catalog price and existing confirm_succeeded_payment writer. Owner Portal acceptance still needs a controlled authenticated browser session.

Paid V3 and connected booking detail implementation:
- API builder /root/customer_hold_builder 4df257a integrated as7da23e0. Independent /root/booking_list_review accepted bounded create-only owner publication, server-priced immutable V3 snapshot, exact origin/session provenance and existing confirmation authority. Root full API108/108 including startup, workflow87/87, API typecheck PASS. Fresh local0001..0037 replay, paid SQL attacks and real HTTP/Postgres publication/request/hold/serverUSD12500 simulated payment/consumed confirmation/replays/catalog drift/observed-lock session-expiry rollback PASS.
- Root builder /root owns connected booking detail cell5d6af5a. Reviewer /root/booking_list_review caught separate rental deposit inequality and actual staging_mock label; both fixed with regressions and final review accepted. Runtime-client32/32, full Portal94/94, final focused detail3/3, runtime-client/Portal typechecks and Portal staging build PASS. Authenticated tenant+booking query validates embedded customer/payment/history; stale business/route responses cannot render. Unknown pricing remains unpriced; no invented refund/balance.
- CI adds paid publication SQL attacks and guarded dedicated fresh lumin_phase_a_paid_ci HTTP journey. Migration0037 applied only isolated hqgtjztrsizjrsidtlqt. Parent/live DB unchanged. UI paid V3 cell remains active; remote CI/deploy and hosted positive flow pending. Overall35/Portal40/Staging45 unchanged; authenticated owner Portal acceptance remains unverified.
- Paid UI builder /root/customer_availability_ui_builder9e4b291 integrated2a258f8; independent /root/booking_list_review accepted strict V3 rendering, explicit request/hold/testpayment, actual versioned receipt binding and ambiguity-preserving replay. Root flow-ui/Checkout typechecks and full Checkout62/62 PASS. Initial root sandbox esbuild startup denied; authorized filesystem rerun passes. Controlled paid HOUSEKEEPING installation cc1f999f-12d7-4380-9578-d8ef3679a52a/version cfdfb1be-7bfa-40dc-89cb-0a69e5e6838f created through isolated staging SQL as test fixture, not authenticated browser publication proof.

05ea7f3 hosted paid-customer batch acceptance:
- Authoritative remote05ea7f39c4966d2b04e8e9becd2377494f3ddee9; exactCI37178039724 SUCCESS, verify and database jobs including fullmigration/SQLattack/customerexpiry/newpaidHTTPjourney green. PR97 OPEN/DRAFT. Render dep-db0tm6favr4c7399ummg LIVE matchingSHA; health200/ready200. Canonical Checkout6ac1da82f081bb0008751b83, Portal6ac1da82053f340008147ca5, CommandCenter6ac1da827ce89e00091cf2e4 ready at sameSHA.
- Real hosted customer API journey created confirmed bookingc5c92e26-2ec9-48ef-a76d-c37dce7a1694, USD12500 serverprice, exactlyone simulatedpayment and consumedhold. Paymentreplay/confirmationreplay returned samebooking/payment; forgedamount400, missingbearer401, foreignorigin403. Database confirms correctHOUSEKEEPINGtenant/service and draft→pending_payment→confirmed activity.
- Real Chrome journey independently created LMN-C5B9FB62BD3D4979AB9D2CD0528D7B86, selectedOct7 09:00America/Los_Angeles, explicitly reserved, explicitly made stagingtestpayment, displayed Test booking confirmed with pinned$125.00/simulatedlabel. DB confirms bookingc5b9fb62-bd3d-4979-ab9d-2cd0528d7b86 correcttenant/service/slot, oneUSD12500succeeded staging_mockpayment, oneconsumedhold, threeactivitystates. No realmoney/providers.
- Saved screenshot outputs/housekeeping-paid-confirmation-05ea7f3.png and secretfree customer-paid-hosted-evidence.json; confirmation screen nooverflow320/375/390/430/768/1280 andviewportreset. This does not certify fullresponsivecheckout/embedmatrix or authenticatedownerPortalvisibility. Portaldetail directroute loads signin instead404; controlledownerlogin still unavailable; fullGoal1 NOTCERTIFIED.
- Evidence-supported partialscores Booking55(previous45), Staging55(previous45), Portal40unchanged, Overall35unchanged pendingowneroperability. Otherbaselinesunchanged; no90+claim.
- Nextalreadyactive boundedGoal2 UIcell /root/customer_availability_ui_builder owns authenticatedconnectedowner paidpublication/receipt/installpanel and privateauthbridge; securitycell /root/customer_hold_builder owns dependency-onlyupgrades/fullverification. Audit8findings7moderate1high(Vite devserver), noforcefix; productionsecurityreleasegate unresolved.

Hosted service capacity and simulated-payment concurrency:
- Root isolated builder cell codex/hosted-customer-concurrency f6477e6 owns scripts/customer-paid-concurrency.mjs/test.mjs plus offline CI step. /root/booking_list_review independently source-accepted; six safety regression tests PASS. Exact canonical staging target/origin, explicit mutation opt-in, two contenders only, future availability window<=one day, bounded JSON/timeout/no bearer output and no automatic ambiguous mutation replay.
- Actual hosted execution against Render05ea7f3 onOct9 16:00UTC service slot: one winner41096a34-848e-4414-bb22-0678a1941496 and one capacity-denied loser65d1eeeb-2a87-4a5e-95d6-1128238b7709. Two simultaneous winner mock-payment calls returned one paymentIdaaedbc61-6c39-4e21-9f7f-460874a406cc with exactly one initial result/one replay. Loser payment denied.
- Separate isolatedDB read confirms winnerconfirmed/USD12500/one succeeded staging_mockpayment/one consumedhold; loser remainsdraft/unpriced/no linkedpayment/no paymentrow/no holdrow. This certifies service-slot capacity and simulated payment concurrency, not rental/worker races or authenticated owner Portal acceptance. Scores retained Booking55/Staging55/overall35.
- Exact71268f95d1a60b9bd73fcb8da0d7faa1e93e3e2e CI37178834070 SUCCESS. Render dep-db0tu72d0e5s73d6ldgg LIVE sameSHA, health200/ready200. NetlifyCheckout6ac1de5ec882a50008ed8d01, Portal6ac1de5f45b9970008bc680e, CommandCenter6ac1de5ee88c90000840a684 ready sameSHA. Exactdeployedcandidate hostedrace rerunOct10 16UTC PASS: winnera1cdf92c-32e9-41f2-9ed1-78006673713a, loserd4cc2f28-6160-4716-a14e-c843b919f6ce, paymenta9913742-d41d-4bbb-81ad-d25d9d3b68ff oneID/two concurrentcalls. DB confirms winnerconfirmed/onepayment/oneconsumedhold, loser draft/unpriced/zero payments/zero holds. Secret-free machine evidence outputs/customer-concurrency-71268f9.json. OwnerPortal remains signedout; currentcontrolledlogin unavailable. ActiveOwnerPublisher and dependencyhardening cells continue; zeroaudit in uncommitteddependencycell not yetreleaseevidence.

### Reviewed dependency hardening — staging candidate

- Builder: /root/customer_hold_builder; independent reviewer: /root/booking_list_review. Builder commit f946f27b2630e26120b60158fce29f94c2abbcab integrated as 6d50ba6.
- Only dependency manifests and lockfile changed. Vite 6.4.3, Vitest 4.1.11, React Router 7.18.4, React plugin 4.7.0, esbuild 0.25.12. React 18 retained.
- Fresh installation, full and production audits: zero vulnerabilities. Builder verified all workspace type checks, 1,218 tests across 20 workspaces, all three frontend builds and API startup regression. Reviewer independently confirmed audit, lock integrity and Node 20 package compatibility. Exact Node 20 execution remains a CI gate.
- No production, LeadGate, database, payment authority, credentials or service configuration changes. Scores unchanged until hosted verification. PR #97 remains draft.

### Connected owner publication panel — reviewed integration

- Builder /root/customer_availability_ui_builder: 009d72980f6de4ab421f9e8239fe66fb1e46e265; independent reviewer /root/booking_list_review accepted bounded source with no actionable findings. Integrated as e064483.
- Changed RuntimeClient private authenticated publication transport/state and Portal canonical /embed panel/wiring with seven source/test files. Explicit staging owner action, fixed canonical Checkout origin, strict immutable publication receipt, session/tenant generation guards, unknown delivery lock, and iframe/direct URL output. No automatic publication retry or recovery claim.
- Integrated upgraded candidate verification: RuntimeClient 40/40 and Portal 102/102 tests, both typechecks and Portal production build PASS. Root API dependency regression 108/108 PASS; all workspace typechecks PASS. Full npm audit: zero findings.
- Prior dependency candidate a3d44cc14733c38e2710527c15be3835e5b03c77 CI 37179558111 SUCCESS (verify + database). Render dep-db0u58k9v7es73d1k5kg LIVE same SHA, health/ready both 200. Canonical Netlify Checkout 6ac1e1de7ce89e00091dc96e, Portal 6ac1e1deb2199f0008988a16, Command Center 6ac1e1de5aff3000087de84e READY same SHA. Real Chrome Checkout loads pinned Housekeeping USD125.00 simulated form; Portal /embed direct URL loads connected staging sign-in without 404.
- New owner panel hosted authenticated publish acceptance remains NOT CERTIFIED: controlled staging owner sign-in is unavailable. Next API/UI cells implement explicit read-only receipt recovery. Goal 1/2 not complete; overall 35, Booking 55, Portal 40, Staging 55 retained. PR #97 stays draft; production and LeadGate untouched.

### Read-only paid publication recovery — implementation and review

- Builder /root/customer_hold_builder 35190f2e4fb6eb835bead3b35bf91f5b4604ca51 integrated as 5bdc361. Root isolated CI cell 245dcaf3e0fe4b3f59e03b154e5daabbd3de4dba integrated as 05342aa. Independent reviewer /root/booking_list_review accepted both source scopes; reviewer sandbox prevented an independent test execution and that is not counted as a pass.
- GET /api/paid-simple-flows/:flowId/publication reads only the existing immutable paid V3 receipt. Fresh owner authentication, exact origin, active tenant/current owner membership/current published version and exactly one installation remain required. SQL runs in a read-only transaction, with no writer, capability creation or financial transition.
- Missing evidence returns NOT_AVAILABLE and grants no permission to replay publication. Fresh local Postgres proved absence during an uncommitted publication and receipt recovery after commit. Cross-tenant, staff, revoked/suspended/archived/legacy and ambiguous bindings fail closed; repeated reads leave customer and financial tables empty.
- Root integrated candidate full API 134/134 tests and API typecheck PASS. Dedicated CI step replays fresh recovery database through all active migrations then runs real HTTP/Postgres recovery integration. UI explicit recovery cell is already in progress.
- Previous owner publisher candidate 2b6ce4863b55abefd81d09388446f61f9bc46414: CI 37179891488 SUCCESS; Render dep-db0u8d2d0e5s73d7tgn0 LIVE exact SHA with health200/ready200. Netlify Checkout 6ac1e382a401ef0008d83fb2, Portal 6ac1e382b2199f00089895e4, Command Center 6ac1e382eca7930008eb5290 READY exact SHA. Real Chrome all five Portal primary direct routes and refresh reach connected staging sign-in without 404. Authenticated owner publication/detail still not certified.
- Scores unchanged; production, parent Supabase and LeadGate untouched. PR #97 remains draft.

### Explicit owner receipt recovery UI — reviewed integration

- Builder /root/customer_availability_ui_builder amended b78717332d36585b2f32eb168932a6cabc238709 after independent reviewer /root/booking_list_review found garbled display text in a7e2cb8. ASCII repair was re-reviewed and accepted; integrated as 1f70b56. Four RuntimeClient/Portal source/test files changed.
- Explicit known-attempt lookup after reload uses only the private authenticated read-only API. Same-business/attempt uncertainty persists on missing/network/malformed results and never unlocks publication. Current owner session and tenant guards prevent late receipt reuse; successful receipt restores the existing version/installation and shows a copyable non-secret attempt ID.
- Builder full RuntimeClient 47/47 and Portal 107/107, both typechecks and Portal build PASS. After repair targeted publisher11/client28 plus typechecks PASS. Root final integrated RuntimeClient 47/47 and publisher11/11 PASS. API remains previously verified134/134.
- Actual hosted customer regression on exact deployed 2b6ce48: Chrome availability -> request -> hold -> explicit simulated payment -> Test booking confirmed. Booking f1146524-e76a-4230-a698-c72e7a96e54c belongs to controlled tenant b48d0118-b82f-4ba3-9f32-0f2eedec2d73/service d37db6dc-d6bb-4512-b3e0-f0bd3c55fa1f, USD12500, Oct11 16:00-17:00UTC, one succeeded staging_mock payment4c2247c2-6427-47f1-9106-7d34dadbb896, one consumedhold, draft->pending_payment->confirmed activity. 390px confirmation screenshot outputs/housekeeping-paid-confirmation-mobile-2b6ce48.png; this proves confirmation layout only, not a full responsive/embed matrix.
- Recovery API candidate e982b59350b5db29cb6a0b6119b33ff08aa24f81 CI37180428987 SUCCESS including read-only recovery actual Postgres step. Render dep-db0udi8u01pc73c08nm0 LIVE same SHA, health/ready200, missing owner auth401 and foreignorigin403. Netlify Checkout6ac1e6141a24fd000829da7b/Portal6ac1e613ae1eef0008254678/CommandCenter6ac1e61363b2f500077b3fb8 READY sameSHA.
- Authenticated owner publication/recovery and Portal booking visibility remain NOT CERTIFIED, pending staging owner sign-in. Goal1/Goal2 remain incomplete; overall35/Booking55/Portal40/Staging55 retained. Other baselines unchanged. Next API/UI cells already started: read-only saved paid publication discovery; no draft/design/version rollback claim. Production/parentSupabase/LeadGate untouched; PR97 stays draft.

### Saved paid publication discovery API — reviewed integration

- Builder /root/customer_hold_builder e123ebe7f9adc5bc800792431e77c98ab1ef9e67 integrated as 4589aed; independent reviewer /root/booking_list_review source-accepted without actionable findings. Five API files only, no migrations or writer changes.
- Owner-authenticated staging GET /api/paid-simple-flows returns strict flow ID/name/current validated receipt, at most50 in deterministic order. Repeatable-read read-only SQL checks active tenant/current business owner in both queries; rejects ambiguous/missing bindings, malformed metadata and overflow51 instead of silently truncating. Authorized empty result grants no creation/retry authority.
- Builder focused50/fullAPI158/typecheck/fresh disposable DB replay and real HTTP/DB mixed-tenant, legacy, revoked/inactive, in-flight visibility and50/51tests PASS, with zero customer/financial writes. Root integrated fullAPI158/158 plus typecheck PASS. Existing CI recovery integration includes the new list tests. UI discovery cell is already building and testing.
- Previous exact candidate a9d170aaf79814f32c8c1777371d479a0704e335: CI37180993096 SUCCESS; Render dep-db0uj60u01pc73c0v9o0 LIVE with health200/ready200; Netlify Checkout6ac1e8ed9cb4f40008036df1, Portal6ac1e8ed6192b00008bba7da, CommandCenter6ac1e8ed82be5d00081a013c READY sameSHA.
- Isolated hqgtjztrsizjrsidtlqt public Auth settings read: signup enabled, email enabled, email auto-confirm false. Existing controlled owner password unavailable; no authenticated owner-browser certification and no automatic email-confirmation bypass. Owner Portal handoff remains open on confirmed test booking f1146524-e76a-4230-a698-c72e7a96e54c.
- Scores unchanged; Goal1 and Goal2 remain incomplete. PR97 remains draft. No production/LeadGate/parent-database change or real payment.

### Connected saved Booking Form discovery
- Builder: /root/customer_availability_ui_builder, source b1ce4483184c25c591e6cccb9374d4ccc61c3f3e; integrated as 984b13d.
- Independent reviewer: /root/booking_list_review; accepted without outstanding findings. Root performed integration/runtime gates.
- Changed runtime-client and Portal PaidSimplePublisher plus their tests: explicit bounded owner-only saved form refresh, fresh receipt verification on selection, session/tenant response guards, and preserved unknown-publication locks. Listing never authorizes a retry or invokes a publication writer.
- Builder verification: runtime-client 56/56, Portal 113/113, typechecks and Portal build passed. Root integration: runtime-client 56/56 and publisher 17/17 passed. API prior exact source 158/158 and typecheck passed; this batch does not change API code.
- Hosted owner usability remains uncertified pending controlled staging owner login. No score increase. Paid draft persistence is already in progress in /root/customer_hold_builder on codex/paid-simple-drafts.
- Candidate push, exact CI and hosted deployment evidence will be recorded after verification. Main, production, and LeadGate remain untouched.

### Exact candidate staging promotion 6552e9a
- Remote integration head and draft PR97 head: 6552e9a2699e8b9664701acca66ef46e554854db. PR remains OPEN/DRAFT; main untouched.
- GitHub CI37181847929 SUCCESS: repository typecheck/tests/build/contamination and database migration/RLS/domain suites, paid publication HTTP journey and owner recovery/discovery integration.
- Render booking-lumin-api-staging deploy dep-db0ur59srm7s73997dig LIVE at exact candidate SHA. Hosted health 200/status ok; ready 200/status ready. Owner saved-form list without JWT401; foreign origin403.
- Canonical Netlify exact SHA ready: Checkout6ac1ecf2e03dca000879868b, Portal6ac1ecf2e3a0220008c519f2, CommandCenter6ac1ecf2e92ca40008cf76ef.
- Runtime dependency audit: zero vulnerabilities. Isolated database hqgtjztrsizjrsidtlqt remains migration0037; no database migration in this batch.
- Browser refreshed connected staging Portal booking-detail deep link successfully to authorized sign-in gate; controlled owner password unavailable. Authenticated list/draft/Portal acceptance is NOT certified. Existing customer hosted test confirmation proof is recorded separately.
- Overall35, Portal40, Booking55, Staging55, Booking Form30, Production20 unchanged. Next cells active: /root/customer_hold_builder private draft persistence; /root/customer_availability_ui_builder draft owner controls with exclusive API/UI ownership. No LeadGate or production actions.

### Private owner draft persistence candidate
- Builder /root/customer_hold_builder source1e87c2948742284898aa6360af352528a57ca7d6; root integratedcd33d82. Independent reviewer /root/booking_list_review accepted exact source and root CI wiring, independently reproduced33focused tests.
- API GET/POST paid-simple-flows/:flowId/draft stores service/name/whitelisted presentation only. Fresh ownerJWT, active tenant/membership, exact origin and staging gate; strict fields and server service eligibility. Migration0038 dedicated forced-RLS table, no direct browser/service-role table grants, fixed security-definer RPCs with owner recheck. Revision comparison rejects stale and concurrent losers. No publishing/customer/payment writes.
- Builder191API tests, typecheck,39SQLfile fresh replay,26SQLsecurity suites, actual local HTTP persistence/conflict/concurrency/tenant/role/eligibility tests passed. Root integrated191/191 andtypecheck passed; root CI adds SQL suite and dedicated fresh-database actualHTTP integration.
- Runtime Guardian: financial/booking/tenant authority preserved. Release Governor permits exact CI then additive isolated-staging migration and API staging deployment only. Parent database and production prohibited.
- Draft UI /root/customer_availability_ui_builder remains in progress; saved draft is not a published/customer-visible design. Hosted owner acceptance unverified; no score increase.

### Draft API staging promotion 785351a
- Exact CI37182355072 SUCCESS at785351ac1d6186585392229a48cd74fb00444163, including dedicated draftSQL and actualHTTP/concurrent-revision integration.
- Additive0038 paid_simple_drafts applied ONLY isolated development branchbooking-lumin-staging / hqgtjztrsizjrsidtlqt, parentpplwyfbxrnodimhzlvdl read-only branchidentity inspection. Branch metadata ACTIVE_HEALTHY/with_datafalse.
- Hosted catalog: RLSenabled/forced true; anon/authenticated/service_role directtableaccess false; onlyservice_role RPCexecution true. Transactional hostedRPC save/read/update/stale/forgedowner checks passed; rollbackleft0draftrows. This is hostedSQLproof, not authenticated browserAPIcertification.
- Renderdep-db0v0mou01pc73c2ma80LIVE exact785351a, health200ok/ready200ready; hosted draftGETmissingJWT401/foreignorigin403.
- Netlify exact785ready: Checkout6ac1ef623913cd0008c47a6d, Portal6ac1ef625b191500082f2c0a, CommandCenter6ac1ef623a83170008c2a253.
- OwnerUIcell still inprogress; ownerlogin gate persists. Scoresunchanged. Next explicitdraftpublicationAPI /root/customer_hold_builder and rootisolated customer-draft-renderer-cell ownedcheckoutfiles; UIbuilder retains runtime-client/Portal only.

### Immutable published presentation renderer
- Sharedschema builder /root/customer_hold_builder exact1b0c5c8, independentlyreviewed /root/booking_list_review with99workflowtestsPASS; rootintegrated1e31ccd.
- Renderer builder /root in isolatedcustomer-draft-renderer-cell exactc60b36849a914c77c53ff5d69a077f1a4a2b3891; independentreviewer /root/booking_list_review acceptedexact3filediff and29HostedFlowtestsPASS. Rootfullcheckout64/64, typecheck, build, diffcheckPASS.
- Optional strict immutablepublicationmetadata accepts boundedname,5safeaccentcolors,2layouts, safepositive draftrevision; oldV3 remainscompatible. Customer form uses only validatedpublishedmetadata and displays actualservice/price; escapedtitle/CSSURLrejection tested. Responsivecheckout-root wrapper restores centereddesktopcard. Financial/hold/paymentpaths unchanged.
- Saved-draft publishRPC is separate nextcell, not yet deployed. OwnerdraftUI remountP2 returnedto builder forfix/tests beforeintegration. No useracceptance/scoreincrease claimed from localrenderer tests.
