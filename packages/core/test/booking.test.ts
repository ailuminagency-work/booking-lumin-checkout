import { describe, expect, it } from "vitest";
import { BookingError, CreateBookingRequest, CustomerDetails } from "@lumin/contracts";
import { createMockPaymentProvider, signMockWebhook } from "@lumin/adapters";
import { createBookingEngine } from "../src/booking";
import { makeService, policy, rule, TENANT, uuid } from "./helpers";

const SERVICE = uuid(30);
const INACTIVE = uuid(31);
const SLOT = "2026-01-05T16:00:00.000Z"; // Mon 10:00 CST
const NOW = "2026-01-04T00:00:00.000Z";

const customer: CustomerDetails = { name: "Ada Lovelace", email: "ada@example.com" };

function makeEngine(overrides: { capacity?: number; rules?: [] } = {}) {
  const payments = createMockPaymentProvider();
  const engine = createBookingEngine({
    services: [
      makeService({ id: SERVICE, basePrice: 12_000, taxRateBp: 500 }),
      makeService({ id: INACTIVE, active: false }),
    ],
    rules:
      overrides.rules ??
      [1, 2, 3, 4, 5].map((weekday) =>
        rule({ weekday, startMinute: 540, endMinute: 1020, capacity: overrides.capacity ?? 1 }),
      ),
    overrides: [],
    policy: policy(),
    tenantTimezone: "America/Chicago",
    payments,
    now: () => NOW,
  });
  return { engine, payments };
}

function request(over: Partial<CreateBookingRequest> = {}): CreateBookingRequest {
  return {
    tenantId: TENANT,
    idempotencyKey: "checkout-key-0000000001",
    selection: { serviceId: SERVICE, itemQuantities: {}, addonIds: [], answers: {} },
    slotStart: SLOT,
    customer,
    ...over,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable(`expected BookingError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe(code);
  }
}

describe("booking: happy path", () => {
  it("reprices server-side, charges total+deposit, and confirms via verified webhook", async () => {
    const { engine, payments } = makeEngine();
    const record = await engine.createBooking(request());
    expect(record.state).toBe("pending_payment");
    expect(record.reference).toMatch(/^LMN-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    // server-computed price: 12000 + 5% tax = 12600
    expect(record.pricing.total).toEqual({ amount: 12_600, currency: "USD" });
    const intent = payments.listIntents()[0]!;
    expect(intent.amount.amount).toBe(12_600); // total + deposit(0), never a client number
    expect(intent.clientToken).toBe(`mock_tok_${intent.intentId}`);

    payments.completePayment(intent.intentId, "succeeded");
    const payload = JSON.stringify({ kind: "payment_succeeded", intentId: intent.intentId });
    const event = await payments.parseWebhook(payload, signMockWebhook(payload));
    expect(event.kind).toBe("payment_succeeded");

    const confirmed = engine.confirmFromPayment(event.intentId!);
    expect(confirmed.id).toBe(record.id);
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.paymentId).not.toBeNull();
    expect(engine.getHistory(record.id).map((h) => `${h.from}>${h.to}`)).toEqual([
      "draft>pending_payment",
      "pending_payment>confirmed",
    ]);
  });

  it("ignores client-smuggled price fields (no such inputs exist in the API)", async () => {
    const { engine } = makeEngine();
    const tampered = {
      ...request(),
      pricing: { total: { amount: 1, currency: "USD" } },
      total: 1,
    } as unknown as CreateBookingRequest;
    const record = await engine.createBooking(tampered);
    expect(record.pricing.total.amount).toBe(12_600); // server-priced regardless
  });
});

describe("booking: idempotency and races", () => {
  it("returns the same record for the same (tenantId, idempotencyKey) — one intent only", async () => {
    const { engine, payments } = makeEngine();
    const a = await engine.createBooking(request());
    const b = await engine.createBooking(request());
    expect(b.id).toBe(a.id);
    expect(payments.listIntents()).toHaveLength(1);
  });

  it("duplicate-submit race: two concurrent calls with one key join one booking", async () => {
    const { engine, payments } = makeEngine();
    const [a, b] = await Promise.all([engine.createBooking(request()), engine.createBooking(request())]);
    expect(a.id).toBe(b.id);
    expect(payments.listIntents()).toHaveLength(1);
    expect(engine.listBookings(TENANT)).toHaveLength(1);
  });

  it("double-booking race: two customers, last slot, capacity 1 → exactly one wins", async () => {
    const { engine } = makeEngine({ capacity: 1 });
    const results = await Promise.allSettled([
      engine.createBooking(request({ idempotencyKey: "customer-a-key-000001" })),
      engine.createBooking(
        request({ idempotencyKey: "customer-b-key-000001", customer: { name: "Bob", email: "bob@example.com" } }),
      ),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0]!.reason as BookingError).code).toBe("SLOT_UNAVAILABLE");
  });

  it("confirmFromPayment is idempotent — one payment, at most one confirmation", async () => {
    const { engine, payments } = makeEngine();
    const record = await engine.createBooking(request());
    const intent = payments.listIntents()[0]!;
    payments.completePayment(intent.intentId, "succeeded");
    const first = engine.confirmFromPayment(intent.intentId);
    const second = engine.confirmFromPayment(intent.intentId);
    expect(second.id).toBe(first.id);
    expect(second.paymentId).toBe(first.paymentId);
    expect(engine.getHistory(record.id).filter((h) => h.to === "confirmed")).toHaveLength(1);
  });
});

describe("booking: validation and fail-closed availability", () => {
  it("rejects unknown, inactive, and unavailable bookings with typed codes", async () => {
    const { engine } = makeEngine();
    await expectCode(
      engine.createBooking(request({ selection: { serviceId: uuid(99), itemQuantities: {}, addonIds: [], answers: {} } })),
      "SERVICE_NOT_FOUND",
    );
    await expectCode(
      engine.createBooking(
        request({ selection: { serviceId: INACTIVE, itemQuantities: {}, addonIds: [], answers: {} } }),
      ),
      "SERVICE_INACTIVE",
    );
    // Sunday — outside every weekly window
    await expectCode(engine.createBooking(request({ slotStart: "2026-01-04T16:00:00.000Z" })), "SLOT_UNAVAILABLE");
  });

  it("fails closed with AVAILABILITY_UNVERIFIABLE when no rules are configured", async () => {
    const { engine } = makeEngine({ rules: [] });
    await expectCode(engine.createBooking(request()), "AVAILABILITY_UNVERIFIABLE");
  });

  it("marks the booking failed with PAYMENT_FAILED when intent creation fails", async () => {
    const { engine, payments } = makeEngine();
    payments.armFailure();
    const record = await engine.createBooking(request());
    expect(record.state).toBe("failed");
    expect(engine.getHistory(record.id).at(-1)?.reason).toBe("PAYMENT_FAILED");
  });
});

describe("booking: state machine", () => {
  it("enforces BOOKING_TRANSITIONS strictly", async () => {
    const { engine, payments } = makeEngine();
    const record = await engine.createBooking(request());
    await expectCode(engine.transition(record.id, "completed"), "ILLEGAL_TRANSITION"); // pending → completed
    const intent = payments.listIntents()[0]!;
    engine.confirmFromPayment(intent.intentId);
    await expectCode(engine.transition(record.id, "pending_payment"), "ILLEGAL_TRANSITION");
    await engine.transition(record.id, "completed");
    await engine.transition(record.id, "refunded", "customer complaint");
    await expectCode(engine.transition(record.id, "confirmed"), "ILLEGAL_TRANSITION"); // refunded is terminal
    expect(engine.getBooking(record.id)?.state).toBe("refunded");
  });
});
