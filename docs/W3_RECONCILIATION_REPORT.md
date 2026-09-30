# W3 Reconciliation Report

**Status:** `IN PROGRESS` (documentation and source reconciliation only)
**As of:** 2026-09-26
**Authority:** protected `main` at `c5663c59e134e71beb511f509b3287ab0046bdff`

## Scope

This report reconciles the bounded W3 service-template/adoption recovery candidate against the protected repository baseline and the Phase A runtime-reconciliation requirements. It does not promote a branch, migrate a hosted database, deploy a service, or activate a provider.

## Candidate disposition

| Candidate | Exact evidence | Disposition |
|---|---|---|
| `codex/main-template-adoption-api-intent-recovery-v2` | `294aa0a35e77bdcca3b8f2209d01f37e885dfe2`; parent `6013923d03e5d9d61d06ae77a4484432d37d1d1e` (PR96/SQL0034 review stack) | `BRANCH_ONLY` / review hold |
| SQL migration 0034 | Present in the candidate branch ancestry, absent from protected `main` and live Supabase snapshot | `DO NOT PROMOTE` |
| Phase A documentation branch | `codex/phase-a-recovery-reconciliation-main` at the remote branch head verified after this push | `BRANCH_ONLY` / docs candidate |

The GitHub connector can read these refs and push branches, but draft pull-request creation returns `422 must be a collaborator`. Therefore there is no exact-candidate PR, CI run, integration-gate result, or Release Governor approval for either candidate.

## File-level classification for the W3 API intent candidate

The candidate's application change is bounded to the service-template adoption recovery surface and its tests. It is reusable only after the protected baseline, database contract, HTTP contract, and hosted staging environment are reconciled.

| Area | Classification | Required evidence before reuse |
|---|---|---|
| Service-template adoption repository/intent logic | `REUSE AFTER PORT` | exact PR diff, migration replay on isolated staging, tenant/RLS tests, API contract review |
| SQL migration 0034 | `NEEDS PORT / SEQUENCING` | ordered replay from the live baseline into a disposable staging project; no live apply in Phase A |
| API error mapping and changed-state behavior | `NEEDS REVIEW` | focused HTTP tests plus a staging request/response trace; previous candidate had a generic-error defect that was corrected locally |
| Tests and fixtures | `REUSE AS REVIEW INPUT` | independent rerun against the exact candidate tree; local disposable Postgres is not hosted certification |
| Render/Netlify wiring | `NOT PRESENT / UNVERIFIED` | authoritative service/site identity, commit, environment, and API target |

## Baseline comparison

The protected `main` API entrypoint is the R2a foundation in `apps/api/src/main.ts`. Its source comment explicitly states that it exposes health/readiness and existing owner/customer flow routes, adds no booking-confirm path, and writes no `state='confirmed'`. `apps/api/src/http.ts` exposes authenticated tenant-scoped flow, roster, service, and publication routes. The payment-authoritative confirmation implementation is present as a repository/core contract (`packages/core/src/booking.ts`) and provider-adapter/test surface, but its hosted deployment and single writer have not been certified.

The live Supabase snapshot is older than the repository candidate: live migrations were observed at `0001`–`0009`, while the candidate stack includes later migrations through SQL0034. No live migration was applied during this reconciliation.

## Gate disposition

- **Reuse:** bounded source and test ideas may be reused after exact-tree review.
- **Move:** migration and API intent work must move through the protected/main review stack and an isolated staging replay.
- **Build:** no new W3 feature work is authorized in Phase A.
- **Defer:** hosted deployment, live migration, provider activation, and any production traffic change.

## Next dependency

The next safe dependency is an isolated staging database replay and certification. After that, identify the authoritative Render API service and Netlify sites before any frontend connection is attempted.
