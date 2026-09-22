# GOLDEN FLOW READINESS — Lane F

Traced against `88f7d6f` code + live Postgres 16 (all 30 migrations applied clean after `local_harness.sql`). Each step marked: **mock** (pure engine runs), **DB** (DB-backed path runs), **n** (cannot run today), with the exact missing link.

**One structural fact governs all three flows.** The reserve→pay→confirm→consume-hold path exists **only** in the Deno edge functions (`create-payment-intent`, `stripe-webhook`), which are **not deployed** and **not Node/Render-hostable**. The Render-shaped API (`packages/action-api/server`) accepts **unconfirmed draft requests only** (`contracts.ts:48`) and never reserves capacity or confirms. Therefore **no flow can complete a confirmed, capacity-checked booking on any hostable or live runtime today** — regardless of vertical.

---

## Flow A — Cleaning (housekeeping template, `configurable` archetype)

| Step | Runs? | Path / evidence | Missing / broken link |
|------|-------|-----------------|-----------------------|
| Choose service | mock + DB | `templates` `housekeeping`; `services` `0003`; read via `flow_owner_services`. | — |
| Configure (bedrooms/bathrooms/depth) | mock + DB | `workflow/engine.ts` evaluation; configurable flow persisted `0016–0019`; `ConfigurableQuestionForm.tsx`. | — |
| Authoritative quote | mock only | `core/pricing.ts`; server re-price only in edge `_shared/pricing.ts`. | Server-authoritative quote not on any hostable/live runtime. |
| Offer slot | mock + DB(read) | `core/availability.ts`; `availability_rules` `0004`. | Server verify only in edge fn. |
| **Reserve hold** | DB (proven) — **but unreachable** | `reserve_capacity` `0010`; proven 1 GRANTED/1 NO_CAPACITY. | **Only caller is the un-deployed edge fn; action-api never calls it; 0010 not live.** |
| Contact / location | DB | `bookings.address`, `customers` `0005`. | — |
| **Payment** | mock (edge only) | `mockPayment.ts`; edge `create-payment-intent`. | No hostable/live payment authority. |
| **Confirm + consume hold** | n | `stripe-webhook/index.ts:164 consume_hold`. | **Confirmation exists only in the un-deployed webhook.** Connected checkout returns "Request saved — unconfirmed". |

**Flow A verdict:** authoring + draft + engines run (mock/DB); **cannot complete a confirmed booking end-to-end.** Blocking links: reserve/pay/confirm live only in un-deployed edge functions; no confirm route on the hostable API.

---

## Flow B — Detailing (car-detailing template, `configurable` archetype)

Identical shape and identical blockers to Flow A (choose → configure package/vehicle → quote → slot → **reserve** → contact → **pay** → **confirm**). Same engines (`templates car-detailing`, `workflow`, `core/pricing`, `core/availability`), same DB tables, and the **same three blocking links** (reserve/pay/confirm are edge-fn-only). If detailing is modeled with an exclusive bay, it additionally depends on `reserve_resource` (`0012`), which is DB-proven but equally unwired to any app path.

**Flow B verdict:** same as A — runs mock/DB for authoring+draft; **no confirmed booking end-to-end.**

---

## Flow C — Vehicle rental, concurrency (`rental` archetype)

Extra requirements: **dates before catalog** (PRODUCT_MAP "Rental UX correction"), and **exactly one** of two concurrent customers may claim one exclusive vehicle/slot.

| Step | Runs? | Path / evidence | Missing / broken link |
|------|-------|-----------------|-----------------------|
| Collect dates first | partial | Rental contract `service.ts` rental config; `templates vehicle-rental`. | UI/flow does not *enforce* dates-before-catalog; no gating logic wired. |
| Show available models for dates | mock + DB | `packages/resources` reader; `resources`/`service_resources` `0012`. | Availability-by-date not wired into an app path. |
| **Reserve exclusive resource** | DB (proven) — unreachable by app | `reserve_resource` `0012`, `reserve_resource_quantity` `0020`, planning allocator `0028`. | **No app/hostable route calls it.** |
| Confirm | n | edge-fn only. | Same as A/B. |

### Concurrency / overbooking — measured on Postgres 16

All probes run against the fully-migrated DB. Two claims must be separated: **(1) does the RPC path serialize correctly** and **(2) is overbooking structurally impossible.**

**(1) The reserve RPC path is correct under true concurrency — proven:**

- `capacity_concurrency_harness.sh` (two live overlapping txns, same capacity-1 slot): **booking1 → GRANTED, booking2 → NO_CAPACITY; exactly 1 active hold.** → **1 GRANTED / 1 BLOCKED.** PASS.
- `capacity_overlap_concurrency_harness.sh`: **4/4 PASS** — capacity different-start, resource different-start, capacity different-timezone, resource different-timezone — each: one grant, one denial, one hold. (Timezone-normalized overlap is caught.)
- `resource_quantity_concurrency.py` (`RESOURCE_QUANTITY_TEST_DISPOSABLE=1`): **PASS, 5 observed overlap scenarios** — incl. last-unit `[GRANTED, NO_CAPACITY]`, two multi-unit `[GRANTED, NO_CAPACITY]`, compatible quantities `[GRANTED, GRANTED]`, legacy writer denied, `sum(quantity)=3` (no oversell of a 3-unit pool).
- `planning_policy_concurrency.py` (`PLANNING_POLICY_TEST_DISPOSABLE=1`): **5/5 PASS** — reserve-first, policy-first-reserve, booking-first, policy-first-booking, inverted-booking — each "exclusive safe outcome and full loser rollback".
- `planning_allocator_concurrency.py` (`ALLOCATOR_TEST_DISPOSABLE=1`, on `lumin_allocator_attack_1`): **6/6 PASS** — **contested service, contested resource, contested worker each admit exactly one**; prearmed timer cancels blocked allocator with no effects; bounded negative demonstration holds.

Mechanism: `pg_advisory_xact_lock(hashtextextended(tenant:service:slot, 0))` in `reserve_capacity` (`0010`) and the analogous `lumin:resource-capacity:tenant:resource` lock in `reserve_resource_quantity` (`0020`) serialize concurrent claimants; the loser blocks to commit, re-counts consumers, and is denied. This is real and it works.

**(2) Overbooking is NOT structurally prevented — proven counterexample:**

- **No exclusion/overlap constraint exists.** `bookings` (`0005`) has no `EXCLUDE`/overlap constraint. `resource_reservations` (`0012:99`) has only `unique (booking_id, resource_id)` (stops the *same* booking double-reserving the *same* resource) and `unique (tenant_id, idempotency_key)` on bookings — **nothing prevents two different bookings from overlapping the same slot/resource.**
- **Direct oversell probe (RPC bypassed):** inserting **two `state='confirmed'` bookings on the same capacity-1 slot** with **no `reserve_capacity` call** (as the trusted `service_role`/definer runtime would) is **accepted**: `DIRECT-CONFIRMED oversell count = 2`. The state-machine trigger validates the *edge*; `guard_booking_client_write` only constrains `authenticated` (portal) callers, not the server runtime. So capacity is enforced **only** if the writing code voluntarily calls the RPC first and honors `NO_CAPACITY`.
- **Live has none of it.** Live Supabase is at 0001–0009; `capacity_holds`/`reserve_capacity` (0010) and `resource_reservations`/`reserve_resource` (0012) **do not exist live at all** — so on the live runtime there is presently *zero* capacity enforcement.

**Flow C verdict:** the DB **correctly serializes the RPC path** (exactly one winner, proven repeatedly), **but the anti-overbooking guarantee is procedural, not structural**: there is no defense-in-depth constraint, the only caller is an un-deployed edge function, and the guard is entirely absent on the live runtime. Flow C cannot run end-to-end today, and its safety depends on a call site that is not wired into any hostable or live path.

---

## OVERBOOKING — definitive statement

**Does the DB prevent overbooking? Only conditionally, along one code path — NOT structurally.**

- **Along the `reserve_capacity` / `reserve_resource` RPC path:** YES — proven under genuine concurrency (capacity race **1 GRANTED / 1 NO_CAPACITY**; overlap **4/4**; resource-quantity **5/5**; allocator contested resource **admits exactly 1**).
- **In general:** NO — there is no `EXCLUDE`/overlap/unique constraint, so any confirm that bypasses the RPC or ignores `NO_CAPACITY` oversells and the DB accepts it (**proven: 2 confirmed bookings on a capacity-1 slot**). The only caller of the guard is the **un-deployed** Stripe edge function; the guard is **entirely absent on the live runtime (≤0009)**.

**This is a release blocker.** The fix must add a structural guarantee (a `btree_gist EXCLUDE` on `resource_reservations` over `(resource_id, tstzrange(slot_start,slot_end))` for held/consumed, and a confirm-time capacity assertion trigger on `bookings`) so oversell is impossible even when the reserve RPC is skipped — and the reserve/confirm path must be wired into an actually-deployable runtime.
