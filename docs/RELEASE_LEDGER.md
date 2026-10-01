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
