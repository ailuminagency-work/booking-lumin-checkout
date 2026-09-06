// supabase/functions/create-payment-intent/index.ts
//
// POST endpoint (verify_jwt = TRUE — see deno.json / config.toml note in the
// README). The checkout app calls this AFTER creating a draft via the
// create_booking_draft RPC. This function is the ONLY place a payment intent is
// minted, and it does so entirely server-side:
//
//   1. Load the booking + its service with SERVICE_ROLE (bypasses RLS; the
//      trusted runtime is the security boundary here).
//   2. RE-PRICE the selection server-side with the ported PricingEngine (SI-1) —
//      the client never submits a price, and any client "total" is ignored.
//   3. RE-VERIFY availability fail-closed against live pending/confirmed holds
//      (SI-7) before committing to a charge.
//   4. Ensure the booking is in a state ELIGIBLE for payment (draft or
//      pending_payment; never confirmed/failed/terminal).
//   5. Create OR REUSE the Stripe PaymentIntent (Stripe-native Idempotency-Key
//      = the booking idempotency_key) and UPSERT the payments row keyed by the
//      UNIQUE (provider, provider_intent_id) (SI-3).
//   6. Return ONLY { clientSecret, publishableKey } — never the secret key.
//
// Idempotent on (tenant, idempotency_key): a retry returns the same intent's
// client_secret and never opens a second charge.

import { createStripeClient, PaymentError, type PaymentIntentRef } from "../_shared/stripe.ts";
import { chargeAmount, type Money, price, PricingError, type Selection, type Service } from "../_shared/pricing.ts";
import {
  isSlotAvailable,
  type AvailabilityOverride,
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

  // 1. Load the booking (must belong to the claimed tenant).
  const { data: booking, error: bErr } = await db
    .from("bookings")
    .select("id, tenant_id, state, selection, slot_start, slot_end, idempotency_key")
    .eq("id", booking_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (bErr) return errorResponse("INVALID_REQUEST", "could not load booking", 400);
  if (!booking) return errorResponse("BOOKING_NOT_FOUND", "no such booking for this tenant", 404);

  // The request's idempotency_key must match the booking's (defense-in-depth:
  // a caller cannot point a foreign key at someone else's booking).
  if (booking.idempotency_key !== idempotency_key) {
    return errorResponse("INVALID_REQUEST", "idempotency_key does not match booking", 400);
  }

  // 4. Eligibility: only draft / pending_payment may open a charge.
  if (!PAYMENT_ELIGIBLE_STATES.has(booking.state)) {
    return errorResponse("ILLEGAL_TRANSITION", `booking is not eligible for payment (state=${booking.state})`, 409);
  }

  const selection = booking.selection as Selection;

  // 2. Load the service + its child rows and RE-PRICE server-side (SI-1).
  // Items/addons/questions live in separate tables (migration 0003); the
  // logical *_key columns are the ids the Selection references.
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

  // Map DB rows → the pricing engine's Service shape (logical *_key → id).
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

  // 3. RE-VERIFY availability fail-closed (SI-7) against live holds.
  const durationMinutes = Math.round(
    (new Date(booking.slot_end).getTime() - new Date(booking.slot_start).getTime()) / 60_000,
  );
  const available = await verifyAvailability(db, tenant_id, svc.id, booking, durationMinutes);
  if (!available) {
    return errorResponse("SLOT_UNAVAILABLE", "slot is no longer available", 409);
  }

  // 5. Create/reuse the Stripe intent (Idempotency-Key = booking idempotency_key).
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
    const code = e instanceof PaymentError ? e.code : "PROVIDER_UNAVAILABLE";
    return errorResponse(code, "could not create payment intent", 502);
  }

  // UPSERT the payments row on the SI-3 anchor (provider, provider_intent_id).
  // A retry with the same key returns the same intent → same row (no dup).
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
  if (pErr) return errorResponse("PROVIDER_UNAVAILABLE", "could not record payment", 500);

  // Advance draft → pending_payment (idempotent; the DB trigger validates the
  // edge and refuses anything illegal). Confirmation happens ONLY in the webhook.
  if (booking.state === "draft") {
    await db.from("bookings").update({ state: "pending_payment" }).eq("id", booking.id).eq("state", "draft");
  }

  // 6. Return ONLY non-secret material.
  return jsonResponse({ clientSecret: intent.clientToken, publishableKey });
});

/**
 * Fail-closed availability re-verification: rebuild the AvailabilityQuery from
 * live DB rows and confirm the exact slot is still bookable against current
 * pending/confirmed holds (excluding this booking itself). Any missing config
 * or error ⇒ unavailable.
 */
async function verifyAvailability(
  db: ReturnType<typeof serviceRoleClient>,
  tenantId: string,
  serviceId: string,
  booking: { id: string; slot_start: string; slot_end: string },
  durationMinutes: number,
): Promise<boolean> {
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

    if (!tenant || tenant.status !== "active") return false;
    if (!rules || rules.length === 0) return false; // fail closed: no rules
    // Prefer a service-specific policy; fall back to the tenant-wide (null) one.
    const policyRow =
      (policyRows ?? []).find((p) => p.service_id === serviceId) ??
      (policyRows ?? []).find((p) => p.service_id === null);
    if (!policyRow) return false;

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
    // Exclude THIS booking's own hold so it doesn't block itself.
    const existing = (holds ?? [])
      .filter((h) => h.id !== booking.id)
      .map((h) => ({ start: h.slot_start, end: h.slot_end }));

    return isSlotAvailable(
      {
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
      },
      booking.slot_start,
    );
  } catch {
    return false; // fail closed
  }
}
