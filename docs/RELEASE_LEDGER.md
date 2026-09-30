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
