# @lumin/integrations

Provider-neutral **OAuth connect flow** + richer **calendar adapters** for
Booking Lumin Checkout. Mock-first (SI-12): every connection begins
**NOT CONNECTED** and the whole layer runs with **zero real credentials**. Real
Google / Microsoft adapters and real OAuth are a later, **gated** activation —
**READY, NOT CONNECTED**.

Additive only: depends solely on `@lumin/contracts` (+ `zod`). Touches no core,
adapter, contract, app, or Supabase code, and adds no migration — it reuses the
existing `calendar_connections` + `calendar_connection_secrets` tables from
migration `0006`.

## Connect with a button, not a pasted token

The preferred UX is **`[ Connect Google ]` / `[ Connect Microsoft ]`** — an
OAuth round-trip — **not** a form where a business user pastes an API token.

```
not_connected ──beginOAuth──▶ authorizing ──provider redirect──▶ callback_received
                                                         verifyCallback ─┐
                                                                         ├─▶ connected
                                                                         ├─▶ error
                                                                         └─▶ revoked
```

## Tokens are SERVER-ONLY

`TokenSet` (`accessToken` / `refreshToken` / `expiresAt` / `scope`) is exchanged
**on the server** and handed straight to a **`TokenVault`** — the real vault
writes ciphertext to the `calendar_connection_secrets` table, which is
`service_role`-only (no client policies, per `0006`/`0007`). Tokens never appear
in any browser-facing return.

`redactConnectionForClient(serverConnection)` is the **only** connection shape a
business user's browser receives. It is built from an **allowlist** — id,
tenant, kind, provider, status, coarse `health`, last check, last error — so no
token field can survive by construction. A test deep-scans the output and
asserts no `accessToken` / `refreshToken` / `tokens` anywhere.

## OAuth state security (the anti-CSRF + anti-cross-tenant control)

`beginOAuth` issues an opaque, **HMAC-signed** `stateToken` that **binds**:

- `tenantId` — the tenant the pending connection belongs to,
- `provider`,
- a random **nonce** (single-use), and
- an **expiry**.

It also generates **PKCE** (`code_verifier` server-only; `code_challenge` S256
in the request). `verifyCallback` rejects — with a typed `OAuthError` — on ANY of:

| Check | Attack prevented | `OAuthError.code` |
| --- | --- | --- |
| signature verifies / well-formed | forged state | `invalid_signature` / `malformed_state` |
| `returnedState === stateToken` | CSRF | `state_mismatch` |
| `now < exp` | stale-token reuse | `expired` |
| bound `tid === expectedTenantId` | **cross-tenant callback attach** | `tenant_mismatch` |
| nonce not already consumed | replay | `replayed` |

Cryptographic + CSRF + tenant checks run **before** the nonce is consumed, so a
forged or cross-tenant attempt never burns a legitimate nonce. The nonce is
consumed **atomically** and **last**, so a correct callback succeeds **exactly
once**. A real impl persists nonces in a table (nonce as PK; insert-or-conflict
= replay); here it is modeled with an injectable `NonceStore` + in-memory mock.

## Calendar adapters — external mirrors, internal DB is authoritative

`RichCalendarAdapter` extends the contract's `CalendarProvider` with
`readBusy(range)`, `updateEvent`, `cancelEvent`, `sync`, and `health` /
`reconnect`. Two mocks prove the abstraction through **one** code path with
**different** capabilities:

- **Google mock** — `freeBusyQuery: true`. `readBusy` answers a native
  free/busy query from seeded busy windows (independent of written events).
- **Microsoft mock** — `eventList: true`. `readBusy` **derives** busy windows
  from its events (no free/busy endpoint).

External calendars **mirror and block** availability, but Booking Lumin's own
database stays the **source of truth**. `mergeBusy(internalHolds, externalBusy)`
unions the two into a normalized, overlap-merged list for **display**; where an
external window overlaps an internal hold the merged span is tagged `internal`,
and every internal hold's time remains covered — an external calendar can never
erase an internal hold.

## Surface

- `src/oauth.ts` — state machine, PKCE (S256), signed single-use state,
  `beginOAuth` / `verifyCallback`, `TokenSet` / `TokenVault`,
  `redactConnectionForClient`.
- `src/calendar.ts` — `RichCalendarAdapter`, Google + Microsoft mocks,
  `mergeBusy`.
- `src/connection.ts` — `ConnectionHealth`, `checkHealth`, and pure lifecycle
  transitions onto the contracts' `IntegrationConnection` / `ConnectionStatus`.

All mocks are deterministic and hit no network.
