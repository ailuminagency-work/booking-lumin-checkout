import { describe, expect, it } from "vitest";
import { BookingError, AvailabilityRule, SchedulingPolicy } from "@lumin/contracts";
import { createMockPaymentProvider } from "@lumin/adapters";
import { createBookingEngine } from "@lumin/core";
import { DEMO_TENANT, DEMO_TIMEZONE, templateCases, uuid } from "./fixtures";

/**
 * Phase A golden-flow harness.
 *
 * These cases intentionally drive the same server-authoritative booking
 * engine used by every service template. They are deterministic local
 * fixtures today, so the same journey assertions can later be attached to a
 * staging HTTP adapter without changing the business assertions.
 */
const NOW = "2026-01-04T00:00:00.000Z";
const SLOT_START = "2026-01-05T16:00:00.000Z";
const policy: SchedulingPolicy = { leadTimeMinutes: 0, horizonDays: 60, slotIntervalMinutes: 60 };
const rules: AvailabilityRule[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  id: uuid(1_000 + weekday),
  tenantId: DEMO_TENANT,
  serviceId: null,
  weekday,
  startMinute: 0,
  endMinute: 1440,
  capacity: 1,
}));

function setup(key: string) {
  const fixture = templateCases().find((candidate) => candidate.key === key);
  if (!fixture) throw new Error(`missing golden-flow fixture: ${key}`);
  const payments = createMockPaymentProvider({ webhookSecret: "golden-flow-test-secret" });
  const engine = createBookingEngine({
    services: [fixture.service],
    rules,
    overrides: [],
    policy,
    tenantTimezone: DEMO_TIMEZONE,
    payments,
    now: () => NOW,
  });
  return { fixture, engine, payments };
}

function request(fixture: ReturnType<typeof templateCases>[number], idempotencyKey: string, email: string) {
  return {
    tenantId: DEMO_TENANT,
    idempotencyKey,
    selection: fixture.selection,
    slotStart: SLOT_START,
    customer: { name: "Golden Flow Customer", email },
    address: { line1: "1 Test Street", city: "Seattle", region: "WA", postalCode: "98101", country: "US" },
  };
}

async function confirm(
  engine: ReturnType<typeof createBookingEngine>,
  payments: ReturnType<typeof createMockPaymentProvider>,
  bookingId: string,
) {
  const intentId = engine.intentIdForBooking(bookingId);
  expect(intentId).not.toBeNull();
  payments.completePayment(intentId!, "succeeded");
  return engine.confirmFromPayment(intentId!);
}

describe("Phase A golden booking flows", () => {
  it("housekeeping: profile/service/price/availability/hold/booking/confirmation", async () => {
    const { fixture, engine, payments } = setup("housekeeping");
    const firstRequest = request(fixture, "golden-housekeeping-000001", "housekeeping@example.test");

    const pending = await engine.createBooking(firstRequest);
    expect(pending.state).toBe("pending_payment");
    expect(pending.pricing.total.amount).toBe(fixture.total);
    expect(pending.address?.postalCode).toBe("98101");
    expect(engine.listBookings(DEMO_TENANT)).toHaveLength(1);
    expect(payments.listIntents()).toHaveLength(1);

    // A retry with the same key is the same authoritative hold and payment
    // attempt, rather than a second booking.
    const replay = await engine.createBooking(firstRequest);
    expect(replay.id).toBe(pending.id);
    expect(engine.listBookings(DEMO_TENANT)).toHaveLength(1);
    expect(payments.listIntents()).toHaveLength(1);

    const confirmed = await confirm(engine, payments, pending.id);
    expect(confirmed.state).toBe("confirmed");
    expect(engine.getHistory(pending.id).map((change) => `${change.from}>${change.to}`)).toEqual([
      "draft>pending_payment",
      "pending_payment>confirmed",
    ]);
  });

  it("detailing: vehicle/package/add-on selection is repriced and payment confirms it", async () => {
    const { fixture, engine, payments } = setup("car-detailing");
    const booking = await engine.createBooking(request(fixture, "golden-detailing-000001", "detailing@example.test"));
    expect(booking.state).toBe("pending_payment");
    expect(booking.pricing.total.amount).toBe(fixture.total);
    expect(payments.listIntents()[0]?.amount.amount).toBe(fixture.charge);

    // No caller can mint confirmation by selecting a state directly.
    await expect(engine.transition(booking.id, "confirmed")).rejects.toMatchObject({
      code: "ILLEGAL_TRANSITION",
    });
    expect(engine.getBooking(booking.id)?.state).toBe("pending_payment");

    const confirmed = await confirm(engine, payments, booking.id);
    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.paymentId).not.toBeNull();
  });

  it("vehicle rental: concurrent attempts produce one authoritative hold and one confirmation", async () => {
    const { fixture, engine, payments } = setup("vehicle-rental");
    const attempts = await Promise.allSettled([
      engine.createBooking(request(fixture, "golden-rental-000001", "renter-a@example.test")),
      engine.createBooking(request(fixture, "golden-rental-000002", "renter-b@example.test")),
    ]);
    const wins = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof engine.createBooking>>> => result.status === "fulfilled");
    const losses = attempts.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0]!.reason as BookingError).code).toBe("SLOT_UNAVAILABLE");

    const holds = engine.listBookings(DEMO_TENANT).filter((booking) => ["pending_payment", "confirmed"].includes(booking.state));
    expect(holds).toHaveLength(1);
    const confirmed = await confirm(engine, payments, wins[0]!.value.id);
    expect(confirmed.state).toBe("confirmed");
    expect(engine.listBookings(DEMO_TENANT).filter((booking) => booking.state === "confirmed")).toHaveLength(1);
    expect(payments.listIntents()).toHaveLength(1);
  });
});
