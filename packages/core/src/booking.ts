import {
  addMoney,
  AvailabilityEngine,
  AvailabilityOverride,
  AvailabilityQuery,
  AvailabilityRule,
  BOOKING_TRANSITIONS,
  BookingEngine,
  BookingError,
  BookingRecord,
  BookingState,
  BookingStateChange,
  CapacityHold,
  CreateBookingRequest,
  PaymentError,
  PaymentProvider,
  PricingEngine,
  SchedulingPolicy,
  Service,
} from "@lumin/contracts";
import { createAvailabilityEngine } from "./availability";
import { createPricingEngine } from "./pricing";

export interface BookingEngineOptions {
  services: Service[];
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  policy: SchedulingPolicy;
  tenantTimezone: string;
  payments: PaymentProvider;
  pricing?: PricingEngine;
  availability?: AvailabilityEngine;
  /** Injected clock (UTC ISO). Defaults to the system clock at the composition root. */
  now?: () => string;
  idFactory?: () => string;
}

export interface BookingStore extends BookingEngine {
  listBookings(tenantId: string): BookingRecord[];
  getBooking(id: string): BookingRecord | null;
  getHistory(bookingId: string): BookingStateChange[];
  /**
   * Idempotent payment-success handler (SI-3): maps a payment intent to its
   * booking and transitions pending_payment → confirmed exactly once, ONLY
   * after verifying with the payment provider that the intent actually
   * succeeded. A second call for the same intent returns the same confirmed
   * record. Async because verification consults the provider (getIntent).
   */
  confirmFromPayment(intentId: string): Promise<BookingRecord>;
  /** The engine-minted payment intent id for a booking, if any. */
  intentIdForBooking(bookingId: string): string | null;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function tinyHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h;
}

function crockford6(seed: string): string {
  const n = tinyHash(seed);
  let out = "";
  for (let i = 0; i < 6; i++) out += CROCKFORD[(n >>> (i * 5)) & 31];
  return out;
}

/**
 * Reference in-memory booking engine — the domain implementation the server
 * runtime wraps; database constraints mirror its guarantees.
 *
 * Guarantees:
 *  - createBooking is idempotent on (tenantId, idempotencyKey), including
 *    concurrent duplicate submits (synchronous reservation before any await).
 *  - Server-side repricing only (SI-1): client-supplied totals do not exist
 *    in the API surface.
 *  - Availability verified fail-closed against confirmed + pending bookings
 *    before any payment commitment (SI-7).
 *  - One payment intent maps to at most one booking confirmation (SI-3).
 */
export function createBookingEngine(opts: BookingEngineOptions): BookingStore {
  const pricing = opts.pricing ?? createPricingEngine();
  const availability = opts.availability ?? createAvailabilityEngine();
  const now = opts.now ?? (() => new Date().toISOString());
  const idFactory = opts.idFactory ?? (() => crypto.randomUUID());

  const bookings = new Map<string, BookingRecord>(); // id → record
  const byKey = new Map<string, BookingRecord>(); // tenant␀key → record
  const pendingByKey = new Map<string, Promise<BookingRecord>>(); // in-flight reservations
  const history: BookingStateChange[] = [];
  const bookingByIntent = new Map<string, string>(); // intentId → bookingId
  const intentByBooking = new Map<string, string>(); // bookingId → intentId
  const paymentAttemptByKey = new Map<string, number>(); // idemKey → attempts so far
  const references = new Set<string>();

  function idemKey(tenantId: string, idempotencyKey: string): string {
    return JSON.stringify([tenantId, idempotencyKey]);
  }

  function newReference(seed: string): string {
    for (let attempt = 0; ; attempt++) {
      const ref = `LMN-${crockford6(`${seed}:${attempt}`)}`;
      if (!references.has(ref)) {
        references.add(ref);
        return ref;
      }
    }
  }

  function applyTransition(record: BookingRecord, to: BookingState, reason?: string): BookingRecord {
    const allowed = BOOKING_TRANSITIONS[record.state];
    if (!allowed.includes(to)) {
      throw new BookingError("ILLEGAL_TRANSITION", `cannot transition ${record.state} → ${to}`);
    }
    const at = now();
    history.push({ bookingId: record.id, from: record.state, to, at, reason });
    record.state = to;
    record.updatedAt = at;
    if (to === "confirmed" && record.paymentId === null) {
      record.paymentId = idFactory();
    }
    return record;
  }

  function slotWindow(service: Service, slotStart: string, rentalPeriods?: number): { durationMinutes: number; end: string } {
    const durationMinutes =
      service.archetype === "rental" && service.rental
        ? service.rental.periodMinutes * (rentalPeriods ?? 1)
        : service.durationMinutes;
    const end = new Date(new Date(slotStart).getTime() + durationMinutes * 60_000).toISOString();
    return { durationMinutes, end };
  }

  function activeHolds(tenantId: string): CapacityHold[] {
    const holds: CapacityHold[] = [];
    for (const b of bookings.values()) {
      if (b.tenantId === tenantId && (b.state === "pending_payment" || b.state === "confirmed")) {
        holds.push({ start: b.slotStart, end: b.slotEnd });
      }
    }
    return holds;
  }

  /**
   * Synchronous core of createBooking: validates, reprices, verifies
   * availability, and inserts the pending_payment record BEFORE any await so
   * concurrent calls observe each other's capacity holds and idempotency
   * reservations.
   */
  function createSync(req: CreateBookingRequest): BookingRecord {
    const service = opts.services.find((s) => s.id === req.selection.serviceId && s.tenantId === req.tenantId);
    if (!service) throw new BookingError("SERVICE_NOT_FOUND");
    if (!service.active) throw new BookingError("SERVICE_INACTIVE");

    // SI-1: server-side reprice — the request carries no prices at all.
    const priced = pricing.price(service, req.selection);

    // D2: the amount charged now (total + deposit) must be a positive, exact
    // integer. Reject before any booking or intent is created so a mispriced
    // selection can never open a payment intent for ≤ 0.
    const chargeAmount = addMoney(priced.total, priced.deposit);
    if (!Number.isSafeInteger(chargeAmount.amount) || chargeAmount.amount <= 0) {
      throw new PaymentError("PAYMENT_AMOUNT_MISMATCH", "charge amount must be a positive integer");
    }

    const { durationMinutes, end: slotEnd } = slotWindow(service, req.slotStart, req.selection.rentalPeriods);

    // SI-7: fail-closed availability check before any payment commitment.
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: opts.tenantTimezone });
    } catch {
      throw new BookingError("AVAILABILITY_UNVERIFIABLE", "invalid tenant timezone");
    }
    if (opts.rules.length === 0) {
      throw new BookingError("AVAILABILITY_UNVERIFIABLE", "no availability rules configured");
    }
    const query: AvailabilityQuery = {
      tenantTimezone: opts.tenantTimezone,
      serviceId: service.id,
      durationMinutes,
      policy: opts.policy,
      rules: opts.rules,
      overrides: opts.overrides,
      existing: activeHolds(req.tenantId),
      now: now(),
      from: req.slotStart,
      to: req.slotStart,
    };
    let available: boolean;
    try {
      available = availability.isSlotAvailable(query, req.slotStart);
    } catch {
      throw new BookingError("AVAILABILITY_UNVERIFIABLE");
    }
    if (!available) throw new BookingError("SLOT_UNAVAILABLE");

    const id = idFactory();
    const createdAt = now();
    const record: BookingRecord = {
      id,
      tenantId: req.tenantId,
      reference: newReference(id),
      state: "draft",
      selection: req.selection,
      pricing: priced,
      slotStart: new Date(req.slotStart).toISOString(),
      slotEnd,
      customer: req.customer,
      address: req.address,
      paymentId: null,
      idempotencyKey: req.idempotencyKey,
      createdAt,
      updatedAt: createdAt,
    };
    bookings.set(id, record);
    byKey.set(idemKey(req.tenantId, req.idempotencyKey), record);
    applyTransition(record, "pending_payment", "availability verified");
    return record;
  }

  async function createWithPayment(
    req: CreateBookingRequest,
    record: BookingRecord,
    paymentIdempotencyKey: string,
  ): Promise<BookingRecord> {
    // Amount charged now = server-computed total + deposit (SI-1). Already
    // validated as a positive safe integer in createSync (D2).
    const chargeAmount = addMoney(record.pricing.total, record.pricing.deposit);
    try {
      const intent = await opts.payments.createIntent({
        tenantId: req.tenantId,
        bookingId: record.id,
        amount: chargeAmount,
        // A superseding retry after a failed payment (D5) uses an
        // attempt-scoped key so the provider mints a FRESH intent instead of
        // returning the dead one; the first attempt reuses the booking key.
        idempotencyKey: paymentIdempotencyKey,
        metadata: { reference: record.reference },
      });
      bookingByIntent.set(intent.intentId, record.id);
      intentByBooking.set(record.id, intent.intentId);
      return record;
    } catch {
      applyTransition(record, "failed", "PAYMENT_FAILED");
      return record;
    }
  }

  return {
    async createBooking(rawReq: CreateBookingRequest): Promise<BookingRecord> {
      const parsed = CreateBookingRequest.safeParse(rawReq);
      if (!parsed.success) {
        throw new BookingError("INVALID_REQUEST", parsed.error.issues[0]?.message);
      }
      const req = parsed.data;
      const key = idemKey(req.tenantId, req.idempotencyKey);

      // Idempotency — all checks and the reservation happen synchronously,
      // before any await, so a concurrent duplicate submit joins the winner.
      // The in-flight reservation is kept regardless (kills the race window).
      const inFlight = pendingByKey.get(key);
      if (inFlight) return inFlight;
      const settled = byKey.get(key);
      if (settled) {
        // D5: a booking stuck in terminal `failed` (payment failure) must not
        // poison the key forever. Supersede it: drop the dead reservation so a
        // fresh booking + intent can be created under the same key. Any other
        // settled state is returned as-is (true idempotency).
        if (settled.state === "failed") {
          byKey.delete(key);
          bookings.delete(settled.id);
        } else {
          return settled;
        }
      }

      // Attempt-scoped payment key: the first attempt reuses the booking key;
      // a supersede after failure derives a fresh one so the provider issues a
      // brand-new intent rather than returning the dead (failed) one.
      const attempt = paymentAttemptByKey.get(key) ?? 0;
      const paymentIdempotencyKey = attempt === 0 ? req.idempotencyKey : `${req.idempotencyKey}#retry${attempt}`;
      paymentAttemptByKey.set(key, attempt + 1);

      // Sync: reserves the slot + idempotency key; throws reserve nothing.
      const record = createSync(req);
      const promise = createWithPayment(req, record, paymentIdempotencyKey).finally(() => {
        pendingByKey.delete(key);
      });
      pendingByKey.set(key, promise);
      return promise;
    },

    async transition(bookingId: string, to: BookingState, reason?: string): Promise<BookingRecord> {
      const record = bookings.get(bookingId);
      if (!record) throw new BookingError("BOOKING_NOT_FOUND");
      // Defense-in-depth (RC-2 / RISK-1): confirmation is payment-authoritative.
      // The generic transition path must NEVER mint a `confirmed` booking — that
      // can only happen through confirmFromPayment, which verifies the payment
      // intent with the provider first. Refusing here mirrors the DB guard that
      // forbids portal clients from driving a booking into `confirmed`.
      if (to === "confirmed") {
        throw new BookingError(
          "ILLEGAL_TRANSITION",
          "confirmation is payment-authoritative; confirm only via confirmFromPayment (which verifies the payment)",
        );
      }
      return applyTransition(record, to, reason);
    },

    async confirmFromPayment(intentId: string): Promise<BookingRecord> {
      // Map intent → booking from the engine's own registry. An intent we never
      // minted (bogus/foreign id) can never confirm anything (D1).
      const bookingId = bookingByIntent.get(intentId);
      if (!bookingId) throw new PaymentError("INVALID_REQUEST", "unknown payment intent");
      const record = bookings.get(bookingId);
      if (!record) throw new PaymentError("INVALID_REQUEST", "payment intent maps to no live booking");
      if (record.state === "confirmed") return record; // idempotent (SI-3)

      // SI-2/SI-3: payment state is server-authoritative — verify with the
      // provider. NEVER confirm on the strength of the caller's word alone.
      const intent = await opts.payments.getIntent(intentId);
      if (!intent) throw new PaymentError("INVALID_REQUEST", "payment intent not found at provider");

      if (intent.state === "failed") {
        // A real payment failure moves the booking to terminal `failed`.
        if (record.state === "pending_payment") {
          applyTransition(record, "failed", "PAYMENT_FAILED");
        }
        throw new PaymentError("PAYMENT_FAILED", "payment failed");
      }
      if (intent.state !== "succeeded") {
        // Not yet settled — do NOT confirm.
        throw new PaymentError("PAYMENT_FAILED", `payment not settled (state=${intent.state})`);
      }

      if (record.state !== "pending_payment") {
        throw new BookingError("ILLEGAL_TRANSITION", `cannot confirm from ${record.state}`);
      }
      return applyTransition(record, "confirmed", `payment_succeeded:${intentId}`);
    },

    intentIdForBooking(bookingId: string): string | null {
      return intentByBooking.get(bookingId) ?? null;
    },

    listBookings(tenantId: string): BookingRecord[] {
      return [...bookings.values()].filter((b) => b.tenantId === tenantId);
    },

    getBooking(id: string): BookingRecord | null {
      return bookings.get(id) ?? null;
    },

    getHistory(bookingId: string): BookingStateChange[] {
      return history.filter((h) => h.bookingId === bookingId);
    },
  };
}
