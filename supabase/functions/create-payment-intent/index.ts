// supabase/functions/create-payment-intent/index.ts
//
// POST endpoint (verify_jwt = TRUE — see deno.json / config.toml note in the
// README). The checkout app calls this AFTER creating a draft via the
// create_booking_draft RPC. This function is the ONLY place a payment intent is
// minted, and it does so entirely server-side:
//
//   1. Load the booking + its service with SERVICE_ROLE (bypasses RLS; the
//      trusted runtime is the security boundary here).
//   2. AUTHORIZE the caller against the booking's tenant (F2 — see below).
//   3. RE-PRICE the selection server-side with the ported PricingEngine (SI-1) —
//      the client never submits a price, and any client "total" is ignored.
//   4. RE-VERIFY availability fail-closed against live pending/confirmed holds
//      (SI-7) before committing to a charge.
//   5. Ensure the booking is in a state ELIGIBLE for payment (draft or
//      pending_payment; never confirmed/failed/terminal).
//   6. RESERVE CAPACITY (F1): call the DB-authoritative reserve_capacity RPC for
//      the slot BEFORE minting the intent. NO_CAPACITY ⇒ 409 and NO intent.
//   7. Create OR REUSE the Stripe PaymentIntent (Stripe-native Idempotency-Key
//      = the booking idempotency_key) and UPSERT the payments row keyed by the
//      UNIQUE (provider, provider_intent_id) (SI-3). Release the hold on failure.
//   8. Return ONLY { clientSecret, publishableKey } — never the secret key.
//
// ── F2: AUTHORIZATION / CAPABILITY-TOKEN MODEL ──────────────────────────────
// `tenant_id` arrives in the body but is NEVER trusted on its own. Two paths:
//
//   (a) AUTHENTICATED (portal-initiated). The caller presents a Supabase user
//       JWT (role = "authenticated", sub = user id). We require that user to be
//       a MEMBER of the booking's tenant (tenant_members). A non-member is
//       rejected 403 even if the body's tenant_id/booking_id are internally
//       consistent.
//
//   (b) ANONYMOUS (public checkout). The caller presents the anon JWT (role =
//       "anon", no user identity). Here the booking's `idempotency_key` is a
//       CAPABILITY TOKEN: only the party that created the draft holds it. We
//       require (i) the token to match the booking's stored idempotency_key,
//       (ii) (tenant_id, booking_id) to resolve to the SAME row, and (iii) the
//       booking to be in draft/pending_payment for the stated tenant. Any
//       mismatch is rejected. This binds an anonymous minter to exactly the one
//       draft it legitimately created — it cannot point the endpoint at another
//       tenant's or party's booking.
//
// `metadata.tenantId` on the Stripe intent is set server-side from the loaded
// booking's tenant, never from anything the client asserts.

import { createStripeClient, PaymentError, type PaymentIntentRef } from "../_shared/stripe.ts";
import { chargeAmount, type Money, price, PricingError, type Selection, type Service } from "../_shared/pricing.ts";
import {
  isSlotAvailable,
  slotCapacityAt,
  type AvailabilityOverride,
  type AvailabilityQuery,
  type AvailabilityRule,
  type SchedulingPolicy,
} from "../_shared/availability.ts";
import { errorResponse, jsonResponse, serviceRoleClient } from "../_shared/db.ts";

interface RequestBody {
  booking_id: string;
  tenant_id: string;
  idempotency_key: string;
}

const PAYMENT_ELIGIBLE_STATES = new Set(["draft", "pending_payment"]);
// Short TTL for a capacity hold: long enough to complete a Stripe checkout,
// short enough that an abandoned checkout returns the slot to the pool.
const HOLD_TTL = "15 minutes";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse("INVALID_REQUEST", "POST only", 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "invalid JSON body", 400);
  }
  const { booking_id, tenant_id, idempotency_key } = body ?? {};
  if (!booking_id || !tenant_id || !idempotency_key || idempotency_key.length < 16) {
    return errorResponse("INVALID_REQUEST", "booking_id, tenant_id and idempotency_key (>=16) are required", 400);
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? "";
  if (!stripeSecret || !webhookSecret) {
    return errorResponse("PROVIDER_UNAVAILABLE", "payment provider is not configured", 503);
  }

  const db = serviceRoleClient();

  // 1. Load the booking (must belong to the claimed tenant — the (tenant_id,
  // booking_id) pair must resolve to the SAME row, part (b)(ii)).
  const { data: booking, error: bErr } = await db
    .from("bookings")
    .select("id, tenant_id, state, selection, slot_start, slot_end, idempotency_key")
    .eq("id", booking_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (bErr) return errorResponse("INVALID_REQUEST", "could not load booking", 400);
  if (!booking) return errorResponse("BOOKING_NOT_FOUND", "no such booking for this tenant", 404);

  // 2. AUTHORIZE the caller against the booking's tenant (F2).
  const caller = decodeCaller(req.headers.get("Authorization"));
  if (caller.role === "authenticated") {
    // Portal-initiated: the JWT's user MUST be a member of the booking's tenant.
    if (!caller.userId) return errorResponse("FORBIDDEN", "authenticated caller has no user identity", 403);
    const { data: membership, error: mErr } = await db
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", booking.tenant_id)
      .eq("user_id", caller.userId)
      .maybeSingle();
    if (mErr) return errorResponse("FORBIDDEN", "could not verify tenant membership", 403);
    if (!membership) return errorResponse("FORBIDDEN", "caller is not a member of this tenant", 403);
  }

  // (b)(i): the idempotency_key is the anonymous capability token — it must
  // match the booking's stored key. (Also defense-in-depth for the portal path:
  // a member of the tenant still cannot drive a mismatched key.)
  if (booking.idempotency_key !== idempotency_key) {
    return errorResponse("INVALID_REQUEST", "idempotency_key does not match booking", 400);
  }

  // 5. Eligibility: only draft / pending_payment may open a charge (b)(iii).
  if (!PAYMENT_ELIGIBLE_STATES.has(booking.state)) {
    return errorResponse("ILLEGAL_TRANSITION", `booking is not eligible for payment (state=${booking.state})`, 409);
  }

  const selection = booking.selection as Selection;

  // 3. Load the service + its child rows and RE-PRICE server-side (SI-1).
  const { data: service, error: sErr } = await db
    .from("services")
    .select("id, archetype, name, currency, base_price, tax_rate_bp, rental, active")
    .eq("id", selection.serviceId)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (sErr) return errorResponse("SERVICE_NOT_FOUND", "could not load service", 400);
  if (!service) return errorResponse("SERVICE_NOT_FOUND", "no such service for this tenant", 404);
  if (!service.active) return errorResponse("SERVICE_INACTIVE", "service is inactive", 409);

  const [{ data: itemRows }, { data: addonRows }, { data: questionRows }] = await Promise.all([
    db.from("service_items").select("item_key, name, unit_price, min_qty, max_qty").eq("service_id", service.id),
    db.from("service_addons").select("addon_key, name, price").eq("service_id", service.id),
    db
      .from("service_questions")
      .select("question_key, prompt, kind, required, choices, unit_price, min_qty, max_qty")
      .eq("service_id", service.id),
  ]);

  const svc: Service = {
    id: service.id,
    archetype: service.archetype,
    name: service.name,
    currency: service.currency,
    basePrice: service.base_price ?? 0,
    items: (itemRows ?? []).map((i) => ({
      id: i.item_key,
      name: i.name,
      unitPrice: i.unit_price,
      minQty: i.min_qty,
      maxQty: i.max_qty,
    })),
    addons: (addonRows ?? []).map((a) => ({ id: a.addon_key, name: a.name, price: a.price })),
    questions: (questionRows ?? []).map((q) => ({
      id: q.question_key,
      prompt: q.prompt,
      kind: q.kind,
      required: q.required,
      choices: q.choices ?? [],
      unitPrice: q.unit_price ?? undefined,
      minQty: q.min_qty ?? undefined,
      maxQty: q.max_qty ?? undefined,
    })),
    rental: service.rental ?? undefined,
    taxRateBp: service.tax_rate_bp ?? 0,
  };

  let charge: Money;
  try {
    const breakdown = price(svc, selection);
    charge = chargeAmount(breakdown); // total + deposit, positive safe integer
  } catch (e) {
    const code = e instanceof PricingError ? e.code : "INVALID_SELECTION";
    return errorResponse(code, "selection could not be priced", 400);
  }

  // 4. RE-VERIFY availability fail-closed (SI-7) and DERIVE the authoritative
  // slot capacity from the same inputs (F1).
  const durationMinutes = Math.round(
    (new Date(booking.slot_end).getTime() - new Date(booking.slot_start).getTime()) / 60_000,
  );
  const assessment = await assessSlot(db, tenant_id, svc.id, booking, durationMinutes);
  if (!assessment || !assessment.available) {
    return errorResponse("SLOT_UNAVAILABLE", "slot is no longer available", 409);
  }
  if (assessment.capacity < 1) {
    // Fail-closed: could not derive a positive capacity for the slot.
    return errorResponse("SLOT_UNAVAILABLE", "slot capacity could not be determined", 409);
  }

  // 6. RESERVE CAPACITY atomically BEFORE minting the intent (F1). This closes
  // the final-slot TOCTOU: two concurrent last-slot checkouts serialize on the
  // (tenant, service, slot) advisory lock inside the RPC and only one gets a
  // hold; the other is refused NO_CAPACITY here and no intent is ever created.
  const { data: reservation, error: rErr } = await db.rpc("reserve_capacity", {
    p_tenant_id: tenant_id,
    p_service_id: svc.id,
    p_slot_start: booking.slot_start,
    p_slot_end: booking.slot_end,
    p_booking_id: booking.id,
    p_capacity: assessment.capacity,
    p_ttl: HOLD_TTL,
  });
  if (rErr) return errorResponse("PROVIDER_UNAVAILABLE", "could not reserve capacity", 500);
  const held = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!held || held.result !== "GRANTED") {
    return errorResponse("SLOT_UNAVAILABLE", "the slot was just taken", 409);
  }

  // 7. Create/reuse the Stripe intent (Idempotency-Key = booking idempotency_key).
  const stripe = createStripeClient({ secretKey: stripeSecret, webhookSecret });
  let intent: PaymentIntentRef;
  try {
    intent = await stripe.createIntent({
      tenantId: tenant_id,
      bookingId: booking.id,
      amount: charge,
      idempotencyKey: idempotency_key,
      metadata: { bookingId: booking.id },
    });
  } catch (e) {
    // The charge could not be opened — RELEASE the hold so the slot is not
    // stranded until TTL expiry (F1).
    await db.rpc("release_hold", { p_booking_id: booking.id });
    const code = e instanceof PaymentError ? e.code : "PROVIDER_UNAVAILABLE";
    return errorResponse(code, "could not create payment intent", 502);
  }

  // UPSERT the payments row on the SI-3 anchor (provider, provider_intent_id).
  const { error: pErr } = await db.from("payments").upsert(
    {
      tenant_id,
      booking_id: booking.id,
      provider: "stripe",
      provider_intent_id: intent.intentId,
      state: intent.state,
      amount: charge.amount,
      currency: charge.currency,
    },
    { onConflict: "provider,provider_intent_id" },
  );
  if (pErr) {
    await db.rpc("release_hold", { p_booking_id: booking.id });
    return errorResponse("PROVIDER_UNAVAILABLE", "could not record payment", 500);
  }

  // Advance draft → pending_payment (idempotent; the DB trigger validates the
  // edge). Confirmation happens ONLY in the webhook.
  if (booking.state === "draft") {
    await db.from("bookings").update({ state: "pending_payment" }).eq("id", booking.id).eq("state", "draft");
  }

  // 8. Return ONLY non-secret material.
  return jsonResponse({ clientSecret: intent.clientToken, publishableKey });
});

/**
 * Decode the caller's role/user from the (already Supabase-verified, since
 * verify_jwt = true) JWT in the Authorization header. We only READ claims here
 * for authorization routing — the signature was validated by the platform
 * before this function ran, so a base64url payload decode is sufficient. Any
 * parse failure falls back to the least-privileged "anon" path.
 */
function decodeCaller(authHeader: string | null): { role: string; userId: string | null } {
  const fallback = { role: "anon", userId: null as string | null };
  if (!authHeader) return fallback;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return fallback;
  const parts = m[1].split(".");
  if (parts.length !== 3) return fallback;
  try {
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(payloadJson) as { role?: unknown; sub?: unknown };
    const role = typeof claims.role === "string" ? claims.role : "anon";
    const userId = typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : null;
    return { role, userId };
  } catch {
    return fallback;
  }
}

/**
 * Fail-closed availability re-verification + capacity derivation: rebuild the
 * AvailabilityQuery from live DB rows, confirm the exact slot is still bookable
 * against current pending/confirmed holds (excluding this booking itself), and
 * return the authoritative grid capacity for the slot. Any missing config or
 * error ⇒ { available: false }.
 */
async function assessSlot(
  db: ReturnType<typeof serviceRoleClient>,
  tenantId: string,
  serviceId: string,
  booking: { id: string; slot_start: string; slot_end: string },
  durationMinutes: number,
): Promise<{ available: boolean; capacity: number } | null> {
  try {
    const [{ data: tenant }, { data: rules }, { data: overrides }, { data: policyRows }, { data: holds }] =
      await Promise.all([
        db.from("tenants").select("timezone, status").eq("id", tenantId).maybeSingle(),
        db.from("availability_rules").select("weekday, service_id, start_minute, end_minute, capacity").eq("tenant_id", tenantId),
        db
          .from("availability_overrides")
          .select("date, service_id, kind, start_minute, end_minute, capacity")
          .eq("tenant_id", tenantId),
        db
          .from("scheduling_policies")
          .select("service_id, lead_time_minutes, horizon_days, slot_interval_minutes")
          .eq("tenant_id", tenantId),
        db
          .from("bookings")
          .select("id, slot_start, slot_end")
          .eq("tenant_id", tenantId)
          .in("state", ["pending_payment", "confirmed"]),
      ]);

    if (!tenant || tenant.status !== "active") return { available: false, capacity: 0 };
    if (!rules || rules.length === 0) return { available: false, capacity: 0 }; // fail closed
    const policyRow =
      (policyRows ?? []).find((p) => p.service_id === serviceId) ??
      (policyRows ?? []).find((p) => p.service_id === null);
    if (!policyRow) return { available: false, capacity: 0 };

    const mappedRules: AvailabilityRule[] = rules.map((r) => ({
      weekday: r.weekday,
      serviceId: r.service_id,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      capacity: r.capacity,
    }));
    const mappedOverrides: AvailabilityOverride[] = (overrides ?? []).map((o) => ({
      date: o.date,
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
    const existing = (holds ?? [])
      .filter((h) => h.id !== booking.id)
      .map((h) => ({ start: h.slot_start, end: h.slot_end }));

    const query: AvailabilityQuery = {
      tenantTimezone: tenant.timezone,
      serviceId,
      durationMinutes,
      policy,
      rules: mappedRules,
      overrides: mappedOverrides,
      existing,
      now: new Date().toISOString(),
      from: booking.slot_start,
      to: booking.slot_start,
    };

    // Availability (against holds) AND raw grid capacity (before holds) come
    // from the SAME inputs, so the number handed to reserve_capacity is exactly
    // the availability engine's own capacity for the slot.
    const available = isSlotAvailable(query, booking.slot_start);
    const capacity = slotCapacityAt(query, booking.slot_start);
    return { available, capacity };
  } catch {
    return { available: false, capacity: 0 }; // fail closed
  }
}
