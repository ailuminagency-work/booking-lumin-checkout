# Decision Ledger

| ID | Date | Decision | Rationale |
|----|------|----------|-----------|
| D-001 | 2026-09-01 | Clean-room rebuild against contracts; zero artifacts copied from `embed-checkout`. | Repo/Supabase access unavailable at kickoff; clean-room also satisfies the contamination policy by construction. Proven *concepts* (idempotency, server pricing, fail-closed availability) are re-specified in contracts, not copied. |
| D-002 | 2026-09-01 | npm workspaces monorepo; packages export TS source (`main: src/index.ts`). | Single install, no build orchestration between packages; Vite/tsc/vitest consume TS directly. |
| D-003 | 2026-09-01 | Money as integer minor units + explicit ISO-4217 currency; multipliers as basis points. | No float money anywhere; integer-only pricing math. |
| D-004 | 2026-09-01 | Four service archetypes are flow presets over shared primitives (items/add-ons/questions/rental), one engine. | Generalization requirement; proofs must show junk removal, detailing, cleaning on one core. |
| D-005 | 2026-09-01 | Engines pure & clock-free (`now` injected). | Determinism, testability of races/lead-times. |
| D-006 | 2026-09-01 | Database RLS is the tenant-isolation boundary; app checks are UX only. | SI-4; forged-tenant attacks must die at the DB. |
| D-007 | 2026-09-01 | Mock-first adapters; every integration starts `not_connected`; real providers post-gates. | SI-12/SI-13; no credentials exist in dev. |
| D-008 | 2026-09-01 | Supabase (Postgres) as target persistence; migrations authored as SQL artifacts in-repo, applied only to a NEW project, never the legacy one. | Preserves proven platform choice without inheriting the legacy project's trust. |
| D-009 | 2026-09-01 | Legal booking transitions declared once (`BOOKING_TRANSITIONS`) and enforced in engine + DB trigger. | SI-2 single source of truth. |
| D-010 | 2026-09-01 | Command Center reads aggregates only; GMV and platform revenue are separate metrics end-to-end. | Program requirement; PII minimization. |

Breaking contract changes append a decision here and bump the contract version.
