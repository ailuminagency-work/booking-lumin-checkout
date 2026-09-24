# Wave 3 migration reconciliation against protected main

Audit baseline: protected `main` `c5663c59e134e71beb511f509b3287ab0046bdff`; historical Wave 3 parity stack `885d8b6fc5a9712c4aa4ce69817a1867c10b6240`. This is a read-only semantic map. It does not register, renumber, apply, or approve a migration. Preserve every accepted main file and the RC-2 tenant, booking, capacity, payment, and demo/live boundaries.

## Existing behavior to reuse

| Current main | Historical Wave 3 | Finding |
| --- | --- | --- |
| 0013 platform PII hardening | 0018 platform financial minimization | Overlapping payment/refund active-tenant membership checks; audit policy differs. Main permits platform admins to read platform-level audit events where tenant ID is null. Replacing main with the historical policy semantics would remove that accepted visibility; literal replay would first fail against different policy names. Keep main's policy. |
| 0014 resource tenant integrity | 0013 resource tenant integrity | Byte-identical SQL; shifted number. |
| 0015 capacity serialization | 0014 capacity serialization | Same SQL behavior; migration-number comment differs. |
| 0016 durable outbox | 0015 durable outbox | Byte-identical SQL. |
| 0017 flow storage | 0016 flow storage | Byte-identical SQL. |
| 0018 bound flow requests | 0017 bound flow requests | Byte-identical SQL. |
| 0019–0030 | 0019–0030 | Identical SQL except a number reference in a 0022 comment. Reuse the accepted objects, including configurable requests, quantity accounting, roster, policy, carrier boundaries, group lifecycle, allocator, installations, and sessions. |

The accepted chain supplies `outbox_enqueue`, flow storage and publication functions, and `lumin.flow_actor`/owner-session APIs. These are dependencies for later field work; copying old migration numbers would collide with already installed objects and could change accepted policies.

## Missing behavior and collisions

Current main `0031_overbooking_backstop.sql` adds exclusive-resource reservation enforcement: `is_exclusive`, a reap/force trigger, an exclusion constraint, and capacity-change synchronization. The historical stack does not include that backstop. Historical `0031_mode_session_validation.sql` instead adds read-only existing-session validation and is absent from main. Historical 0032–0035 then build V1 text sidecars, prompt validation, V2 family isolation, and V3 sidecars through dependent table/RPC/function replacements. They cannot be lifted individually or assigned new numbers without preserving prerequisite order, role grants, immutability, and family-conflict behavior.

[PR #79](https://github.com/ailuminagency-work/booking-lumin-checkout/pull/79), still open on a separate business-profile base at audit time, proposes `0033_service_slot_overbooking_backstop.sql`. That number collides with historical prompt migration 0033; it must be reconciled with its owning branch before any new main-line migration number is selected. Its exact head `d64a962551bdecc16b96d9dc329a028d63e7e9ce` passed Actions run `34906319850`. That CI result does not qualify its composition with the historical field stack.

## Test obligations before a new SQL candidate

- Compose current-main resource exclusion with quantity allocation: both resource-capacity-change/reservation orderings, expired holds during downgrade or group release, pooled versus exclusive resources, adjacent intervals, rollback atomicity, cross-tenant references, direct-write denial, and intended service-role RPC paths.
- Independently challenge PR #79 before composition. Its proposed trigger's consumed-hold lookup tests booking ID and consumed status without directly comparing hold tenant/service/slot; malformed or noncanonical service identifiers take an unmarked path; updates from an already confirmed booking skip the guard. Test those cases and concurrent marker/confirmation changes. The supplied rejection fixture should identify its expected error message as well as SQLSTATE `P0001`. These are source-observed test gaps, not reproduced exploits.
- Only after main's prerequisite proof, add historical existing-session validation as a separate candidate. Prove origin, installation, version, revocation, expiry, and that validation cannot issue or renew a session.
- Then design an ordered field-storage candidate series with tenant/flow binding, deny-all direct table access, intended RPC execution only, dual revision checks, immutable family identity, and both conflict orderings. Keep publication storage unregistered until its own review.
- Run fresh disposable databases in both public and extensions layouts, including composed RLS/tenant and concurrency attacks. Exact-candidate CI and independent Release approval are required before any merge or deployment. No live Supabase migration or provider activation is authorized by this report.

Ownership: root Integration Governor owns migration numbering, shared CI and this map; the migration builder owns only a subsequently assigned candidate or composition fixture path; independent Security and Architecture reviews remain separate. The current pure-field review branches `34f6424` and `200b507` do not change SQL or certify these migration behaviors.
