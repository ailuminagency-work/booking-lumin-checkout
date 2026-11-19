# Housekeeping owner/customer no-payment acceptance

Two separate real HTTP/PostgreSQL harnesses deliberately stop before payment:

- `housekeeping-owner-customer.integration.ts`: V8 journey authoring, public render/session, availability and atomic draft/hold.
- `housekeeping-standard-owner-customer.integration.ts`: standard paid-simple publication and installation/session/request/hold, corresponding to `/checkout/flow/:installationId`.

Both create their catalog and scheduling through actual owner HTTP operations, use distinct synthetic actors/businesses, preserve unpublished-vs-published separation, replay the customer request, and require owner list/detail to return the same draft while denying foreign access. No payment/confirmation writer is installed. Both require zero payment/refund rows. V8 requires zero outbox rows; standard explicitly requires one unprocessed `booking.requested` event, not confirmation or delivery. No worker runs.

## Reproduced defect and fix

On base57385718, owner booking list succeeded but detail returned403. The detail reader attempted raw SELECT on `confirmation_delivery_receipts`, denied to service_role by0064. Local direct diagnostics confirmed42501/table privilege denial. The repair uses the existing scoped `outbox_confirmation_receipt_history(tenant,booking)` projection from0066 inside the same authorized transaction. No grants, migrations, recipient data, or state changes are added.

## Reproduction and isolation

The acceptance runner creates a disposable loopback-only template and separate cloned database per harness. Run `npm run test:integration --workspace=@lumin/api` against an explicitly owned local PostgreSQL instance. The new cases run with the existing in-process external fetch/TCP guard. Each verifies actual database host/port/name/user and initially empty business/booking/payment/outbox tables before any synthetic fixture write. All test identities are synthetic. No hosted credentials, real provider or payment calls are used.

For focused execution, clone a freshly migrated empty template into a database named `lumin_housekeeping_proof_<suffix>`, use PGHOST127.0.0.1/PGUSERpostgres and explicit PGPORT/PGDATABASE, and set the corresponding HOUSEKEEPING[_STANDARD]_NO_PAYMENT_LOCAL_TEST=1. Invoke Node with `--import ./apps/api/scripts/deny-external-network.mjs --import tsx` and the selected script. Do not run against an existing business database.

Failures emit a fixed stage identifier and bounded code/operator/numeric assertion fields, never bearer/session tokens, payloads or customer data.

## Evidence and limits

Builder: PostgreSQL16 fresh full migration chain, both six-stage HTTP cases pass; focused owner-detail unit/HTTP10 tests and API typecheck pass. The invalid owner bearer at customer availability returns401, not403; the fixture tests exact authentication denial.

Identity verification is intentionally a synthetic injected boundary. This is not hosted OAuth, browser rendering, actual embed interaction, payment completion or deployment evidence. Standard paid-simple form does not expose V8 configurable journey steps; those are separately tested, never treated as interchangeable. Connected calendar/availability and service-detail routes remain unavailable placeholders; actual scheduling is through Housekeeping service setup. This work does not make those placeholders functional or certify hosted APIs/migrations beyond0103.
