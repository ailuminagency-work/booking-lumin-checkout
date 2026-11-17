# P1 — payment provider architecture: decision record

Status: **decided, partially implemented.** This records which design was chosen, what was
grafted into it from the others, what was rejected and why, and the order of work. It is
the reference the implementation follows; it is not a second design.

## How this was decided

Four independent designs were produced from deliberately different angles, then scored by
three judges with distinct lenses. Each judge saw all four designs and named a winner.

| Design | constraint compliance | operational truth | buildability | total |
|---|---|---|---|---|
| **MIGRATION PATH** | 9.0 | 7.0 | 8.5 | **24.5** |
| MINIMAL SURFACE | 8.0 | 6.0 | 9.0 | 23.0 |
| OPERATOR FIRST | 4.0 | **9.0** | 7.0 | 20.0 |
| SECURITY FIRST | 3.0 | 5.0 | 5.0 | 13.0 |

The synthesis step did not finish: asked for exact TypeScript *and* exact SQL for the whole
architecture in one structured output, it hit the output limit twice and was stopped. That
was a flaw in how the task was framed, not a failure of the material — before dying it had
verified the designers' claims against this repository and reported two corrections. This
record is the synthesis, written at a size that fits.

## The decision

**Base: MIGRATION PATH.** Stripe Connect **Standard** accounts, onboarded through Account
Links, charged with **direct charges** — platform secret key plus a `Stripe-Account: acct_…`
header.

The consequence that decided it: **there is no per-tenant secret at all.** An account is
identified by an `acct_…` reference, which is an identifier and not a bearer credential —
nothing can be done with it without the platform secret, which lives only in the server
runtime's secret store. So `public.payment_connection_secrets` stays empty for payments and
the credential-encryption subsystem this repository deliberately lacks never has to be
invented. Three constraints (no hardcoded tenant secret; no customer pasting a secret key;
no stored tenant passwords) are satisfied structurally rather than by policy.

The second reason it won is the **seam**: *step 6 ends with a verified connection and zero
money moved.* Connection authority — the thing migration 0089 locked down — ships and is
proven in production before the money path changes a line, and each half reverts without
the other. No other design proposes that decomposition; all three judges singled it out.

The contract is a **new, separate** `PaymentConnectionProvider`, not a member added to
`PaymentProvider`. `PaymentProvider` is constructed per charge with the account already
resolved; this contract is what resolves it. Keeping them apart means the charge path, the
mock payment adapter and the deliberate Deno duplicate at
`supabase/functions/_shared/stripe.ts` do not grow a member.

The write path is exactly what 0089's own comment prescribes: **service_role SECURITY
DEFINER RPCs that verify with the provider before recording.** No client verb, no policy, so
0089's fail-closed guard and `rls_attack_tests` ATTACK 5c/5g keep passing untouched.

## Grafted in, with provenance

Each of these was named by a judge as worth taking from a design that did not win.

1. **Status is derived, never passed.** `lumin.payment_connection_status(current,
   charges_enabled, blocked_reason)` — a caller supplies what the provider said and the
   function decides. Paired with an executable cross-product guard over every status ×
   `charges_enabled` × reason, proving the derivation total. *From MINIMAL SURFACE; the
   buildability judge ran the guard and it passes. The only machine-checked correctness
   claim in the set.*
2. **An inconclusive answer changes nothing.** A 5xx, a timeout or a non-JSON body throws
   `PROVIDER_UNAVAILABLE` and the RPC is never called, so the row keeps its status. A
   `403 account_invalid` is **data**, recorded as `credentials_invalid` → `revoked`. *From
   MINIMAL SURFACE. This is the fix for OPERATOR FIRST's fatal flaw, where a transient
   Stripe failure took the tenant's checkout down until a human clicked.*
3. **Partial onboarding is a legitimate state**, not a failure: `chargesEnabled: true` with
   `onboardingComplete: false` is usable now with more information due later, encoded as
   `check (charges_enabled or blocked_reason is not null)`. *From MINIMAL SURFACE.*
4. **A four-value health verdict**, not a boolean: `chargeable` / `degraded` / `blocked` /
   `not_connected`, where `blocked` is connected-but-cannot-charge and payouts-disabled is
   `degraded` (it still charges, and money will strand). *From OPERATOR FIRST. This is the
   fix for MIGRATION PATH's own flaw, where a restricted merchant was undetectable until
   someone clicked.*
5. **An inbound webhook watermark** — `last_event_at`, `last_event_type`,
   `unattributed_events` — so "did webhooks stop?" is answerable. Today the Stripe event id
   is persisted nowhere, and that question needs a database shell. `unattributed_events`
   counts deliveries whose account matches no connected connection: an account is talking to
   us that we do not believe we are connected to. *From OPERATOR FIRST; no other design
   addresses it.*
6. **`PaymentConnectionReason` as a closed vocabulary** constrained by trigger, because
   `last_error` is published to every `BUSINESS_STAFF` member and is the likeliest place a
   raw provider error body lands. *From OPERATOR FIRST.*
7. **The composite tenant foreign key.** `unique (id, tenant_id)` on
   `public.payment_connections`, then `foreign key (connection_id, tenant_id)` on children.
   This closes a **pre-existing** hole: 0006 binds `payment_connection_secrets.tenant_id` to
   its connection's tenant by nothing at all, so a tenant-mismatched row passes every
   foreign key today. House precedent: `0014_resource_tenant_integrity.sql`. *From SECURITY
   FIRST, which lost overall.*
8. **`unique (provider, account_id)` plus write-once-by-privilege** (no UPDATE or DELETE
   grant to any role), so two tenants cannot bind the same account and a connection cannot
   be repointed. *From SECURITY FIRST.*
9. **Validate the resolved account id against `^acct_[A-Za-z0-9]{8,64}$` before it reaches a
   header**, throwing with zero fetches, so a CRLF can never be spliced into a request.
   *From SECURITY FIRST.*
10. **Reuse `public.confirmable_payment_providers` (0088) as the connect-time gate** instead
    of inventing a second allowlist. `stripe_connect` is already seeded everywhere,
    `payment_provenance_tests.sql` needs no edit, and the mock connect path becomes
    *physically unrecordable on a hosted database*, because 0088 seeds the simulated labels
    only under `current_database() ~ '^lumin_'` and hosted databases are named `postgres`.
11. **`payments.provider_account_id` recorded at charge creation**, durable, because a later
    disconnect and reconnect to a *different* account must not make an old payment
    unattributable — so the webhook and the reconciler read this column and never the
    connection's current config.
12. **Revert is a forward-only narrowing migration** (`revoke execute … from service_role`),
    never a `DROP`, because every migration must still replay from zero. That lesson is
    0092's.

## Rejected, with reasons

- **SECURITY FIRST's `payment_connection_record_health` write grant.** It lets automation
  move a connection `connected → error` — automation taking a tenant's payments offline
  with no owner action. That is a direct breach of the standing rule that AI must never
  change a merchant connection without owner action, and two judges caught it
  independently. The design that called itself security-first scored lowest on constraint
  compliance for exactly this.
- **SECURITY FIRST's "freshness proof"** (refuse the bind unless provider-reported
  `account.created >= handoff.began_at`). Two judges found it fails on the happy path and
  locks out every merchant who already uses Stripe. Its *intent* — bounding the
  "point my tenant at a victim's account" diversion — is kept, through graft 8 instead.
- **A boolean health flag.** It erases the restricted-merchant state; see graft 4.
- **Any stronger mechanism that would require editing `rls_attack_tests.sql`.** An attack
  suite you had to edit is an attack suite you weakened.

## Order of work

Steps 1, 2 and 4 block on nobody and can run in parallel. Steps 3, 5 and 8 block only on a
capability-flag flip. **Only steps 6 and 7 need a human with Stripe dashboard access.**

| # | Step | Blocks on |
|---|---|---|
| 0 | **Parked-payment reader** — `GET /api/payment-reviews` | **done (#246)** |
| 1 | Contract, connection capability registry, mock adapter | **done (#249)** |
| 2 | Migration 0093: idempotency ledger, status trigger, four service_role RPCs, SQL suite, attack-suite additions | **done (#250)**, applied to the staging child |
| 3 | Connection view — `GET /api/payment-connections`, behind `BOOKING_LUMIN_PAYMENT_CONNECTION_VISIBILITY` | **done (#252)**; needs the flag set to be reachable |
| 4 | Stripe Connect adapter + fake-Stripe extension (`/v1/accounts`, `/v1/account_links`, and the fake made to observe and scope by `Stripe-Account`) | **done (#251)** |
| 5 | Write path behind a flag, pointed at the **mock** connection adapter | a flag flip |
| 6 | Swap in the Stripe adapter; first real connection. **Ends with a verified connection and zero money moved** | **a human + Stripe test-mode credentials** |
| 7 | Route the money behind a separate flag; `Stripe-Account` on charge creation, `event.account` attribution on the webhook | **a human** |
| 8 | Reconciliation behind a flag | a flag flip |

Step 4 is deliberately ahead of any wiring: without the fake-Stripe extension — and without
the fake *observing* `Stripe-Account` — every later Connect test would pass vacuously. The
fake currently inspects exactly one header, `Idempotency-Key`.

**Step 0 is a reordering, not an addition.** The winning design put the parked-payment
reader in step 8, *after* money is routed in step 7; a judge called that fatal, since
`public.payment_reviews` would be written by the money path while still having no reader.
It shipped first instead (#246).

Step 8 stays last for a reason worth keeping visible: reconciliation is the only operation
that writes a `public.refunds` row, and doing so **permanently forecloses** confirmation of
that payment. That is recording a refund someone else issued — reconciliation, which is
allowed — not issuing one, which this system cannot do at all since every refund-issuing
primitive was deleted (#239). The foreclosure is irreversible, so it is a human decision and
is pinned by a standing test.

## What the build found that this record got wrong

An adversarial security review of #249, #250 and #251 found **fourteen real
defects** in work that was 4/4 green on CI. Four were serious and four were
failures of test design rather than of code. Two corrections belong in this
record, because it asserted them:

1. **"Automation can never bring a connection back; only an owner completing a
   fresh handoff can."** False as first implemented. `revoked` and `error` were
   terminal for the OWNER too, so a connection the provider had disowned stayed
   revoked forever even as the provider reported the new account healthy — and
   the row went incoherent (`revoked` beside `charges_enabled` true, no reason).
   Since `observe_payment_connection` takes no actor, **automation could brick a
   tenant's payments permanently**: the exact hazard the rejected SECURITY FIRST
   design was disqualified for, reached by another route. Fixed in two places —
   an owner bind restarts the derivation from `not_connected`, *and* write-once
   applies only while the connection is live, because a disowned account means
   the owner's fresh handoff necessarily yields a *different* account.

2. **Graft 1's "executable cross-product guard, proving the derivation total"**
   examined 24 of the 56 rows it advertised. `blocked_reason in (...)` is NULL
   over a NULL, so the predicate was NULL and the `WHERE` dropped those four
   rows rather than testing them. The mutation it was supposed to catch —
   deriving `revoked` from a NULL reason — passed. Now coalesced, with a
   companion assertion that fails on any row whose predicate evaluates to NULL.

The lesson worth carrying into steps 5–8: green CI did not test any of these,
because the same author wrote the code and its tests. Every step from here
should get an independent adversarial pass before it is called ready.

## Open questions — business decisions, not engineering

These gate step 7 and beyond, and are the owner's to answer:

1. **Dispute and chargeback liability.** With direct charges on a Standard account, disputes
   land on the connected account. Confirm that is intended.
2. **Parked-customer SLA.** How long may a payment sit in `public.payment_reviews` before
   someone must have decided, and who is told?
3. **The partial-refund rule.** When a human honours part of a mismatched amount, what is
   the expected end state of the booking?

## What is deliberately not here

Exact TypeScript and exact SQL. Those belong in the steps' own pull requests, where CI can
check them, not in a document that cannot be executed.
