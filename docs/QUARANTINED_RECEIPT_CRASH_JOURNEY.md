# Isolated verified-receipt crash journey

Base PR279 / 3aa14b3. Harness-only wave: no schema, production handler/verifier,
provider, ACK policy, deployment, routing/association or financial behavior change.
The test worker is guarded by FLOW_TEST_DISPOSABLE, explicit loopback database,
lumin_ database name and IPC parent presence. It binds HTTP only to 127.0.0.1 on
an ephemeral port. It is not a production ingress module or an added API route.

## Tested chain

Exact raw HTTP body -> existing Node verifier -> dormant candidate normalizer ->
private payment_internal.record_quarantined_event under SET LOCAL service_role ->
actual PostgreSQL COMMIT -> HTTP503. Successful quarantine deliberately never
returns ACK200. Fixed synthetic secret/platform/account/mode are selected at child
startup, never from HTTP headers/body/metadata. No provider fetch is allowed.
Raw request chunks are joined as bytes, decoded with fatal UTF-8 and BOM preserved;
the harness does not parse/reserialize or strip a BOM before signature verification.
Whitespace/BOM tampering with the original signature rejects; a correctly signed
Unicode-bearing payload still succeeds without metadata leaking into the response.

A future backend would need a trusted direct database connection and owned ingress
configuration. The existing live Edge uses PostgREST; this test neither exposes
payment_internal nor solves that production-host decision. It must not be wired
into production just because the isolated journey passes.

## Actual crash evidence, not simulated exceptions

The child sends an IPC barrier after the real receipt RPC but before COMMIT, or
immediately after awaited COMMIT but before any response write. It then waits and
cannot advance itself. Parent verifies database visibility at that barrier, sends
SIGKILL to that exact owned child, awaits its exit and disappearance of the reported
PostgreSQL backend PID, and verifies the pending HTTP request disconnected without
a response. A newly started process then receives the exact signed redelivery.

- Before-commit kill: zero persisted receipts, redelivery inserts exactly one.
- After-commit/before-response kill: one persisted receipt, redelivery is duplicate
  and still exactly one receipt. The response loss is real process/socket loss.

This proves these worker-failure cut points while PostgreSQL remains alive, not
power-loss durability, PostgreSQL failover or arbitrary infrastructure outages.
The separate DB-failure case deliberately executes division by zero inside the
actual transaction; it proves rollback/no-success response for a database statement
failure, NOT a simulated network outage or uncertain COMMIT outcome.

## Additional assertions

Invalid signatures, signed malformed shapes and wrong sources create no receipts.
Eight simultaneous HTTP duplicates converge to one row. Eight conflicting deliveries
preserve one original row and one bounded marker; later originals and alternates
return sticky conflict. Same event IDs under independently fixed platform/account/
mode contexts stay separate. Every valid response is503, every receipt quarantined,
and full snapshots of booking/payment/refund/review/association/envelope rows remain
unchanged. Response bodies contain no raw event, key, token or normalized payload.
No sensitive production data is involved; the only inherited database password, if
needed by CI, is passed privately to the disposable child and never logged.

The existing isolated acceptance runner includes the new harness and creates its
own fresh database clone, as for every other test. Child processes are owned and
terminated by the harness. No other user processes or database services are killed.

## Local evidence

Fresh PostgreSQL16.16 full-chain replay in C and en-US ICU, standalone migration
attestation SQL and the complete HTTP/child-crash harness passed in each locale.
Final runs included BOM/whitespace tampering and Unicode payload checks. API
TypeScript noEmit and diff check passed. No live provider or hosted endpoint tested.
