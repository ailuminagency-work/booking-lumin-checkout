# @lumin/action-api

Pure, dependency-light **action dispatcher** for the booking domain. A single
entry (`createActionApi`) maps a small, allowlisted set of named actions
(`getBooking`, `findAvailability`, `assignWorker`, `rescheduleBooking`,
`cancelBooking`) to injected, verified handlers, with Zod-validated requests
and allowlisted error codes (`ActionHandlerError` / `ERROR_CODES`).

It is a **contract layer**, not a transport: it performs no I/O, opens no
sockets, and touches no database. Callers inject an actor verifier and the
concrete handlers; the dispatcher only validates, authorizes the actor, routes,
and normalizes errors. Domain handlers are intentionally left unwired
(`NOT_IMPLEMENTED`) until a trusted server tier supplies them.

Depends only on `@lumin/contracts` (`TenantRole`, `BookingState`) and `zod`;
it stays pure and browser-safe.

> The HTTP + PostgreSQL server/BFF that composes this dispatcher over real
> RPCs (verified-JWT, caller-scoped RLS) lives outside `packages/` and is a
> separate application-tier workstream — see `docs/CONSOLIDATION_PLAN.md` (C6).
> Nothing under `packages/` may pull in `pg`, `node:http`, or other server/IO
> code.
