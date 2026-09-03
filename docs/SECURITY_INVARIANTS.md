# Security Invariants

Owner: Security Governor. These override delivery speed. A violating merge is blocked.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| SI-1 | Never trust client-submitted prices. | `Selection` carries no prices; server reprices via `PricingEngine`; `PAYMENT_AMOUNT_MISMATCH` check before charge. |
| SI-2 | Payment and booking state are server-authoritative. | State machines in contracts; DB transition trigger; clients only render state. |
| SI-3 | One successful payment creates at most one booking. | Unique `payments(provider, provider_intent_id)`; unique `bookings.payment_id`; idempotent create keyed `(tenant_id, idempotency_key)`. |
| SI-4 | Cross-tenant access fails at the database layer. | RLS deny-by-default on every tenant table; membership-checked policies; RLS attack tests in `supabase/tests/`. |
| SI-5 | Provider credentials never reach the browser. | Credentials live server-side in `payment_connections.credentials_encrypted`; only `clientToken` (non-secret) is exposed. |
| SI-6 | Unknown legacy credentials are contamination, not assets. | `CONTAMINATION_LEDGER.md`; migration denylist in `MIGRATION_LEDGER.md`. |
| SI-7 | Availability is authoritative before payment commitment. | `AvailabilityEngine` fail-closed contract; booking engine re-verifies at `pending_payment`. |
| SI-8 | Integration credentials belong to one explicit tenant context. | `*_connections` tables keyed by `tenant_id`; adapters receive `tenantId` on every call. |
| SI-9 | Platform admin and business admin are different trust levels. | Separate `platform_admins` and `tenant_members` tables; no role union. |
| SI-10 | Webhook authenticity verified where supported. | `PaymentProvider.parseWebhook` throws `WEBHOOK_UNVERIFIED`; unverified payloads are never processed. |
| SI-11 | Sensitive values never appear in logs. | `AuditEvent.data` is redacted/PII-minimized; log lint in review gates. |
| SI-12 | Mocks support development without external credentials. | `@lumin/adapters` mock providers; all integrations start `not_connected`. |
| SI-13 | Production integrations connect only after security gates pass. | Release Governor gate G6; `RELEASE_LEDGER.md`. |
| SI-14 | Portal members cannot reach financial booking states. | `lumin.guard_booking_client_write` (0009): an `authenticated` UPDATE may drive `state` only into `completed`/`cancelled`; `confirmed`/`refunded`/`pending_payment`/`failed`/`draft` are server-authoritative (FORBIDDEN P0001). Engine `transition()` mirror-refuses `confirmed` (only `confirmFromPayment` confirms). RLS attack ATTACK 12. |
| SI-15 | Platform analytics is PII-minimized; admins have no routine raw-PII access. | 0009: SELECT policies on `customers`/`bookings` are member-only (no `is_platform_admin()`); Command Center reads only the SECURITY DEFINER aggregate views (`platform_booking_stats`, `platform_economics`), which expose aggregates (no PII) and gate on `is_platform_admin()`. Any future raw-PII platform access must be a separate, explicit, audited path (SECURITY DEFINER RPC writing `audit_events`), never a base-table policy. RLS attack ATTACK 13. |

## Clean environment requirements (verified at bootstrap)

The new environment contains ZERO inherited: customers, bookings, auth users,
Stripe credentials/connections, Google refresh tokens, calendar connections,
email/SMS credentials, webhook destinations, old domains, old client branding,
old OAuth grants. External integrations begin **NOT CONNECTED**.
