# Migration Ledger

Owner: Clean Migration Engineering (WS3), gated by Security Governor.

## Standing policy (D-001)

The clean environment is built from scratch. The migration **allowlist is
empty** — concepts are re-specified in contracts; no code, schema, data, or
configuration is copied from the legacy environment.

## Permanent denylist (may never migrate)

- customers, bookings (any legacy row)
- credentials of any kind; OAuth grants; refresh tokens
- Stripe accounts, keys, webhook endpoints, intents
- external provider configuration (calendar, email, SMS, CRM)
- Supabase auth users
- branding, domains, client configuration

## Ledger

| Artifact | Source | Class | Migrated? | Notes |
|----------|--------|-------|-----------|-------|
| (none) | — | — | — | Allowlist empty under clean-room policy. |
