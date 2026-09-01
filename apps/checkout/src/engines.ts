import { createAvailabilityEngine, createBookingEngine } from "@lumin/core";
import { createMockPaymentProvider } from "@lumin/adapters";
import type { BookingRecord, CapacityHold } from "@lumin/contracts";
import { overrides, policy, rules, services, tenant, TENANT_ID } from "./config/demoTenant";

/**
 * The ONLY module that wires @lumin/core + @lumin/adapters together.
 * Steps import engines from here so the integration surface stays small.
 */

export const availabilityEngine = createAvailabilityEngine();

export const paymentProvider = createMockPaymentProvider();

export const bookingEngine = createBookingEngine({
  services,
  rules,
  overrides,
  policy,
  tenantTimezone: tenant.timezone,
  payments: paymentProvider,
});

/** Existing commitments that consume capacity, from the engine's own store. */
export async function listExistingHolds(): Promise<CapacityHold[]> {
  try {
    const bookings = (await Promise.resolve(
      bookingEngine.listBookings(TENANT_ID),
    )) as BookingRecord[] | null | undefined;
    if (!Array.isArray(bookings)) return [];
    return bookings
      .filter((b) => b.state === "pending_payment" || b.state === "confirmed")
      .map((b) => ({ start: b.slotStart, end: b.slotEnd }));
  } catch {
    // Fail open here is safe: the engine re-verifies (fail-closed) at createBooking.
    return [];
  }
}

/**
 * Drive the booking to `confirmed` after the mock provider reports success.
 * Prefers `confirmFromPayment(intentId)`; a retried payment uses an intent
 * the engine didn't create itself, so we fall back to the contract-guaranteed
 * `transition()`. If the booking somehow got confirmed already (idempotent
 * webhook-style handling), getBooking detects that instead of erroring.
 */
export async function confirmBookingAfterPayment(
  bookingId: string,
  intentId: string,
): Promise<BookingRecord> {
  try {
    return await Promise.resolve(bookingEngine.confirmFromPayment(intentId));
  } catch {
    // Intent unknown to the engine (retry intent) — use the state machine.
  }
  try {
    return await bookingEngine.transition(bookingId, "confirmed", "mock payment succeeded");
  } catch (err) {
    try {
      const booking = (await Promise.resolve(
        bookingEngine.getBooking(bookingId),
      )) as BookingRecord | null;
      if (booking && booking.state === "confirmed") return booking;
    } catch {
      // fall through to the original error
    }
    throw err;
  }
}
