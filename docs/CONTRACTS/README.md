# Contract Registry

The executable source of truth for all contracts is `packages/contracts/src/`
(types + zod schemas + adapter/engine interfaces), version-stamped via
`CONTRACTS_VERSION`.

| Contract | v | Module |
|----------|---|--------|
| MoneyContract | 1 | `money.ts` |
| TenantContextContract | 1 | `tenant.ts` |
| ServiceConfigContract | 1 | `service.ts` |
| PricingContract | 1 | `pricing.ts` |
| AvailabilityContract | 1 | `availability.ts` |
| BookingContract | 1 | `booking.ts` |
| PaymentProviderContract | 1 | `payment.ts` |
| IntegrationAdapterContract | 1 | `integrations.ts` |
| ErrorContract | 1 | `errors.ts` |
| EventContract | 1 | `events.ts` |

Breaking changes: bump version, append to `docs/DECISIONS.md`, get Architecture
Governor review before merge.
