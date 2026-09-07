# @lumin/resources

A **generic** resource / pool / reservation model for Booking Lumin Checkout,
composed with the W6 capacity holds.

This package is the charter applied to resources: a **vehicle, a trailer, a
room, a crew and a technician are all just data over ONE model**. Nothing here
is an ERP or an inventory system — a resource answers exactly one question:
**how many of THIS thing can a slot consume?**

## The model

| Type                        | Is                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `Resource`                  | A **tenant-owned** capacity carrier. `mode` + `capacity` carry all semantics; `kind` is a label.  |
| `ResourceReservation`       | One reservation of one resource for one booking over `[slotStart, slotEnd)`, with a TTL + status. |
| `ServiceResourceRequirement`| A service **requires** `quantityRequired` units of a resource (mirrors the DB link table).        |

A resource is one of two things:

- **EXCLUSIVE** (`mode: "exclusive"`, `capacity: 1`) — a single indivisible unit
  (a vehicle, a trailer, a room). A slot either gets it or does not.
- **POOLED** (`mode: "pooled"`, `capacity: N`) — shared capacity of N
  interchangeable units (a crew of N, a bank of technicians). A slot may consume
  1..N.

Exclusivity is not a special case in the code — it is just `capacity === 1`. One
code path serves both.

## Availability — composes with W6

`resourceAvailability(resource, reservations, slot, now)` returns the **remaining
units** for a slot; `canReserve(...)` is the boolean form. A reservation
**consumes** a unit iff it **overlaps** the slot (half-open `[start, end)`) and
is **active**:

| status     | expiry                | consumes? |
| ---------- | --------------------- | --------- |
| `consumed` | —                     | yes       |
| `held`     | `expiresAt > now`     | yes       |
| `held`     | `expiresAt <= now`    | no (freed by TTL) |
| `released` | —                     | no        |
| `expired`  | —                     | no        |

This is the **exact** rule the database applies in `lumin.reserve_resource`
(migration `0012_resources.sql`) and that W6 applies in `lumin.reserve_capacity`
(`0010_capacity_holds.sql`), so the JS reader and the DB writer never disagree
about who holds a unit. `now` is **injected** (never a wall clock inside the
engine) — same discipline as the AvailabilityContract — so results are
reproducible and **fail closed** (an inactive resource, an unparseable instant,
or an unknown required resource all yield "unavailable", never a false grant).

`resolveServiceRequirements(requirements, resourcesById, reservations, slot, now)`
answers "**can this service get the resources it needs for this slot?**" — a
service that requires 2 crew is satisfiable iff its crew resource has >= 2 units
free. It returns a per-requirement breakdown plus the `shortfalls`.

## The database is authoritative at runtime

This package is a **pure planner/reader** — no I/O, no clock, no grants. The
**database** is authoritative when money is on the line: holds are minted
atomically under a `(tenant, resource, slot)` advisory lock by
`lumin.reserve_resource`, `consumed` on confirm and `released` on failure,
exactly like the W6 capacity holds. Use this package to preview availability and
resolve requirements; use the DB RPC to actually reserve.

## Scope

Additive only: depends solely on `@lumin/contracts` (for `TenantId`) + `zod`.
Touches no core, adapter, contract, or app code.
