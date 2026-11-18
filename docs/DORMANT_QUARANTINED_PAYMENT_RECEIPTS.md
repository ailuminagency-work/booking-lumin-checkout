# Dormant quarantined normalized payment-event receipts

Base PR277 e11f25e. No runtime callers, parser changes, provider calls, webhook ACK
changes, routing/association, deployment, dispatch/retry policy or refunds.

## Closed scope and authority

0110 accepts only payment_intent.succeeded, payment_intent.payment_failed and
payment_intent.canceled, with objectType payment_intent. Refund/charge events and
all other shapes are rejected, not guessed or mapped using fallback identifiers.
This deliberately narrower-than-Stripe v1 shape accepts evt_ event IDs and pi_
intent IDs with nonempty ASCII alphanumeric suffixes only (maximum 255 characters).
Other or future provider identifier forms are rejected pending an explicit contract
update, not guessed; personal/error prose and mismatched object prefixes cannot be
used as identifiers. It requires positive safe-integer
intentAmount and uppercase currency. intentAmount is the requested intent amount,
NOT paid, captured, refunded or money received. No financial action follows it.

The private service-only record_quarantined_event RPC accepts an exact closed
normalized JSON shape: provider stripe_connect; trusted ingress platformAccountId;
signed accountId/livemode; eventId/objectType/eventType/eventCreated/eventApiVersion;
parserVersion/schemaVersion 1; actual intentId; intentAmount/currency. Event API
version is required as an explicit string or null, separate from parser version
and outbound request API version. It is not compatibility approval. Event creation
time is diagnostic only, never ordering, replay-horizon or financial authority.

All facts are assertions by a future trusted verifier/parser. SQL verifies neither
signatures nor ingress credentials. Missing connected account or coerced mode is
rejected, never substituted from the platform. Tenant/booking IDs, metadata, raw
payloads, signatures, client tokens, credentials and arbitrary error fields are
not accepted. The source need not have an existing local connection: unknown and
legacy events are quarantined without association or tenant visibility.

## Durable quarantine and conflict

Receipt identity is provider + ingress platform + signed connected account + mode
+ event ID. Parser/deployment/version fields do not create a new dedup namespace.
Original normalized facts and received time are immutable. Every row is permanently
quarantined in this foundation; no handled/acknowledged state or release function
exists. Exact duplicate returns the original receipt/facts. Valid but conflicting
facts preserve the original and atomically insert one immutable conflict marker,
then return outcome conflict without raising/rolling back. The marker stores only
receipt ID and first_seen_at, not conflicting payload or an unbounded counter.
Later exact-original duplicates still report conflictSeen=true and outcome=conflict;
the top-level verdict is sticky too, never a clean duplicate after conflict. Unsupported shapes
or versions reject before receipt creation rather than being recorded as new IDs.

Unique insertion arbitrates concurrent first writers. Receipt immutability means a
subsequent statement can safely read the committed winner after waiting. A separate
unique marker makes repeated/concurrent conflicts bounded. RPC results are durable
only when the containing transaction commits; caller rollback removes its writes,
and redelivery is tested. There is no implied webhook acknowledgment policy.

Both tables are in payment_internal, forced RLS, no policies, no direct role table
or column grants including service_role. Client schema/function access is denied;
only service EXECUTE on the RPC is granted. Hosted exposed-schema settings remain
an activation gate, not something proved by a schema name. No public wrapper or
runtime consumer is introduced. Future ingress must own trusted identity and
verification; arbitrary callers must not supply those assertions unchecked.

## Bounded attestation and evidence

0111 retains every 0109 guard and adds the exact receipt function body/signature,
security/search path/volatility/role grants; table columns, constraints, defaults,
RLS, effective column privileges and immutable trigger binding. Witness advances
only from 0109 after the contract passes, in the same transaction. Actual reader
and standalone SQL suite expect 0111. This is bounded catalog verification, not a
full data audit or proof a particular event was cryptographically verified.

Fresh actual PostgreSQL16.16 full-chain C and en-US ICU runs passed: standalone
migration_attestation_tests.sql; receipt harness with real concurrent duplicate and
conflicting first writers, source isolation, rollback/redelivery, malformed input,
permission/immutability and unchanged financial-table counts; existing envelope and
restart harnesses; 95 reader+guard catalog mutations, four witness negatives and
predecessor rejection. Each harness used a separate fresh clone. Migration-attestation
unit tests: 15 passed. API typecheck and diff check passed. No live endpoint tested.

Shape review references: https://docs.stripe.com/api/events/object,
https://docs.stripe.com/api/payment_intents/object. Receipt storage deliberately does
not consume the existing broad refund parser; that requires a separately reviewed
charge/refund identity and cumulative-amount contract before any later support.
