# Booking Lumin Checkout

Multi-tenant booking & checkout platform. Clean-room build: **zero inherited
customers, credentials, branding, or integrations** — see
`docs/CONTAMINATION_LEDGER.md` and `docs/SECURITY_INVARIANTS.md`.

## Surfaces

- `apps/checkout` — embeddable, mobile-first customer checkout (mock payments in dev)
- `apps/portal` — per-business portal (tenant-isolated)
- `apps/command-center` — Lumin platform operations (aggregates only)

## Packages

- `packages/contracts` — versioned shared contracts (types + zod). Source of truth.
- `packages/core` — pure domain engines: pricing, availability, booking state.
- `packages/adapters` — provider adapters; mocks only until security gates pass.
- `supabase/` — clean-room schema migrations + RLS attack tests (SQL artifacts;
  apply only to a fresh Supabase project, never a legacy one).

## Develop

```bash
npm install
npm run typecheck   # all workspaces
npm run test        # all workspaces
npm run build       # all apps
npm run dev -w @lumin/checkout        # or @lumin/portal / @lumin/command-center
bash scripts/contamination-check.sh   # legacy-identifier sweep
```

Governance: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DEPENDENCY_DAG.md`,
ledgers in `docs/`.
