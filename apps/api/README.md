# @lumin/api

The single **hostable API service** for Booking Lumin Checkout. This is the
application tier (`apps/`, not `packages/`): it owns the HTTP transport,
PostgreSQL access (`pg`), and real Supabase-JWT authentication. It composes the
framework-neutral flow BFF that was previously staged under
`packages/action-api/server/**` (codex `product-mode-document`), relocated here
unchanged in behavior.

`packages/**` stays pure and browser-safe — no `pg`, no `node:http`, no sockets.
The pure action dispatcher (`createActionApi`) remains at
`packages/action-api/src`; it is a contract layer and is **not** re-homed here.

## Entrypoints

| File | Script | Purpose |
| --- | --- | --- |
| `src/main.ts` | `npm start` | **PRODUCTION.** Real Supabase-JWT auth (`createSupabaseIdentityVerifier`), `pg` pool from `DATABASE_URL`, `/health` + `/ready`. Fails fast on missing config. |
| `src/local.ts` | `npm run dev` | **DEV HARNESS ONLY.** Synthetic `localIdentity`, loopback-only, disposable DB guard. **NEVER use in production.** |
| `src/seed.ts` | `npm run seed` | Seed synthetic local fixtures into a disposable local DB. |

`local.ts` uses a synthetic identity table and refuses to run outside a guarded,
disposable, loopback database. It is not, and must never be, the production
entrypoint. Only `src/main.ts` wires real authentication.

## Production entrypoint (`src/main.ts`)

- Authenticates every owner request with **`createSupabaseIdentityVerifier`**
  (validates the bearer JWT against `<SUPABASE_URL>/auth/v1/user`) — **not**
  `localIdentity`. Verified `userId` is handed to the flow BFF; SQL still
  re-checks current tenant membership under caller-scoped RLS.
- `GET /health` → `200 {"status":"ok"}` (no auth, no I/O).
- `GET /ready` → `200 {"status":"ready"}` after a bounded `select 1`, else
  `503 {"status":"unready"}` (no auth).
- All other routes are the pre-existing owner/customer flow routes, served
  behind a trusted platform proxy (`trustProxy: true`, since Render terminates
  TLS and the peer is non-loopback).
- **Fails fast** if any required config is missing; **no secret is ever logged**
  or sent to a browser.

### Required environment

| Variable | Secret? | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (role may `set role service_role`). |
| `SUPABASE_URL` | yes | `https://<project-ref>.supabase.co`. |
| `SUPABASE_ANON_KEY` | yes | Supabase anon/publishable key, used as the `apikey` for `/auth/v1/user`. |
| `OWNER_ORIGINS` | no | Comma-separated owner-console CORS origins. |
| `CUSTOMER_ORIGINS` | no | Comma-separated hosted-checkout CORS origins. |
| `PORT` | no | Listen port (default `8080`). |

> **Note on the auth secret name.** The relocated verifier authenticates by
> calling Supabase's `/auth/v1/user` endpoint with the project's anon/publishable
> key — it does **not** perform local HS256/JWKS verification, so there is no
> `SUPABASE_JWT_SECRET`. The required credential is `SUPABASE_ANON_KEY`.
> Likewise the flow BFF needs two distinct CORS allowlists, so the single
> `ALLOWED_ORIGINS` idea is split into `OWNER_ORIGINS` + `CUSTOMER_ORIGINS`.

## Deploy (Render)

`render.yaml` declares a web service and the secret **names only**
(`sync: false`) — no values. Creating the Render service and setting the secret
values is an **owner step** (Render dashboard or `render blueprint launch`). A
`Dockerfile` is also provided (build context = repository root). The service runs
`src/main.ts` via `tsx`.

## Tests

- `npm test` — fast, dependency-free **unit tests** (vitest). Covers the real
  Supabase identity verifier (config validation + token acceptance/rejection)
  with injected `fetch`/`now`; no Postgres, no network. Runs in CI.
- `npm run test:integration` — pg-backed **acceptance harnesses** (standalone
  `tsx` scripts, not vitest). Provisions a throwaway loopback DB, applies the
  local harness + migrations `0001-0031`, and runs the flow-BFF harnesses
  (`pg-http`, `roster-http`) that exercise the relocated production BFF. Requires
  a local Postgres; kept out of `npm test`.

The remaining harnesses (`mode-flow-session`, `mode-installations`,
`mode-installation-transport`, `mode-session-transport`, `mode-owner-journey`,
`planning-allocation`) each need their own disposable DB name pattern, crypto
layout, and raw-socket/backend-PID observation, so they are **deferred** — run
them manually with the env each fixture asserts.

## Boundaries

- No `packages/**` may gain server/IO code; the browser apps
  (checkout/portal/command-center) must not import `@lumin/api`.
- **Payment authority unchanged.** This service adds **no** booking-confirm path
  and writes no `state='confirmed'`. Everything remains `draft`/unconfirmed. The
  reserve→pay→confirm confirm authority is a separate follow-up (**R2b**).
