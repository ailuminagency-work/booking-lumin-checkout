VERDICT: APPROVE

# Independent Review — PR #79 (R1b service-slot overbooking backstop)

**Reviewer:** Fresh, independent reviewer (did not author or repair this PR).
**Repo:** ailuminagency-work/booking-lumin-checkout
**PR branch:** fix/r1b-service-slot-backstop — HEAD verified at `d64a962` (commit: "fix(r1b): structural service-slot overbooking backstop (P0 OB-STRUCT, 0033)").
**Environment:** PostgreSQL 16.15, fresh disposable DB `lumin_test`, `local_harness.sql` + migrations `0001..0033` applied in order. All suites executed for real (not a static-only review).

## Summary

PR #79 adds migration `0033_service_slot_overbooking_backstop.sql`, the test `supabase/tests/service_slot_backstop_tests.sql`, and one CI change. It adds `services.capacity_limited boolean not null default false` and a `BEFORE INSERT/UPDATE` trigger `lumin.enforce_confirmed_requires_hold` on `public.bookings` that, only at the transition **into** `state='confirmed'` and only for a `capacity_limited` service, requires a **CONSUMED** `capacity_hold` for the booking (else raises P0001 `CONFIRMED_WITHOUT_CAPACITY_HOLD`). This is the service-slot counterpart to 0031's resource-half EXCLUDE, and it is exactly the design 0031's foot-NOTE deferred to R1b (service-level `capacity_limited` flag + consumed-hold requirement gated on it). The default-false marker is what makes it non-breaking: pre-existing services/bookings are exempt, so the existing corpus the 0031 NOTE worried about is untouched.

The structural chain holds: `confirmed ⇒ consumed hold` (0033 trigger) ⇒ `went through lumin.consume_hold` (0010, definer-only) ⇒ `went through lumin.reserve_capacity` ⇒ `≤ capacity consumers` under a per-(tenant,service,slot) advisory lock. A rogue direct insert of a confirmed booking, or an authenticated portal flip `pending_payment→confirmed`, with no consumed hold is rejected — for any writer/role.

## Evidence (per required item)

1. **Migrations 0001–0033 apply cleanly** — PASS. Harness + all 33 migrations applied with `ON_ERROR_STOP=1`, no ERROR/FATAL.

2. **service_slot_backstop_tests.sql** — PASS. Output ends `ALL SERVICE-SLOT BACKSTOP TESTS PASSED`; all 17 PASS notices (T1–T7), zero FAIL, exit 0.

3. **rls_attack_tests.sql** — PASS. `=== ALL RLS ATTACK TESTS PASSED ===`, 0 FAIL, exit 0.

4. **Every CI "domain security suites" entry** — PASS. Ran all 22 suites in the ci.yml loop (platform_financial_minimization_tests, capacity_tests, resource_rls_tests, resource_tenant_integrity_tests, resource_quantity_tests, overbooking_backstop_tests, service_slot_backstop_tests, worker_roster_tests, owner_roster_snapshot_tests, planning_policy_tests, carrier_direct_write_tests, group_lifecycle_tests, group_financial_boundary_tests, planning_allocator_tests, crypto_extension_binding_tests, bound_flow_tests, configurable_flow_tests, flow_storage_tests, outbox_tests, mode_installations_tests, mode_flow_session_tests, business_profile_tests). Each exit 0, 0 FAIL. `platform_financial_minimization_tests` ends `platform financial minimization tests PASS`; `capacity_tests` ends `=== ALL CAPACITY TESTS PASSED ===`.

5. **Capacity-1 enforcement (my own SQL)** — PASS. On ONE shared capacity-1 `capacity_limited` slot: booking A `reserve_capacity=GRANTED` → consume → confirm OK; booking B `reserve_capacity=NO_CAPACITY`; rogue direct `UPDATE B → confirmed` rejected P0001; final `confirmed_count=1`. Exactly one confirmed booking survives.

6. **confirmed ⇒ own consumed hold (my own SQL, full matrix)** — PASS:
   - no hold → DENIED (P0001)
   - RELEASED hold → DENIED (P0001)
   - ACTIVE-not-consumed hold → DENIED (P0001)
   - ANOTHER booking's consumed hold → DENIED (P0001)
   - **authenticated** portal-role flip `pending_payment→confirmed` without a hold → DENIED with **P0001** (ran under `SET ROLE authenticated` + jwt claims for a real tenant member; it raises the intended CONFIRMED_WITHOUT_CAPACITY_HOLD, **not** a 42501 permission error — confirming the SECURITY DEFINER trigger reads `public.capacity_holds` as owner despite authenticated having no grant on it per 0024)
   - legitimate reserve → consume → confirm → SUCCEEDS

7. **Non-breaking / default-false** — PASS. T4 proves an unmarked (`capacity_limited=false`) service accepts a direct confirmed insert with no hold (exempt). The entire pre-existing suite corpus — including rls_attack and platform_financial_minimization, which insert confirmed bookings directly with no hold — passes unchanged. The trigger fires only on the transition INTO confirmed: already-confirmed rows and transitions OUT of confirmed (completed/cancelled/refunded) are untouched (T6 grandfathering passes; notes-only / re-save UPDATEs on an already-confirmed row short-circuit via `old.state is not distinct from 'confirmed'`). No legal transition is wrongly blocked. The new NOT NULL column with a constant default is a fast metadata-only add on Postgres 16.

8. **Scope** — PASS. `git diff 62bd97a..d64a962 --name-status` (parent 62bd97a IS `feat/r3-business-profile`, "feat(r3): one-tenant-one-profile…") shows exactly:
   - `M .github/workflows/ci.yml` (apply-step comment 0032→0033; adds `service_slot_backstop_tests` to the suite loop)
   - `A supabase/migrations/0033_service_slot_overbooking_backstop.sql`
   - `A supabase/tests/service_slot_backstop_tests.sql`
   No edits to 0001–0032. No existing grant/policy/RPC changes — the only `revoke` in 0033 is on its own new function `lumin.enforce_confirmed_requires_hold()`; `capacity_holds` grants/RLS and all RPCs are untouched. No app/TS change.

## Design judgement vs 0031's deferral

0031's foot-NOTE deferred the service-slot half because a confirm-time hold requirement would regress existing suites and because "capacity-limited" is a property of availability, not a row flag. 0033 resolves both exactly as the NOTE proposed: an explicit operator-declared `capacity_limited` marker defaulting FALSE (so the existing corpus is exempt and passes unchanged) gating a CONSUMED-hold requirement. The SECURITY DEFINER + `search_path=''` choice is correct and necessary (a SECURITY INVOKER trigger would raise permission_denied for authenticated on capacity_holds instead of the intended rule). Text-comparison service resolution with tenant pinning is a sound defensive choice (malformed/absent serviceId fails open on the marker lookup only, and such a booking cannot target a capacity_limited service through reserve_capacity either, so it is not a bypass). No fixture backfill is needed because pre-existing confirmed rows are never retro-checked.

## Minor, non-blocking observations (not defects)

- The task brief said "one ci.yml line"; the actual ci.yml diff touches two lines (a cosmetic apply-step comment rename plus the new suite in the loop). Both are benign and in-scope; the migration apply glob is `0*.sql` regardless of the comment text.
- Verified on Postgres 16 (the only cluster available here); the migration header targets Postgres 15/16 Supabase and applied cleanly.

## Conclusion

The backstop is correct, structurally sound, caller/role-independent, and backward-compatible. All eight verification items pass with executed evidence, including independent capacity-1 and authenticated-role proofs. **APPROVE.**
