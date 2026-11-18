# Dormant immutable request envelope and internal serializer

Base PR276 (70c2354). No live adapter changes, dispatch, retry/replacement policy,
provider calls, webhook ACK changes, refunds, backfill, deployment or activation.
No approved Stripe API version was found. Registration requires an explicit version;
syntax acceptance does not imply compatibility, approval or supported deployment.
Test versions are synthetic fixtures, not production selections.

## Authority and durability

0108 adds one immutable envelope per existing 0104 request: explicit API version,
serializer version and creation timestamp. It references the immutable request,
attempt and source authority rather than duplicating/repricing them. Tenant,
booking, money, source and idempotency key are always derived from stored records.
No arbitrary metadata or caller-controlled parameters exist in the registration RPC.
Canonical metadata is only tenantId/bookingId. Fixed serializer version 1 defines
POST /v1/payment_intents, form encoding and automatic payment methods enabled.
No confirm, capture, payment method, customer, transfer or fee fields are emitted.

Registration locks the booking in the existing writer order, serializes competing
versions, returns exact replay and rejects version drift. First registration refuses
known intent association, payment rows or terminal bookings. This refusal is NOT
proof an unrecorded historical request was never dispatched. Future wiring must
establish pre-dispatch provenance; no retrofitting or inference from missing rows.

## Private capability boundary

Existing lumin schema grants USAGE to clients in migration 0001. Rather than break
those unrelated contracts, a dedicated payment_internal schema grants only service
USAGE and denies client USAGE/EXECUTE. Its materializer uses one STABLE MVCC query
and returns internal serializer input including the booking idempotency key, which
is also an existing capability. The function is privileged backend-only, not public
RPC, customer/restart/readiness output or safe logging data. Public registration
returns only envelope identity/version/timestamp; existing restart output is unchanged.
No direct envelope table/column reads or writes are granted even to service_role.

No materializer HTTP wrapper or runtime caller is added. There is no checked-in
Supabase exposed-schema configuration, so this patch does NOT prove hosted exposure
settings. Before any activation, the deployment must keep payment_internal outside
exposed schemas; the backend must own the trusted database connection and source
credential mapping, never forward arbitrary caller-selected tenant/attempt inputs.

The pure serializer is a directly imported *.internal.ts module, not barrel-exported.
It validates a closed input shape, copies/freezes output and deterministically emits
fixed path/method/form/header fields. Input/output contain a capability and must never
be logged, returned to clients, or bundled in frontend code. No secret key or
Authorization is accepted/emitted; source identity is not credential verification.
No network function is present. Version/header-control characters and unknown fields
(including metadata, secretKey, headers, URL, method and capture options) are rejected.

Historical read/replay after connection revocation or terminal booking remains
observational. It grants no permission to dispatch. Complete recovery still needs
explicit dispatch uncertainty, replay horizon, worker fencing, verified routing,
source-aware payment attachment and quarantine/escalation policy.

## Bounded attestation and tests

0109 preserves every 0107 check and adds exact function bodies/signatures/volatility,
private schema privileges, envelope columns/constraints/defaults/immutable trigger,
RLS and effective table/column grant checks. Witness advancement requires 0107 and
contract success atomically. Actual reader and standalone SQL expected head become
0109. Catalog attestation is not a historical data audit or provider proof.

The first fresh replay rejected a constraint fingerprint measured with the default
search path; it was remeasured under the contract's empty search path, preserving
the exact qualified FK definition rather than weakening validation. Local harnesses
must run in separate fresh databases, matching CI, to avoid shared synthetic account
fixtures colliding. No production constraint was changed to accommodate fixtures.

## Verified candidate evidence

PostgreSQL 16.16 fresh full-chain C and en-US ICU: exact standalone
migration_attestation_tests.sql, new envelope harness, unchanged restart harness,
77 catalog mutation cases through real reader and migration guard, four witness
negatives and predecessor guard all passed. Each harness used its own fresh clone.
The envelope harness also rejects a matching stored CRLF key corruption without
materializing it. All adapter suites: 10 files / 192 tests passed (24 new serializer
cases). Migration-attestation unit tests: 15 passed. Adapter and API typecheck passed.
No hosted environment or actual provider was exercised.
