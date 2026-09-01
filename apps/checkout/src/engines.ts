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
 * Drive the booking to `confirmed` after payment — the ONLY confirmation path.
 *
 * Confirmation flows exclusively through the payment-verifying
 * `confirmFromPayment(intentId)`: the engine re-checks with the provider that
 * the intent actually succeeded before transitioning. There is deliberately NO
 * unconditional `transition(..., "confirmed")` fallback — that was a
 * free-confirmation hole (a booking could reach `confirmed` with no successful
 * payment). If verification fails, the error propagates and the caller surfaces
 * it as a payment failure; the booking is NEVER confirmed on error.
 */
export async function confirmBookingAfterPayment(intentId: string): Promise<BookingRecord> {
  return bookingEngine.confirmFromPayment(intentId);
}
