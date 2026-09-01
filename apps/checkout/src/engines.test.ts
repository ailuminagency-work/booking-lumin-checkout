import { describe, expect, it } from "vitest";
import { PaymentError } from "@lumin/contracts";
import { bookingEngine, confirmBookingAfterPayment } from "./engines";
import { TENANT_ID } from "./config/demoTenant";

/**
 * D1 (checkout glue): confirmBookingAfterPayment no longer has an
 * unconditional `transition(..., "confirmed")` fallback. An intent the engine
 * did not mint (bogus/foreign id) must NEVER silently confirm a booking — the
 * helper propagates the verification error instead.
 */
describe("engines: confirmBookingAfterPayment (D1)", () => {
  it("never confirms on an unknown/bogus intent id — it throws instead", async () => {
    await expect(confirmBookingAfterPayment("mpi_bogus_not_a_real_intent")).rejects.toBeInstanceOf(
      PaymentError,
    );
    // No booking was fabricated/confirmed as a side effect.
    expect(bookingEngine.listBookings(TENANT_ID).filter((b) => b.state === "confirmed")).toHaveLength(0);
  });
});
