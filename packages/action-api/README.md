# Controlled Action API boundary

This package is a pure framework-neutral dispatcher for five named operations: getBooking, findAvailability, assignWorker, rescheduleBooking and cancelBooking. It has no HTTP server, database, network calls, provider keys or default action implementations. No booking is read, assigned, rescheduled or canceled by installing this package.

## Trusted and untrusted inputs

Construct createActionApi with a server-owned authenticate function and explicit domain handlers. dispatch receives a credential string plus JSON text. It accepts at most 16 KiB of UTF-8 request content, schemaVersion 1, UUID identifiers, strict action-specific bodies and safe positive integer versions. Mutations require an idempotency key and expected booking version. Unknown actions, fields, client actor/role objects and generic row updates are rejected. The future HTTP adapter must cap streaming body size before buffering, reject unsupported content types and supply request limits/timeouts; this in-memory limit is not an HTTP denial-of-service control.

The verifier must validate the credential with an authoritative identity provider and load current active membership, tenant scope, permission version and expiry on every call. Never merely decode a JWT or accept actor/tenant/role from request data. Missing or malformed verification fails closed. A PLATFORM_ADMIN token does not imply tenant membership. The current conservative policy permits BUSINESS_OWNER all five actions, BUSINESS_STAFF only reads, and workers none of these broad booking actions. Workers remain a distinct identity kind: their assigned-job API requires separate job/assignment policy and minimized DTOs, not BUSINESS_STAFF promotion. No manager role is invented.

## Domain authority

Handlers receive a detached frozen verified actor and parsed request, including exact versions/idempotency metadata. They must authorize every booking/service/worker identifier against that actor's tenant, apply current permission and state preconditions, and preserve caller-scoped Supabase RLS or use narrowly reviewed RPCs. Matching tenantId at dispatch does not establish nested-record ownership. Never implement the handlers with a generic service-role table proxy.

Mutation handlers must reauthorize and compare versions inside the committing transaction, write audit/outbox consistently, and persist same-payload idempotency receipts. This dispatcher deliberately has no in-memory idempotency cache and will call authority again on retries. An injected handler can return ActionHandlerError(CONFLICT), FORBIDDEN or NOT_AVAILABLE; other errors are reduced to INTERNAL_ERROR with no messages or stack. Successful responses are strictly validated allowlists, never raw handler objects. Invalid output after a mutation may mean the mutation already committed; clients must recover through the same durable key. Expiry after a handler similarly suppresses the response, not the committed effect.

Availability is a bounded offer list, not capacity ownership. Use tenant IANA timezone for hours and UTC instants for authority. Rescheduling retains the old reservation on failed allocation, and cancellation must follow existing refund/payment policy. These rules remain domain-handler responsibilities; this package does not replace core pricing, holds or payment finalization. Booking result state uses the existing BookingState contract; clients cannot submit financial state or amount.

## Future Render and Supabase adapter

A later Render HTTP adapter will map its validated Authorization header into the injected verifier, enforce transport budgets/rate limits, and map stable error codes to HTTP. Its Supabase integration must validate JWT signature/issuer/audience/expiry and fresh membership/revocation through supported authoritative verification. The same caller identity must reach RLS or the reviewed action transaction. Provider/background service credentials remain outside this general API. No JWT implementation, Render service, SQL migration or real provider is included here.

Tests use explicitly synthetic verifier/handler functions only. They cover tenant/actor forgery, staff/worker restrictions, missing authentication, unconfigured actions, strict byte/body/version limits, delegated stale-version conflicts, exact idempotency propagation and redacted output/errors. They are contract-boundary evidence, not live authentication, durable write or cross-tenant SQL certification.
