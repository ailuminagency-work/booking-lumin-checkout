# Planning group lifecycle prerequisite

This increment adds structural protection and atomic release for privately constructed planning groups. It does not create an allocator, customer hold endpoint, worker assignment, or booking-confirmation path. No application caller can construct or seal a group. The approved design was independently reviewed before migration 0025 was allocated.

## Private storage and integrity

Five private tables hold group heads, immutable generations, resource and worker manifests, and worker interval holds. All enable and force RLS; application roles receive no raw table access. Existing capacity and resource carriers gain paired group/generation markers with composite tenant and booking references.

A head starts at generation one and can advance only by one after the current generation is terminal. Each generation moves one way from unsealed to sealed; incomplete or unsealed groups cannot commit. Sealed manifests cannot grow, change or disappear. SHA256 covers the canonical ordered manifest arrays. The implementation uses native `pg_catalog.sha256`, avoiding any assumption about where Supabase installed pgcrypto.

Held groups require exactly their declared service, resource and worker carriers, with matching quantities, occupied intervals and absolute expiry. Terminal groups cannot retain active carriers. Deferred validation checks both actual OLD and NEW associations. Historical manifests remain after carrier reuse; stale release calls cannot affect a replacement generation.

## Single application mutation

`public.release_planning_group(actor, tenant, group_id, expected_generation)` is granted only to the server role. It verifies active owner membership and the actual draft booking, locks the current generation and carriers, checks fresh expiry after waits, and releases all carriers and the group in one SQL statement. Invalid receipts, constraint failures or injected final-step failures roll back the whole transaction. Retries reauthorize and return the stored terminal result.

The fixed receipt contains group ID, generation, released/expired status, expiry, `bookingState: draft` and `confirmed: false`. No caller-supplied status, expiry, manifest or quantity is accepted. All internal helpers remain inaccessible to application roles.

## Concurrency and compatibility

The policy lock precedes the group-head fence and carrier/actor/roster/row locks. Legacy entry points take the shared fence before their existing locks and reject managed bookings even when a caller supplies a wrong tenant or resource. Original legacy bodies and their permissions are preserved apart from this guard. Managed changes require the stronger fence; validators do not obtain late replacement fences.

READ COMMITTED is required in entry points, shared guards and deferred validators. Higher-isolation legacy calls now reject explicitly; a stale REPEATABLE READ snapshot cannot miss a newly committed head after waiting. Parent deletion or an inverse preheld lock may cause a complete transaction abort. The claim is atomic integrity, not the absence of deadlocks.

Referenced history cannot be deleted or truncated, including terminal history. Managed bookings remain draft and cannot change identity, selection, interval or state after release. Retirement and ordinary roster edits remain possible. Cancellation, rescheduling, purging, consumption and confirmation require a later controlled handoff; none is silently enabled here.

## Verification and remaining dependencies

Builder and independent suites cover malformed seals, immutable history, partial or foreign carriers, stale generations, effective ACLs, parent actions, unsupported isolation, and full rollback. The separate race harness observes actual blocking PIDs and lock waits, including competing legacy calls, replacement generations, roster/policy changes and expiry during waits. Its synthetic history is retained in a dedicated disposable database.

The candidate must pass the combined 25 migrations, 15 SQL suites, existing concurrency and HTTP journeys, independent review, Runtime Guardian, exact CI and Release Governor before release acceptance is recorded. Source acceptance does not apply migration 0025 to hosted Supabase.

Future allocation must still prove source-policy truth, service capacity, resource quantities, worker/crew eligibility, shifts, buffers, fresh availability and transactional booking/payment handoff. Common group expiry does not retrofit every untouched legacy capacity reader's time semantics. Genuine hosted authentication and tenant isolation remain separate gates.
