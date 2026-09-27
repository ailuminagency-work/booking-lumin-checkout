# Staging Database Certification

**Status:** `NOT STARTED` / `BLOCKED`
**As of:** 2026-09-26
**Promotion status:** no live migration or hosted write performed

## Current evidence

The only verified hosted database snapshot is the live Supabase project recorded in `docs/RECOVERY_STATUS_AFTER_OUTAGE.md`: migrations `0001`–`0009` were present at that point-in-time observation. The repository contains migrations through `0031`; the W3 review stack contains SQL0034. No isolated staging Supabase project has been provisioned or certified, so there is no staging URL, migration ledger, RLS result, or golden-flow result to mark as verified.

## Required replay

The staging owner must replay the migrations sequentially from the chosen baseline, recording the exact commit and migration checksums. The replay must run on an isolated project and must not use the live project as a test target.

Required checks:

1. Migration replay from the selected baseline, including extension and trigger checks.
2. RLS attack suites for tenant isolation and role boundaries (`supabase/tests/rls_attack_tests.sql` and the applicable resource, worker, flow, capacity, and financial suites).
3. Capacity, resource, worker, and overbooking concurrency harnesses (`supabase/tests/capacity_concurrency_harness.sh` and the related SQL tests).
4. Flow publication/session/request tests, including the `unconfirmed_request` boundary.
5. Application typecheck, unit tests, and integration tests against the exact candidate tree.
6. Auth denial tests for missing, malformed, expired, cross-tenant, and insufficient-role identities.
7. A reproducible evidence bundle containing project reference, commit, migration list, test commands, timestamps, and redacted results.

## Promotion gate

`STAGING_VERIFIED` requires the full replay and independent review. Until then, the database status remains `NOT_STARTED`/`BLOCKED`; no migration may be applied to live Supabase and no frontend or provider can be connected on the assumption that schema parity exists.

## Blockers

- No staging project has been verified in the current recovery pass.
- Live schema drift exists between the observed hosted baseline and repository/review branches.
- Supabase credentials and project mutation authority are not to be inferred from read-only inventory.
