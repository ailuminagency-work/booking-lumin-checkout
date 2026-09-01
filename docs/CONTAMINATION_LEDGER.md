# Contamination Ledger

Owner: Security Governor (Workstream 2).
Classifications: KEEP · REFACTOR · REIMPLEMENT · DESTROY / DO NOT MIGRATE · UNKNOWN — INVESTIGATE.
UNKNOWN items may never be silently migrated.

Status note: direct read access to the legacy repo (`embed-checkout`) and its
Supabase project is currently unavailable from this environment. Entries below
are seeded from prior verified engagement knowledge and MUST be re-verified by
Workstream 1/2 forensics when access returns. Until then, the blanket policy is:
**nothing is migrated from the legacy environment at all** — the clean build is
written from scratch against contracts, which makes every DESTROY entry moot by
construction.

| Item | Class | Disposition |
|------|-------|-------------|
| Booking idempotency design (payment→booking uniqueness, crash-recovery re-issue) | REIMPLEMENT | Concept preserved in BookingContract v1; code rewritten clean. |
| Server-side price table & repricing pattern | REIMPLEMENT | Generalized into PricingEngine; no junk-removal price constants migrate. |
| Stripe webhook signature verification pattern | REIMPLEMENT | Behind PaymentProvider adapter; mock-first, no Stripe keys. |
| Supabase RLS approach | REFACTOR | Legacy had public-read `pending_bookings` (PII exposure, accepted risk then) — new schema is deny-by-default; that pattern is explicitly NOT carried. |
| Client business name/branding ("Bison…"), logos, colors | DESTROY / DO NOT MIGRATE | Branding is per-tenant config; ships empty. |
| Client phone / email / street address / domain / social links | DESTROY / DO NOT MIGRATE | None present in this repo (verified by grep at bootstrap). |
| Junk-removal service catalog, load sizes, price points | DESTROY / DO NOT MIGRATE | Vertical configs exist only as neutral test fixtures ("generalization proofs"). |
| Legacy Stripe account, live/test keys, webhook endpoints | DESTROY / DO NOT MIGRATE | New env has zero payment credentials; adapters mock-only. |
| Legacy Supabase project (schema, data, auth users, edge functions) | DESTROY / DO NOT MIGRATE (as trust) | Used read-only as reference when access returns; nothing restored/dumped into the new env. |
| Google/calendar/email/SMS credentials & OAuth grants | UNKNOWN — INVESTIGATE | Assume they exist in legacy env; forensics must inventory; none migrate regardless. |
| Legacy customer & booking data (incl. `pending_bookings` PII) | DESTROY / DO NOT MIGRATE | Stays in legacy env; deletion there is the legacy owner's decision. |
| Deployment relationships (Lovable/Netlify/domains) | UNKNOWN — INVESTIGATE | New platform deploys fresh; forensics to map legacy for decommissioning advice. |

Bootstrap verification (2026-09-01): `grep -riE 'bison|junk|hauling'` over this
repository returns only this ledger and neutral test fixtures. CI-able check:
`bash scripts/contamination-check.sh`.
