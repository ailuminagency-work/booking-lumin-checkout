# RC-1 Acceptance Report — Booking Lumin Checkout

**Mode:** Independent Acceptance. **Source of truth:** GitHub `main` (reviewed at `286e606`;
remediation merged at `8682318`). **Reviewers:** four independent agents, none of whom built
RC-1, each tasked to *disprove* claims and reproduce any defect. No implementation was changed
except to remediate independently-reproduced defects (merged via PR #3).

## Verdicts per major claim

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Clean clone install / build / test | PASS | install clean; typecheck 0; 107 tests; 3 apps build |
| 2 | 107 tests & honest coverage | PASS | exact 107; hand-computed assertions; no tautologies / skips / hidden excludes |
| 3 | Contamination (independent of repo script) | PASS | only `Bison` hit is the ledger doc; PII on reserved domains/555; no real secrets |
| 4 | Git history for secrets / legacy identifiers | PASS | all commits/blobs scanned; nothing leaked, nothing scrubbed |
| 5 | Architecture boundaries | PASS | import matrix clean & acyclic; contracts depend on nothing internal; engines pure |
| 6 | No vertical-specific logic in core | PASS | zero vertical branches; conditionals key only on `archetype`; 3 proofs, one engine |
| 7 | Server-authoritative pricing | PASS | smuggled price fields ignored; UI reprices; negative/overflow rejected |
| 8 | Successful-payment required before confirmation | PASS | every bypass (pre/failed/bogus/foreign intent, app glue) refused |
| 9 | Idempotency & payment replay protection | PASS | 25-way same-key race → 1 booking; keyed HMAC webhook; replay rejected; D5 recovery |
| 10 | Tenant propagation & authorization | PASS | cross-tenant R/W = 0 rows; forged-tenant write denied 42501; platform≠tenant (SI-9) |
| 11 | Service-role usage / financial guard | PASS | members can't INSERT/reprice bookings; secrets service_role-only; legal transitions work |
| 12 | Command-center PII exposure | PASS (+RISK-2) | views aggregate-only, invoker, 0 rows to non-admins; GMV≠revenue |
| 13 | Browser/server trust boundaries | PASS | no node:crypto/secrets/service_role in any built bundle; clientToken non-secret |
| 14 | Migration correctness | PASS | 8 migrations apply clean in order; all tables RLS enabled AND forced |
| 15 | Overengineering / unnecessary tables | FAIL → fixed | 3 unwired tables deferred in PR #3; re-verified 25/25 attack suite, 27 tables |

**UNVERIFIED:** none — every claim was reachable and adjudicated with executed evidence.

## RISKs (documented; not exploitable in RC-1)

- **RISK-1** — Engine `transition()` and portal `transitionBooking` structurally permit
  `pending_payment→confirmed` with no payment check (legal per `BOOKING_TRANSITIONS`,
  unreachable from any untrusted path today). **RECOMMENDATION:** forbid `→confirmed` via the
  generic transition so a future caller cannot reintroduce a free-confirm hole.
- **RISK-2** — Platform-admin can read raw `customers`/`bookings` via base-table RLS (the
  SECURITY INVOKER aggregate views require it). Wider than "aggregate-only." **RECOMMENDATION:**
  redesign as SECURITY DEFINER views + revoke admin base-table SELECT — best done against the
  real runtime in RC-2.
- **RISK-3** (environment, not a repo defect) — dev-only `npm audit`: 1 high + 3 moderate, all
  transitive (esbuild dev-server, react-router). **RECOMMENDATION:** address at a deliberate
  dependency bump, not RC-1.

## Defects → remediation (PR #3, all reproduced, all re-verified)

| ID | Sev | Defect | Resolution |
|----|-----|--------|-----------|
| DEF-1 | FAIL | `resources`/`locations`/`service_areas` unwired (no reader/writer/FK/contract/view) | Moved to `supabase/migrations/_deferred/`; removed from applied set (27 tables); attack suite 25/25 |
| DEF-2 | minor | `@lumin/core`/`@lumin/adapters` declared but unused in portal & command-center | Removed |
| DEF-3 | minor | Literal NUL byte as idempotency map-key separator (file classified binary) | `JSON.stringify([tenantId, idempotencyKey])` — collision-proof, plain text |

## Decision

**RC-1 ACCEPTED.** All 14 substantive claims PASS on independent verification; the single FAIL is
remediated and re-proven (independently reviewed, merged via PR #3); the 3 RISKs are documented and
non-blocking. Next milestone: **RC-2 — Clean Supabase Runtime** (see `RC2_PLAN.md`).
