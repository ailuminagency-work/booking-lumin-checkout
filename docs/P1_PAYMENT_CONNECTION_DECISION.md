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
6. **`PaymentConnectionReason` as a closed vocabulary** constrained by a check constraint, because
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
| 2 | Migration 0093: idempotency ledger, status derivation function, four service_role RPCs, SQL suite, attack-suite additions | **done (#250)**, applied to the staging child |
| 3 | Connection view — `GET /api/payment-connections`, behind `BOOKING_LUMIN_PAYMENT_CONNECTION_VISIBILITY` | **done (#252)**; needs the flag set to be reachable |
| 4 | Stripe Connect adapter + fake-Stripe extension (`/v1/accounts`, `/v1/account_links`, and the fake made to observe and scope by `Stripe-Account`) | **done (#251)** |
| 5 | Write path behind a flag, pointed at the **mock** connection adapter — `POST /api/payment-connections/{begin,resolve}` behind `BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE` | **done (#PR5)**; needs the flag set to be reachable |
| 6 | Swap in the Stripe adapter; first real connection. **Ends with a verified connection and zero money moved** | **built, stacked on #253; the six-lens review's findings and the repair round that followed them are resolved or recorded (see "Step 6" under the found-section below).** With the write flag on, `BOOKING_LUMIN_PAYMENT_CONNECTION_PROVIDER=stripe_connect` selects the Stripe adapter in TEST MODE, and only where `BOOKING_LUMIN_ENV=staging`: it needs a test-mode `STRIPE_PLATFORM_SECRET_KEY` and the platform's own `STRIPE_PLATFORM_ACCOUNT_ID`. Live keys are refused. **The first live connection still needs a human** on Render staging, by the runbook below. This sandbox cannot reach `api.stripe.com` (proxy 403 on CONNECT), so the live run cannot happen from here. |
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

**Step 5 took that pass, and it paid again.** Six independent lenses over code
that was green on 6925 tests and 17 acceptance harnesses returned **twelve
findings, eight of them confirmed by a second reader who re-derived each one
from the code** (the other four were the first batch, already fixed by the time
the second reader looked, and correctly reported as no longer present).

The first four, found before the rest and fixed immediately:

1. **P1 — `begin` contacted the payment provider before `lumin.flow_actor` ran.**
   Shape checks are not authority, and the tenant id comes from the browser, so
   any authenticated caller — staff, non-member, another business's owner — could
   name any tenant and have an account minted for it, receiving 403 only
   afterwards. Against the Stripe adapter of step 6 that is a real Connect
   account on the platform with caller-chosen metadata and return URLs, orphaned
   because the ledger write is refused. Fixed by authorizing first.
2. **P2 — the test written to pin that ordering asserted nothing.** It sliced the
   query log to its own length (the whole array) and compared nothing against the
   moment the provider was entered, so it passed with the authority check moved
   back after the provider call: vacuous in exactly the way it was written to
   prevent.
3. **P3 — the begin receipt published the adapter's link expiry, not the bind deadline.**
   `record_payment_connection` refused a new bind once the ledger's `expires_at` plus one hour had
   passed (0093's header and repair suite say so). The receipt stated the link's expiry instead. That
   is minutes, earlier than the instant the database enforces, so an owner was never refused inside the
   stated window; but the window shown was far shorter than the one enforced, and a replay stated the
   replayed link's expiry, which could fall later than the enforced instant. The receipt now states the
   bind deadline the database enforces: the ledger's `expires_at` plus one hour, from one helper (migration
   0095; see the repair rounds).
4. **P3 — `replayed` did not mean what it was documented to mean.** The RPC
   returns "the connection already had an account", not "this handoff was already
   recorded". On the revoked-reconnect path this record argues for, a brand-new
   handoff binding a *different* merchant account reported `replayed: true` — the
   tenant's future charges moving to another account, announced as a no-op. Now
   derived from the handoff's own `resolved_at`.

The second eight, three in the code and five in the tests:

5. **P2 — every adapter failure reached the browser as `500 INTERNAL_ERROR`.**
   `mapError` reads PostgreSQL SQLSTATEs; a `PaymentError`'s code is a word, so
   nothing matched and everything fell through. An owner mistyping a return URL,
   an upstream Stripe outage, and a handoff the provider does not recognise were
   one indistinguishable server fault — and indistinguishable from the genuinely
   serious condition this writer raises `INTERNAL_ERROR` for. Fixed with a
   separate adapter-domain mapper, and `PROVIDER_UNAVAILABLE` (503) added to
   `FlowCode`: an upstream outage is retryable and nothing was written, which no
   existing code could say.
6. **P2 — `idempotencyKey` counted different units from the ledger.**
   `z.string().min(16)` counts UTF-16 code units; `0093`'s column counts
   characters. Eight astral characters are 16 units but 8 characters: accepted
   here, refused by the column, and surfacing as a check violation. Now held to
   an ASCII class that also sits inside the Stripe adapter's own.
7. **P3 — the Stripe adapter still documented that the handoff id "never reaches
   a browser".** This change publishes it in the begin receipt and takes it back
   on resolve. The exposure is intended and harmless (an account reference is
   useless without the platform secret) but the comment asserting otherwise was
   something a later reader could have relied on.
8–12. **Five tests that passed for the wrong reason.** A tautology that fed the
   adapter the same id from both the ledger and the caller, so it could not tell
   the substitution it forbids; two refusal checks that asserted against the
   provider's handoff map, which `resolveConnection` never writes, so they could
   not fail; a "neither receipt" credential scan that inspected only one of the
   two; and — the worst — **nothing anywhere pinned `resolve`'s owner-only
   authority**: flipping that one boolean to mere membership passed all 2392 unit
   tests and the whole pg harness. The reviewer called this a path to staff
   binding the account, which is wrong — `record_payment_connection` repeats
   `flow_actor` with owner authority in SQL, so the write is refused regardless.
   What it actually bought was a staff member making this service read the
   provider about their business's merchant account, learning whether it can
   charge, before that refusal. Smaller than reported, still a gate the API owes.

Each of the twelve fixes was mutation-checked: the fix was reverted and a named
test confirmed to fail. Seven of the twelve were failures of test design rather
than of code — a worse ratio than the first review, in work written while
specifically hunting that failure mode. "CI is green" remains no evidence at all
about this class of defect.

### Step 6: the six-lens review of the Stripe wiring

The first review confirmed fifteen findings, and three were not reproducible. Its lists are not in
the repository, so the items below are what this record states, and each names the code it
concerns. The counts in this section are the reviews' own, held outside the repository and not checked by any test here. Decision 10 is refined by what follows: a TEST-MODE connection is recorded under its
own label, `stripe_connect_test`, so the row says which mode produced it. The live label
`stripe_connect` is unchanged, and this build cannot construct it.

- **A test key recorded a connection indistinguishable from a live one (P2).** Fixed.
  Migration 0094 declares the test label confirmable on a `lumin_*` database only, the
  way 0088 declares the simulated labels. The writer also reads that declaration BEFORE
  the provider is asked anything, so a production database refuses a test connection
  without creating a Stripe account for it. The RPC keeps its own gate, in begin and in
  record (0095), so a label withdrawn after its handoff began is refused too.
- **A foreign platform's key read as a disowned merchant (P2).** Fixed. The stand-in answers
  `403 account_invalid` for every account a foreign key touches, the same answer it
  gives a merchant who has left (what live Stripe answers is UNVERIFIED; see below). Read as a
  verdict, it revoked a connected merchant in the stand-in.
  A disown is now recorded only after `GET /v1/account` returns the pinned
  `STRIPE_PLATFORM_ACCOUNT_ID`. Anything else is an outage, and records nothing.
- **A keyed onboarding link (P3).** Fixed. A replayed link is expired, and a keyed failure is
  replayed, so the same-key retry after a failed link request kept failing. The adapter
  assumes a keyed failure is retained for about a day. That retention is UNVERIFIED
  against live Stripe. The link is now sent without a key. The account stays
  keyed, so a retry still cannot mint a second merchant account. A retry now returns a
  fresh link on the same account.
- **Boot and operator claims wider than the code (seven findings, two rated P2).** Fixed in wording. The
  provider and key are read only when `BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE=1`. The
  boot check is a shape check that contacts no one, so a well-formed key that Stripe
  rejects boots cleanly and answers 503 on first use. render.yaml, main.ts and the
  selector say so.
- **A padded live key was not named as live (P3).** Fixed. The live check looks through
  surrounding whitespace, and the value is still never echoed.
- **Harness fidelity (four findings).** Fixed. The stand-in replays an account as it was
  created, where it had returned the live object. A 500 on the link leg is exercised with
  a path-scoped outage. The link is asserted to carry no key. A test-label refusal is
  asserted to make zero requests.

**Repair round 1.** A second review, of the first round's fixes (`cada81c..99fc081`), was run
by six lenses, and each finding was checked by two independent agents: one trying to refute it
from the code, one trying to reproduce it on a disposable database. A closure check of that
review then found the fixes partly complete, which is why a second repair round followed.

**Repair round 2 (`45975b1..` on this branch).** A review of round 1 (`99fc081..45975b1`)
confirmed 43 findings, none disputed and none dropped. The state-machine defects among them were
the most serious: an unfinished onboarding demoted a live connection, an older answer could overwrite
a newer one, and a demoted connection could be repointed. Each finding is closed below, or stated as
known and not fixed. Each fix was reverted in turn and a named test was observed to fail; the record
of those runs is in the pull request, not in this document.

- **A foreign platform's key created merchant accounts (P2).** Begin never asked the
  platform. The pin was checked only after Stripe disowned a merchant, so `POST /v1/accounts`
  ran under whichever platform the key belonged to. Begin now confirms the pin before it
  creates anything, and every read and every fresh link confirms it first too.
- **An unfinished owner was recorded as connected (P2).** An account whose owner never
  finished can carry a past-due requirement. The adapter read that as a past-due merchant,
  and the derivation records any reason other than `onboarding_incomplete` as connected.
  The adapter now names an unfinished onboarding before a past-due item, on a charging
  account as well as a non-charging one (round 2).
- **A merchant could not be refreshed or revoked after the bind window (P2).** Migration
  0095 applies the one-hour window to a NEW bind only. A record for the account the
  connection already holds is a refresh, and a provider that has since disowned it is
  recorded as revoked, however old the handoff.
- **An abandoned onboarding locked the business out (P2).** Migration 0095 lets a
  `not_connected` connection take a different account. A `not_connected` connection written under this repair
  was never connected, so no live money moves. Round 2 keeps that true: a connected connection is no
  longer demoted to `not_connected` by an unfinished-onboarding report, so a live connection
  cannot reach the state that lets it be rebound. Write-once still refuses every connected row. A row that 0093
  demoted from `connected` is not restored by this change: see the known list.
- **Resolve skipped the label declaration, and the reader showed undeclared labels (P2).**
  Resolve checks the declaration before the provider is asked, and the reader hides any
  connection whose label is not declared, in the same snapshot as its facts.
- **The test-mode provider could start outside staging (P2).** The selector builds it only
  when `BOOKING_LUMIN_ENV` is `staging`. The readiness guard alone was not a gate: it
  reports `unknown` when its probe fails, and `unknown` keeps a process serving.
- **The receipt stated the wrong deadline, and `replayed` was not a fact about the handoff
  (P3).** Begin now returns `bindDeadline`, and the receipt states it. The record call locks
  the handoff and reports whether THIS handoff had been recorded, so two concurrent resolves
  of one handoff cannot both report that they were first.
- **Tests that could not fail for the defect they named (P3).** Rewritten to assert what
  matters: the declaration query's own label; the whole normalised 0094 seed block, not a
  substring; the readiness list read from the migrations; the stand-in's keyed outages and
  its `Stripe-Account` handling; and the selector's pin, which uses a value no default names.
- **The runbook took the platform pin from the key under test (P2).** Step 2 now takes the
  id from the Dashboard. Round 2 puts that step first, because step 1 sets the id.

**Round 2b: the review of this round as first written.** A review of this round's code (`wf_2bf9e49b-42c`)
confirmed 45 findings and disputed five; none was dropped. Each confirmed finding is closed in this change or
stated as known and not fixed below. The five disputed ones were settled by a change, not by argument: a test
at the window boundary, the helper's membership check, a rewritten claim about same-account revival, a
seed-reader test, and the transport tests.

**Repair round 2: the findings, by what they were.**

- **An older answer overwrote a newer one (P1).** An overlapping resolve could
  commit a healthy snapshot after a disowning, and the account came back as connected. Observations
  are now ordered by when the provider answered: the adapter stamps the answer's arrival, and the
  database refuses an older observation for the same account, for both observe and record.
- **An unfinished onboarding demoted a live connection (P1).** Automation, or a replayed resolve,
  turned a connected row into `not_connected` while keeping its account. A connected row now stays
  connected on an unfinished-onboarding report, and its health verdict shows the blocker.
- **A demoted connection could be repointed, and an old handoff could rebind (P2, P3).** A handoff
  already recorded may refresh only the account it produced. A connected row refuses a different
  account, and the refusal is a conflict (409), not forbidden.
- **A connected tenant could start a second provider account (P2).** A new idempotency key on a
  connected tenant is refused before the provider is asked, in the writer. The RPC refuses it again, after the provider has
  been asked, for a race between that check and the insert. A
  replay of the tenant's own key is still answered.
- **A withdrawn label could still be recorded (P2).** `record_payment_connection` checks the
  declaration after it locks the handoff.
- **A member read rows the reader refuses (P2).** The member read on `payment_connections` now
  applies the reader's two checks, the provider is declared and the tenant is active, and it reads only the
  columns the reader shows: `last_error` and `config` are not granted to a client role.
- **Two concurrent begins with one key (P3).** The call that loses the insert reports a replay.
- **An undeclared label was 400 on begin and 422 on resolve (P3).** The writer's pre-check answers
  422 `UNSUPPORTED_CONFIG` on both: a deployment fact the owner cannot change is not a malformed request.
  One 400 remains, by design of the race: a label withdrawn between that pre-check and the database call is
  refused by the database as `PAYMENT_PROVIDER_NOT_CONFIRMABLE` (22023), which reports as `INVALID_REQUEST`.
- **Adapter, reasons and checks (P2, P3).** A rejected account that still charges is revoked, not
  shown as a caveat. A 200 without an account id from account creation is an outage, not an
  unverifiable reference. `linkExistingAccount` validates its URLs before any request. The adapter's
  comments no longer say the platform id comes from `GET /v1/account`, which a foreign key would
  answer with its own id, and no longer say a caller exists.
- **Registry (P3).** The capability registry lists the labels this build constructs:
  `stripe_connect_test`, and the mock. The live label is not listed; the unknown-label default answers
  simulated for it.
- **Tests that could not fail for the defect they named (P2, P3).** The bare-404 and every-status
  disown tests answer the platform check, so they reach the merchant classifier. The 500 and 429 on the
  merchant read are path-scoped. The link-leg outage is path-scoped. The static no-money guard counts
  call sites. The handoff lock and the connection-row lock are each checked by a two-session integration case, and
  the observation order by a third. A connected tenant's
  refusal creates no provider account.
- **Documents that were false (P2, P3).** The runbook takes the platform id first and applies
  migration 0095 with 0094; a 503 on begin has more than one cause (see the runbook). The record no
  longer describes a status trigger, which does not exist: the status is set by
  `lumin.payment_connection_status`.

Migration `0095_payment_connection_repair.sql` redefines the derivation
`lumin.payment_connection_status`, and the three owner and automation functions
`begin_payment_connection`, `record_payment_connection` and `observe_payment_connection`, and the reader
RPC `payment_connection_facts`, with their signatures unchanged. It adds two helpers: `lumin.payment_handoff_bind_deadline`, the single definition
of the window, and `lumin.payment_connection_readable`, the member read predicate. It replaces the member
read policy on `payment_connections`. Its suite is `supabase/tests/payment_connection_repair_tests.sql`;
the authority suite and the RLS attack suite were updated for the new behaviour, and section 12 of the repair
suite tests this round's changes by tenant. Like 0094, this change does not apply it to hosted staging.

Known and NOT fixed in this change. Each is recorded here so it is not discovered later:

- **A begin that reuses a ledgered key after Stripe's keyed retention** mints a second Stripe
  account, if Stripe keeps a keyed success for about a day (UNVERIFIED). The ledger does not bind that
  account, and the owner receives an internal
  error. The fix is a ledger-first replay contract, and a longer ledger expiry for return
  visits. Both change behaviour a person should decide, so this is a P3 open item. No
  money moves. An unbound test account can be left behind.
- **A replayed begin can return a live link after the bind deadline it states.** A replay gets a fresh
  onboarding link, because the old link has expired. Its receipt states the ledger's bind deadline, the
  deadline the database enforces (the ledger's expiry plus one hour). A replay made near that deadline can be
  given a link that Stripe still opens after it, and an owner who finishes then is refused at the bind. Clients
  should treat `expiresAt` as the last moment a bind is accepted, not as the link's life. Refreshing the
  handoff's deadline on replay is the fix. It changes what a replay means, so a person should decide it.
- **An operator sees a bare 503 for a rejected platform key.** The platform check
  (`GET /v1/account`) keeps no upstream status in its error, so the client receives a 503
  with no detail. The merchant read and account creation keep the status in the adapter's
  error message, which neither the client nor the log receives. The runbook below is the
  workaround. (An earlier version of this record said every adapter error carried the status.
  That is true of the merchant read and account creation only.)
- **Item 9: the mock's staging gate (the owner's decision).** The test-mode provider refuses
  to start outside staging. The step-5 mock path has no equivalent gate in the selector. Its
  gates are the database allowlist (`staging_mock` is declared only on a `lumin_*` database)
  and the readiness guard, which reports `unknown` when its probe fails, and `unknown` keeps a
  process serving. The option: fail closed on `unknown` when the write flag is on outside
  staging. The cost is a boot refusal on a database where migration 0088 is not yet applied.
  Not changed in this round.
- **Ordering is by the stamping process's clock.** The database refuses an older observation
  for the same account, but the order is set by the app's clock when the answer arrived. It
  assumes one writer, or synchronised clocks.
- **An expired handoff is refused as `INVALID_REQUEST` with no message.** A distinct code would change
  the HTTP contract, which this round does not. This build does not check how any portal renders the refusal.
- **Static no-money guards match literal call sites.** Every `call(` and `fetch(` in the adapter
  must have a literal method and path. A request built some other way is outside that guard.
- **A revoked connection is not revived by a same-account handoff in this build.** Automation cannot
  revive a revoked connection. A fresh handoff for a disowned account does not yield that account again, so no
  write path here produces a same-account revival. The residual to watch is a return visit: a handoff already
  recorded, or one lapsed, that the owner resolves after its window. Its refresh and its disowning are accepted
  by design; a bind that would bring a revoked or unfinished connection to `connected` is refused by the clock.
- **A row 0093 demoted is not restored.** 0093 derived `not_connected` for any unfinished-onboarding report,
  including a connection that had been connected. 0095 keeps a connected row connected, but does not repair a row
  already demoted: it stays `not_connected` while its account stays bound, and a new handoff can then bind another
  account over it, because `not_connected` is exempt from write-once. Whether any database that ran 0093 holds such a
  row is not checked here; check before 0095 is applied to one.
- **The stored health verdict is as of its last observation, and nothing refreshes it.** No observer is wired, so
  the owner's verdict is the one from the last resolve, and `lastObservedAt` says when that was. Charge gating on the
  stored verdict needs an observer and an age check first: a step-7 prerequisite.
- **Boot makes no request to Stripe, so a foreign key is refused on first use, not at boot.**
  The first owner action confirms the pin before it creates or reads anything, and answers
  503 with nothing recorded. A boot-time identity check would surface it earlier, at the
  cost of a network call during boot.
- **Nothing here has been seen against the real Stripe API.** The sandbox cannot reach
  `api.stripe.com`. The claims this record makes about Stripe's behaviour are UNVERIFIED: that a
  foreign key's `403 account_invalid` is also the answer for a merchant who has left; that a keyed
  failure is retained for about a day; that a replayed onboarding link has expired; that a `401`
  means a rejected key; that `GET /v1/account` returns the platform's own id; that an onboarding link is
  single-use and short-lived; that a disown's 404 carries `resource_missing` or `account_invalid`; and that a
  keyed success is retained for about a day, a 500 included, as the adapter's comments assume. The code is
  consistent with each of them, which is not evidence for any. The first staging run confirms them.
- **A stale comment in an applied migration.** Migration 0088 says "Two simulated provider labels
  exist". That was true when 0088 was written. Migration 0094 adds the third, `stripe_connect_test`,
  and the tests that pin the label list read the migrations, not that comment. Applied migrations
  are not edited, even for comments, so the comment stays and this note records it.

### First live test-mode connection: the operator runbook

A person does each step. None is automated, and none uses a live key.

1. Take the platform's account id (`acct_…`) from the Stripe Dashboard of the platform account
   itself, in test mode, by a person signed in to that account. Do NOT take it from an API
   response made with the key under test: a key from another platform answers with its own
   id, and the pin would then protect nothing.
2. Apply migrations 0094 and 0095 to the hosted STAGING database, in that order, before the
   first begin. Without 0095 the first begin answers 500, because the receipt needs the bind
   deadline. Without 0094 the test label is not declared, and every begin is refused as
   `UNSUPPORTED_CONFIG` (422). Both are changes to hosted staging and need the owner's approval
   first. This repository's deploy path does not apply them.
3. Declare the test label on the hosted STAGING database, once: the bootstrap insert at the
   foot of migration 0094, which is commented out there. A person runs it after step 2. It is
   never run on production.
4. On Render staging, service `lumin-api`, set `BOOKING_LUMIN_ENV=staging`,
   `BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE=1`, `BOOKING_LUMIN_PAYMENT_CONNECTION_PROVIDER=stripe_connect`,
   `STRIPE_PLATFORM_SECRET_KEY` (the platform's own test-mode `sk_test_` key) and
   `STRIPE_PLATFORM_ACCOUNT_ID` (the id from step 1). The test-mode provider refuses to start
   unless the environment is `staging`.
5. Confirm the pin by hand, once, with the same key: `GET https://api.stripe.com/v1/account`
   should return the id from step 1 before the first connection is read. The service confirms it
   before every operation, and a mismatch is an outage that records nothing.
6. An owner begins and completes Stripe's test onboarding. Resolve should show `connected` and
   `chargeable`, and the stored provider should read `stripe_connect_test`.
7. If begin answers 503 on every attempt, the body says only `PROVIDER_UNAVAILABLE`, and the cause is one of
   several. Check them in this order, reproducing each by hand with the same key:
   - The platform key is rejected: `GET /v1/account` answers 401 (UNVERIFIED against live Stripe).
   - `STRIPE_PLATFORM_ACCOUNT_ID` does not match the key's platform: `GET /v1/account` answers an id other
     than step 1.
   - Account creation or the onboarding link answers a non-2xx status, or answers without a usable account id
     or link, or with a body that is not JSON. The upstream status is kept in the adapter's error, which
     neither the client nor the log receives, so read it by repeating the request by hand.
   - The request never reaches Stripe: a transport failure from this service.
   Fix the cause, then retry. If the same idempotency key keeps failing, use a new key. A keyed failure may be
   retained by Stripe for about a day (UNVERIFIED), and a new key leaves an unbound test account behind, as the
   known list records.

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
