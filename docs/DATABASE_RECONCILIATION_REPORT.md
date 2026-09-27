# Database Reconciliation Report

**As of:** 2026-09-26
**Live project:** `pplwyfbxrnodimhzlvdl` (Supabase, ACTIVE_HEALTHY, us-east-1)

The live range, health, inventory counts, and empty Edge Function inventory are from the read-only Supabase connector snapshot recorded in `docs/RECOVERY_STATUS_AFTER_OUTAGE.md` on 2026-09-26. They are point-in-time observations, not a substitute for a fresh staging replay or current hosted authorization.

## Migration ranges

| Environment | Observed range | Status |
|---|---:|---|
| Protected `main` tree | 0001-0031 | Current accepted repository baseline. |
| W3 SQL intent candidate | 0034 staged on PR96 branch | Review-only; not on main. |
| Live Supabase | 0001-0009 | Confirmed older generation. |
| Verified staging database | None | Not yet provisioned and certified. |

## Drift

**DRIFT: YES.** Live is nine migrations behind the accepted repository baseline. The live database has two active tenants, five auth users, two services, three customers, four bookings, two payments, two mock payment connections, and no calendar/notification/webhook secret rows. Live Edge Functions list is empty.

## Required reconciliation sequence

1. Provision a disposable or staging database under the authorized environment.
2. Apply repository migrations sequentially from a clean state.
3. Run migration checks, RLS/tenant attack suites, booking/capacity/concurrency suites, and relevant API tests.
4. Compare schema, function definitions, policies, and extension state to the exact repository candidate.
5. Record failures and corrections in this report.
6. Obtain separate promotion approval before any hosted migration. No live migration is authorized by this report.

## Current readiness

**NOT READY FOR LIVE PROMOTION.** No hosted data has been modified. The exact W3 API candidate includes SQL0034 only on its review branch; it has not been applied to Supabase.
