# Explicit succeeded-event facts v2, not success processing

Source-only successor to025ba17. No success processor, refund changes, runtime
ingress, provider call, ACK policy or deployment. Existing failure/cancel v1 callers
and the original normalizer remain unchanged.

normalizeStripeSucceededReceiptCandidateV2 is an explicit internal entry point for
payment_intent.succeeded only. It projects the existing fourteen identity/requested
amount/currency/version fields plus intentStatus, amountReceived and amountCapturable.
Parser/schema version are both2. Status must be a recognized PaymentIntent status;
received and capturable are separately required nonnegative safe integers. Missing,
null, string, fractional or unsafe amounts are rejected, never filled from metadata,
requested amount, status or defaults. event.api_version remains its explicit signed
value, including null. Output is detached/frozen and contains no raw metadata/token.

These are independent provider observations. Requested amount is not received money;
received money alone is not booking/confirmation authority; capturable is not paid.
Known status/amount combinations are retained even if they conflict with simplistic
eligibility assumptions. No requirement that received/capturable be below requested
amount is invented here. A future decision boundary must validate the appropriate
provider semantics. Valid shape is not signature or source proof.

0124 adds nullable receipt columns without defaults. Existing v1 rows retain NULL
for all three fields and remain immutable. Closed version/facts constraints require
v1/parser1 with three NULLs, or v2/parser2 succeeded events with all explicit facts.
Failure/cancel v2 and mixed parser/schema pairs are rejected. No row is enriched,
backfilled, reinterpreted or overwritten.

The recorder accepts exactly14 v1 or17 v2 keys. Event identity remains provider +
trusted platform + signed account/mode + event ID, independent of parser version.
Exact same-version/facts duplicates return the original; changed facts or valid
cross-version observations retain that original and atomically set the existing
sticky conflict marker. Receipt-lock serialization is preserved. Version is not a
new identity and cannot evade dedupe by creating another row.

## Deliberate availability cost

An old v1 parser and a new v2 parser observing the same event conflict, even if the
v2 facts are otherwise plausible. A later v2 delivery cannot repair/enrich a v1
original. Mixed parser rollout therefore costs availability and needs an explicit
future compatibility/reconciliation plan. This candidate does not invent one.
Success receipts still return unsupported_type from the failure-only processor;
all receipts remain quarantined and no success effect or ACK is enabled.

0125 retains all previous authority checks, updates only receipt body/table/default
fingerprints and verifies the new closed constraint before advancing the0123 witness.
No prior source, financial-denial, private-core or conflict-lock guard is relaxed.

## Evidence

Fresh PostgreSQL16 C/en-US ICU chains and standalone SQL. A dedicated owned database
replays the actual chain through0123, inserts a v1 row, applies0124/0125, and proves
identical old identity/history plus three NULL facts and exact replay.44 v2 cases
cover immutable originals, duplicate/version/fact conflicts, concurrent observations,
closed malformed inputs, safe boundaries and unchanged failure/cancel behavior.
Prior receipt, crash, scoped failure, financial denial, identity and legacy/mock
suites remain.180 catalog mutation negatives plus witness/predecessor cases pass.

293 adapter tests and29 actual Deno tests include real synthetic Node/Edge signature
composition, malformed signed facts, stale/wrong-source/tampered rejection and v1
compatibility.123 API tests and adapter/API typechecks pass. These are synthetic
local checks, not live Stripe or hosted packaging/deployment evidence.
