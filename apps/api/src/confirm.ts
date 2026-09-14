// confirm.ts — THE single booking-confirm authority for apps/api (P0 #3/#6/#7).
//
// This module is the ONLY code path that writes bookings.state = 'confirmed'. It
// ports the proven RC-3 edge-function flow (create-payment-intent + stripe-
// webhook) into the hostable API as ONE synchronous, server-authoritative
// confirm:
//
//   AUTH  → the verified actor (Supabase JWT → userId) MUST be a member of the
//           booking's tenant; the tenant is derived from the booking row, never
//           trusted from the client. The booking idempotency_key is a capability
//           token that must match (defense-in-depth + the anonymous-checkout
//           binding from the draft-request model).
//   REPRICE (R3) → the stored selection is repriced server-side; the client
//           amount is never read. The charge equals this reprice.
//   RESERVE-BEFORE-PAY (F1/R5) → availability is re-verified fail-closed and the
//           slot capacity derived from the same inputs; capacity_holds (+ any
//           resource_reservations) are reserved ATOMICALLY under the DB advisory
//           lock BEFORE any charge. NO_CAPACITY ⇒ 409, no charge, no confirm.
//   PAY (R2) → the reserved booking is charged for exactly the server amount via
//           the server-side PaymentGateway. A decline never confirms.
//   CONFIRM+CONSUME (R2) → on captured payment, in ONE DB transaction, the hold
//           is consumed and the booking transitions pending_payment → confirmed.
//   REFUND-ON-OVERSELL (F1) → if the hold was lost/expired at confirm time, the
//           booking is NOT confirmed: the capture is refunded (idempotent) and
//           the booking left failed. Never a confirmed oversell.
//   IDEMPOTENT (R4) → a retried confirm returns the same result: an already-
//           confirmed booking short-circuits, the gateway is idempotent on the
//           booking key, and payments are anchored on unique(provider,intent).
//
// The R1 EXCLUDE backstop (0031) remains the structural guarantee beneath the
// reserve path; this route proves the confirm honors it end-to-end.

import type { Pool, PoolClient } from "pg";
import { FlowError } from "./repository";
import { price, chargeAmount, type Selection, type Service, type Money } from "./confirm-pricing";
import {
  isSlotAvailable,
  slotCapacityAt,
  type AvailabilityOverride,
  type AvailabilityQuery,
  type AvailabilityRule,
  type SchedulingPolicy,
} from "./confirm-availability";
import { PaymentDeclined, type PaymentGateway } from "./payment-gateway";

const HOLD_TTL = "15 minutes";
const PAYMENT_ELIGIBLE = new Set(["draft", "pending_payment"]);

export interface ConfirmRequest {
  /** Verified user id (lowercased UUID) from the Supabase-JWT identity. */
  actor: string;
  /** Tenant scope (query param); membership is DB-verified, and the booking must belong to it. */
  tenant: string;
  bookingId: string;
  /** Capability token — must equal the booking's stored idempotency_key. */
  idempotencyKey: string;
}

export interface ConfirmResult {
  reference: string;
  state: "confirmed" | "failed";
  amount: number;
  currency: string;
  /** True when a captured payment was refunded on an oversell/mismatch (never confirmed). */
  compensated?: boolean;
}

export type ConfirmBooking = (req: ConfirmRequest) => Promise<ConfirmResult>;

export interface ConfirmOptions {
  now?: () => number;
  /** Test seam: runs after a successful capture, before the confirm transaction. */
  afterCharge?: (req: ConfirmRequest) => Promise<void>;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new FlowError("INTERNAL_ERROR");
  return n;
}

async function tx<T>(pool: Pool, run: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const out = await run(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

interface ReservedContext {
  reference: string;
  charge: Money;
}

export function createConfirmHandler(pool: Pool, gateway: PaymentGateway, opts: ConfirmOptions = {}): ConfirmBooking {
  const now = opts.now ?? Date.now;

  // -- Phase 1: authorize, reprice (R3), re-verify availability (R5), reserve
  //    capacity + resources (F1) BEFORE any charge. Returns the server charge,
  //    or 'already' for an idempotent replay of a confirmed booking.
  async function reserve(req: ConfirmRequest): Promise<ReservedContext | { already: ConfirmResult }> {
    return tx(pool, async (c) => {
      // AUTHZ: the verified actor must currently be a member of the tenant.
      const member = await c.query(
        "select 1 from public.tenant_members where tenant_id=$1 and user_id=$2",
        [req.tenant, req.actor],
      );
      if (member.rowCount === 0) throw new FlowError("FORBIDDEN");

      // Load the booking; (id, tenant) must resolve to the SAME row (never trust
      // a client tenant). Lock it so concurrent confirms of the SAME booking
      // serialize.
      const booking = (
        await c.query(
          `select id, tenant_id, reference, state, selection, slot_start, slot_end, idempotency_key
             from public.bookings where id=$1 and tenant_id=$2 for update`,
          [req.bookingId, req.tenant],
        )
      ).rows[0];
      if (!booking) throw new FlowError("NOT_AVAILABLE");

      // Capability token: the request key must match the booking's stored key.
      if (booking.idempotency_key !== req.idempotencyKey) throw new FlowError("INVALID_REQUEST");

      // Idempotent replay: an already-confirmed booking returns its result.
      if (booking.state === "confirmed") {
        const pay = (
          await c.query(
            "select amount, currency from public.payments where booking_id=$1 and state='succeeded' order by created_at desc limit 1",
            [booking.id],
          )
        ).rows[0];
        return {
          already: {
            reference: booking.reference,
            state: "confirmed",
            amount: pay ? num(pay.amount) : 0,
            currency: pay?.currency ?? "",
          },
        };
      }
      if (!PAYMENT_ELIGIBLE.has(booking.state)) throw new FlowError("CONFLICT");

      const selection = booking.selection as Selection;
      const svc = await loadService(c, req.tenant, selection.serviceId);

      // R3: reprice server-side; the charge is this amount, nothing the client sent.
      let charge: Money;
      try {
        charge = chargeAmount(price(svc, selection));
      } catch {
        throw new FlowError("INVALID_REQUEST");
      }

      // R5: fail-closed availability + authoritative capacity for the slot.
      const durationMinutes = Math.round(
        (new Date(booking.slot_end).getTime() - new Date(booking.slot_start).getTime()) / 60_000,
      );
      const assessment = await assessSlot(c, req.tenant, svc.id, booking, durationMinutes);
      if (!assessment.available || assessment.capacity < 1) throw new FlowError("CONFLICT");

      // F1: reserve any resource-backed requirements first (exclusive/pooled),
      // then the capacity slot — all atomically, BEFORE the charge.
      const resources = (
        await c.query(
          "select resource_id from public.service_resources where tenant_id=$1 and service_id=$2",
          [req.tenant, svc.id],
        )
      ).rows;
      for (const r of resources) {
        const held = (
          await c.query(
            "select result from public.reserve_resource($1,$2,$3,$4,$5,$6::interval)",
            [req.tenant, r.resource_id, booking.slot_start, booking.slot_end, booking.id, HOLD_TTL],
          )
        ).rows[0];
        if (!held || held.result !== "GRANTED") throw new FlowError("CONFLICT");
      }

      const reservation = (
        await c.query(
          "select result from public.reserve_capacity($1,$2,$3,$4,$5,$6,$7::interval)",
          [req.tenant, svc.id, booking.slot_start, booking.slot_end, booking.id, assessment.capacity, HOLD_TTL],
        )
      ).rows[0];
      if (!reservation || reservation.result !== "GRANTED") throw new FlowError("CONFLICT");

      // Advance draft → pending_payment (idempotent; the trigger validates the edge).
      if (booking.state === "draft") {
        await c.query("update public.bookings set state='pending_payment' where id=$1 and state='draft'", [booking.id]);
      }

      return { reference: booking.reference, charge };
    });
  }

  // -- Phase 3: confirm + consume atomically, or signal an oversell to compensate.
  async function confirmAndConsume(
    req: ConfirmRequest,
    chargeId: string,
    provider: string,
    charge: Money,
  ): Promise<"confirmed" | "oversold"> {
    return tx(pool, async (c) => {
      const booking = (
        await c.query("select id, state from public.bookings where id=$1 and tenant_id=$2 for update", [
          req.bookingId,
          req.tenant,
        ])
      ).rows[0];
      if (!booking) throw new FlowError("NOT_AVAILABLE");
      if (booking.state === "confirmed") return "confirmed"; // idempotent replay

      // F1 hold re-verify: the hold must still be this booking's (active, or
      // already consumed by a prior confirm of THIS booking). A PLAIN read — no
      // FOR UPDATE: capacity_holds is a carrier table (0024) on which service_role
      // holds SELECT only, and a row lock would need UPDATE privilege it must not
      // have. The lock is unnecessary anyway: we already hold this booking's row
      // FOR UPDATE (above) and there is exactly one hold per booking, so concurrent
      // confirms of the SAME booking are already serialized; the consume itself
      // goes through the consume_hold definer RPC.
      const hold = (
        await c.query("select status, expires_at from public.capacity_holds where booking_id=$1", [booking.id])
      ).rows[0];
      const holdActive = !!hold && hold.status === "active" && new Date(hold.expires_at).getTime() > now();
      const holdConsumed = !!hold && hold.status === "consumed";

      // Every resource reservation must likewise still be honored.
      const badResource = (
        await c.query(
          `select 1 from public.resource_reservations
             where booking_id=$1
               and not (status='consumed' or (status='held' and expires_at > now())) limit 1`,
          [booking.id],
        )
      ).rowCount;

      if ((!holdActive && !holdConsumed) || badResource) return "oversold";

      // Record the successful payment on the SI-3 anchor unique(provider,intent).
      await c.query(
        `insert into public.payments (tenant_id, booking_id, provider, provider_intent_id, state, amount, currency)
           values ($1,$2,$3,$4,'succeeded',$5,$6)
           on conflict (provider, provider_intent_id)
           do update set state='succeeded'`,
        [req.tenant, booking.id, provider, chargeId, charge.amount, charge.currency],
      );
      const paymentId = (
        await c.query("select id from public.payments where provider=$1 and provider_intent_id=$2", [provider, chargeId])
      ).rows[0].id;

      if (holdActive) await c.query("select public.consume_hold($1)", [booking.id]);
      await c.query("select public.consume_resource_holds($1)", [booking.id]);
      await c.query("update public.bookings set payment_id=$1 where id=$2 and payment_id is null", [paymentId, booking.id]);

      // The ONLY write of state='confirmed' in the system.
      const confirmed = (
        await c.query(
          "update public.bookings set state='confirmed' where id=$1 and state='pending_payment' returning id",
          [booking.id],
        )
      ).rowCount;
      return confirmed ? "confirmed" : "oversold";
    });
  }

  // -- Release holds + fail the booking (payment declined; no capture to refund).
  async function failBooking(req: ConfirmRequest): Promise<void> {
    await tx(pool, async (c) => {
      await c.query("select public.release_hold($1)", [req.bookingId]);
      await c.query("select public.release_resource_holds($1)", [req.bookingId]);
      await c.query(
        "update public.bookings set state='failed' where id=$1 and state in ('draft','pending_payment')",
        [req.bookingId],
      );
    });
  }

  // -- F1 deterministic compensation: refund the capture (idempotent), record it,
  //    release holds, fail the booking. NEVER confirms.
  async function compensate(
    req: ConfirmRequest,
    chargeId: string,
    provider: string,
    charge: Money,
    reason: string,
  ): Promise<void> {
    // Skip a second refund if a prior compensation already refunded this intent.
    const already = await tx(pool, async (c) => {
      const p = (
        await c.query("select id, state from public.payments where provider=$1 and provider_intent_id=$2", [
          provider,
          chargeId,
        ])
      ).rows[0];
      if (!p) {
        await c.query(
          `insert into public.payments (tenant_id, booking_id, provider, provider_intent_id, state, amount, currency)
             values ($1,$2,$3,$4,'succeeded',$5,$6) on conflict (provider, provider_intent_id) do nothing`,
          [req.tenant, req.bookingId, provider, chargeId, charge.amount, charge.currency],
        );
        return false;
      }
      return p.state === "refunded";
    });

    if (!already) {
      const refund = await gateway.refund(chargeId, charge, req.idempotencyKey);
      await tx(pool, async (c) => {
        const paymentId = (
          await c.query("select id from public.payments where provider=$1 and provider_intent_id=$2", [
            provider,
            chargeId,
          ])
        ).rows[0].id;
        await c.query(
          `insert into public.refunds (tenant_id, booking_id, payment_id, amount, currency, reason)
             values ($1,$2,$3,$4,$5,$6)`,
          [req.tenant, req.bookingId, paymentId, charge.amount, charge.currency, `compensation_${reason}`],
        );
        await c.query("update public.payments set state='refunded' where id=$1", [paymentId]);
      });
    }

    await tx(pool, async (c) => {
      await c.query("select public.release_hold($1)", [req.bookingId]);
      await c.query("select public.release_resource_holds($1)", [req.bookingId]);
      await c.query(
        "update public.bookings set state='failed' where id=$1 and state in ('draft','pending_payment')",
        [req.bookingId],
      );
    });
  }

  return async function confirm(req: ConfirmRequest): Promise<ConfirmResult> {
    const reserved = await reserve(req);
    if ("already" in reserved) return reserved.already;
    const { reference, charge } = reserved;

    // R2: pay for exactly the server amount. A decline never confirms.
    let captured;
    try {
      captured = await gateway.charge({
        tenantId: req.tenant,
        bookingId: req.bookingId,
        amount: charge,
        idempotencyKey: req.idempotencyKey,
      });
    } catch (e) {
      if (e instanceof PaymentDeclined) {
        await failBooking(req);
        return { reference, state: "failed", amount: charge.amount, currency: charge.currency };
      }
      throw new FlowError("INTERNAL_ERROR");
    }

    // R3 defense-in-depth: the amount actually captured must equal the server
    // amount. A mismatch is compensated, never confirmed.
    if (captured.amount.amount !== charge.amount || captured.amount.currency !== charge.currency) {
      await compensate(req, captured.chargeId, captured.provider, charge, "amount_mismatch");
      return { reference, state: "failed", amount: charge.amount, currency: charge.currency, compensated: true };
    }

    if (opts.afterCharge) await opts.afterCharge(req);

    const outcome = await confirmAndConsume(req, captured.chargeId, captured.provider, charge);
    if (outcome === "confirmed") {
      return { reference, state: "confirmed", amount: charge.amount, currency: charge.currency };
    }
    // Hold lost/oversold at confirm time — refund-on-oversell, never confirmed.
    await compensate(req, captured.chargeId, captured.provider, charge, "capacity_oversold");
    return { reference, state: "failed", amount: charge.amount, currency: charge.currency, compensated: true };
  };
}

// ---------------------------------------------------------------------------
// DB → domain loaders (mirror the RC-3 edge function's mapping).
// ---------------------------------------------------------------------------

async function loadService(c: PoolClient, tenantId: string, serviceId: string): Promise<Service> {
  const svc = (
    await c.query(
      "select id, archetype, name, currency, base_price, tax_rate_bp, rental, active from public.services where id=$1 and tenant_id=$2",
      [serviceId, tenantId],
    )
  ).rows[0];
  if (!svc) throw new FlowError("NOT_AVAILABLE");
  if (!svc.active) throw new FlowError("CONFLICT");

  // node-pg runs ONE query at a time per client; these share the confirm
  // transaction's client, so they are issued sequentially (not Promise.all).
  const items = await c.query(
    "select item_key, name, unit_price, min_qty, max_qty from public.service_items where service_id=$1",
    [serviceId],
  );
  const addons = await c.query("select addon_key, name, price from public.service_addons where service_id=$1", [serviceId]);
  const questions = await c.query(
    "select question_key, prompt, kind, required, choices, unit_price, min_qty, max_qty from public.service_questions where service_id=$1",
    [serviceId],
  );

  return {
    id: svc.id,
    archetype: svc.archetype,
    name: svc.name,
    currency: svc.currency,
    basePrice: num(svc.base_price ?? 0),
    items: items.rows.map((i) => ({
      id: i.item_key,
      name: i.name,
      unitPrice: num(i.unit_price),
      minQty: num(i.min_qty),
      maxQty: num(i.max_qty),
    })),
    addons: addons.rows.map((a) => ({ id: a.addon_key, name: a.name, price: num(a.price) })),
    questions: questions.rows.map((q) => ({
      id: q.question_key,
      prompt: q.prompt,
      kind: q.kind,
      required: q.required,
      choices: (q.choices ?? []) as Service["questions"][number]["choices"],
      unitPrice: q.unit_price == null ? undefined : num(q.unit_price),
      minQty: q.min_qty == null ? undefined : num(q.min_qty),
      maxQty: q.max_qty == null ? undefined : num(q.max_qty),
    })),
    rental: svc.rental ?? undefined,
    taxRateBp: num(svc.tax_rate_bp ?? 0),
  };
}

async function assessSlot(
  c: PoolClient,
  tenantId: string,
  serviceId: string,
  booking: { id: string; slot_start: string; slot_end: string },
  durationMinutes: number,
): Promise<{ available: boolean; capacity: number }> {
  try {
    // Sequential: one query at a time per pg client (shared transaction client).
    const tenant = await c.query("select timezone, status from public.tenants where id=$1", [tenantId]);
    const rules = await c.query(
      "select weekday, service_id, start_minute, end_minute, capacity from public.availability_rules where tenant_id=$1",
      [tenantId],
    );
    const overrides = await c.query(
      "select date, service_id, kind, start_minute, end_minute, capacity from public.availability_overrides where tenant_id=$1",
      [tenantId],
    );
    const policies = await c.query(
      "select service_id, lead_time_minutes, horizon_days, slot_interval_minutes from public.scheduling_policies where tenant_id=$1",
      [tenantId],
    );
    const holds = await c.query(
      "select id, slot_start, slot_end from public.bookings where tenant_id=$1 and state in ('pending_payment','confirmed')",
      [tenantId],
    );

    const t = tenant.rows[0];
    if (!t || t.status !== "active") return { available: false, capacity: 0 };
    if (rules.rows.length === 0) return { available: false, capacity: 0 }; // fail closed
    const policyRow =
      policies.rows.find((p) => p.service_id === serviceId) ?? policies.rows.find((p) => p.service_id === null);
    if (!policyRow) return { available: false, capacity: 0 };

    const mappedRules: AvailabilityRule[] = rules.rows.map((r) => ({
      weekday: r.weekday,
      serviceId: r.service_id,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      capacity: r.capacity,
    }));
    const mappedOverrides: AvailabilityOverride[] = overrides.rows.map((o) => ({
      date: typeof o.date === "string" ? o.date : new Date(o.date).toISOString().slice(0, 10),
      serviceId: o.service_id,
      kind: o.kind,
      startMinute: o.start_minute ?? undefined,
      endMinute: o.end_minute ?? undefined,
      capacity: o.capacity ?? undefined,
    }));
    const policy: SchedulingPolicy = {
      leadTimeMinutes: policyRow.lead_time_minutes,
      horizonDays: policyRow.horizon_days,
      slotIntervalMinutes: policyRow.slot_interval_minutes,
    };
    const slotStart = new Date(booking.slot_start).toISOString();
    const existing = holds.rows
      .filter((h) => h.id !== booking.id)
      .map((h) => ({ start: new Date(h.slot_start).toISOString(), end: new Date(h.slot_end).toISOString() }));

    const query: AvailabilityQuery = {
      tenantTimezone: t.timezone,
      serviceId,
      durationMinutes,
      policy,
      rules: mappedRules,
      overrides: mappedOverrides,
      existing,
      now: new Date().toISOString(),
      from: slotStart,
      to: slotStart,
    };
    return { available: isSlotAvailable(query, slotStart), capacity: slotCapacityAt(query, slotStart) };
  } catch {
    return { available: false, capacity: 0 }; // fail closed
  }
}
