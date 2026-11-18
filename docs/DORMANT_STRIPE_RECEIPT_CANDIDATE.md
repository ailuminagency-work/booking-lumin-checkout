# Dormant Stripe receipt-candidate normalizer

Base draft PR278 / 2b76158. Pure internal projection, NOT signature verification,
source authentication, database authority, receipt insertion or permission to ACK.
No runtime caller, verifier refactor, provider fetch, migration, dispatch/retry,
refund or deployment changes. Only CI's existing Deno test invocation is extended.

normalizeStripeReceiptCandidate(rawEvent, trustedIngressContext) accepts an event
object and a closed trusted context containing only platformAccountId. It requires
actual event identity/object/type/time, explicit api_version (string or null), signed
connected account and boolean mode, and a real payment_intent object's ID, requested
amount, lowercase currency and matching boolean mode. It preserves succeeded,
payment_failed and canceled distinctions rather than using normalized kind or a
fallback linked ID. Refund/charge/unsupported/malformed inputs reject. It projects
exactly the 14 normalized fields of 0110 and freezes a detached primitive-only
result. intentAmount is requested amount, not amount_received or captured money.
Event API-version syntax is not compatibility approval or outbound-version choice.

Metadata and unrelated fields, including client_secret and amount_received, are
ignored rather than used as authority or copied. Platform identity comes solely
from explicit trusted configuration. Null/missing source, coerced mode, mismatch
between event and object mode, invalid identifiers and unsafe version/ID characters
reject. Errors use only INVALID_STRIPE_RECEIPT_CANDIDATE, without input echo or
attached causes. No arbitrary context fields, secret keys or headers are accepted.

A structurally valid forged object can produce a candidate: the tests deliberately
prove this limitation. The output is not a verified-event capability. A future
trusted ingress must authenticate exact raw bytes with its configured verifier and
pass the returned raw object directly; possession of a WebhookEvent-shaped object
or invocation of this function is not proof that verification occurred. Trusted
configuration, hosted endpoint identity and schema exposure remain future gates.
No module barrel export is added. The Deno test imports the pure module across the
repository; this is NOT proof of deployed Edge packaging or runtime availability.

## Verification

Node tests exercise pure malformed/closed shape, frozen detachment, metadata/token
non-disclosure, no fallback IDs, bounded errors, explicit null and mode agreement.
Both unchanged existing verifiers are then composed with projection using synthetic
signatures. Tampered bytes, wrong secret, stale signature and source mismatch stop
before projection. Correctly signed malformed JSON, omitted version, object-mode
mismatch and refunds still cannot produce candidates. Fetch is forbidden in tests.

Actual local Deno 2.9.8 (official portable binary, no system installation) ran the
existing four Edge regressions plus twelve new signature-composition cases with
no permission flags: 16 passed. Deno check passed for the pure module/new test.
Node/Vitest all adapter suites: 11 files / 249 tests passed, including 57 new shape
and Node/Edge-mirror composition cases. Adapter TypeScript noEmit and diff check
passed. No real event, credential, provider or hosted endpoint was used.
