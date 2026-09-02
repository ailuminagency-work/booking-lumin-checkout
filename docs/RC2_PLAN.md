# RC-2 — Clean Supabase Runtime (plan)

Status: **staged, not started.** RC-2's first action creates live, billable cloud
infrastructure, so it begins only on explicit user go-ahead and a named Supabase
organization/account. Per program directive, **no Stripe, Google, email, SMS, or webhook
provider is connected until RC-2 tenant-isolation certification passes.**

## Objective

Stand up a brand-new Supabase project named **"Booking Lumin Checkout"**, apply **only** the
clean migrations from this repository, seed test tenants/users, and prove tenant isolation with
**real Supabase Auth + JWT + PostgREST** — not just the local `psql` role simulation used in RC-1.

## Preconditions (needed from the user)

1. Go-ahead to create a live Supabase project (has cost implications).
2. Which Supabase **organization/account** to create it under.
3. Confirmation the Supabase connector is authorized for this session.

## Steps

1. **Provision** a new project "Booking Lumin Checkout" in the chosen org. Record project ref,
   URL, anon key, service-role key (server-side only — never committed, never in the browser).
2. **Apply migrations** `0001`–`0008` in order (the `_deferred/` set is intentionally skipped).
   Do not apply any legacy dump. Verify 27 public tables, all RLS enabled + forced.
3. **Seed** two test tenants, each with a `BUSINESS_OWNER` and a `BUSINESS_STAFF` real Supabase
   Auth user, plus one `PLATFORM_ADMIN`; a small catalog + availability per tenant; no real PII.
4. **Cross-tenant attack certification over the real API** (not local roles):
   - Real JWTs minted via Supabase Auth for each user.
   - PostgREST REST calls attempting cross-tenant reads/writes on services, customers, bookings,
     payments, connections, settings → expect deny / empty.
   - Forged-tenant writes, role-escalation, anon reads beyond the public catalog, anon direct
     booking INSERT (must go through the `create_booking_draft` RPC), connection-secret reads.
   - Booking state-transition trigger + SI-3 uniques exercised over the API.
   - Command-center views: aggregate-only, zero rows to non-admins over the real API.
5. **Address RISK-2** here: decide whether platform admins read customer/booking data only
   through aggregate views (SECURITY DEFINER redesign) rather than base tables, and re-certify.
6. **Certification report**: PASS/FAIL per attack over the real runtime. Only on full PASS does
   the program unlock provider-integration milestones (still mock-first until each provider's
   own security gate passes).

## Out of scope for RC-2

Real payment/calendar/notification/webhook providers; any production data; any legacy-environment
connection. Adapters remain mock-only until a later, separately-gated milestone.
