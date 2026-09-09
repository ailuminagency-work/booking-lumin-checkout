# @lumin/realtime

In-memory, mock-only tenant event delivery harness using the existing canonical
`AuditEvent`/`EventName` contract. No credentials, network, timers, database,
provider activation, or application wiring. Event timestamps come from callers.

`createMockTenantStream(tenantId)` exposes `subscribe(tenantId, handler)` (returns
an idempotent unsubscribe function) and `publish(event)` (returns cumulative
`delivered` and `pending` counts). Subscription and publication reject a different
tenant, including platform events with a null tenant. An event's audience is the
subscribers present when its ID first arrives; new subscribers do not receive old
events. There is no replay cursor or cross-event ordering guarantee.

Concurrent identical publications share one attempt. Successful handlers are not
called again; a repeated publication retries only failed original handlers.
Reusing an event ID with changed content rejects. Consumers receive independent
JSON snapshots. Unsubscribing prevents future attempts, but cannot cancel a
handler already running. A handler must finish: no timeout is imposed, and a
handler must not await republication of its own event ID.

Retry safety means acknowledgement deduplication in this process. A consumer that
performs a side effect and then throws may perform it again on retry: consumers
must independently deduplicate side effects. This is not exactly-once execution.

Limits default to 1,000 lifetime events, 100 active subscribers, JSON depth 20,
10,000 payload nodes and 65,536 serialized characters. Full streams reject new
IDs; records are never evicted to make duplicates appear new. Disposal means
discarding the stream and its deduplication history. This is a bounded test
harness, not a production durability or retention strategy.

Tenant equality is not authentication or authorization. Use trusted test scopes;
production delivery would require authenticated tenant membership and a durable
outbox. Callers must supply already redacted, PII-minimized event data. This
package does not certify payload redaction and never confirms or reverses bookings.
