/**
 * Production-legal capability flags.
 *
 * Gap G1: nearly every product capability used to compose only when
 * BOOKING_LUMIN_ENV==='staging', so a production-mode deploy answered
 * UNSUPPORTED_CONFIG across the whole owner -> publish -> book -> confirm flow.
 * Capability availability and environment are different questions, and tying
 * them together made "production ready" unreachable by construction.
 *
 * A capability flag is therefore legal in ANY environment and DEFAULT-CLOSED:
 * only the exact string '1' enables it, so an absent, empty, 'true' or '0'
 * value leaves the capability off.
 *
 * This is deliberately NOT how fake payments are gated. `mockPaymentsEnabled`
 * (mock-payment.ts) stays environment-bound and keeps THROWING when
 * BOOKING_LUMIN_FAKE_PAYMENTS='1' outside staging, so simulated money can
 * never be enabled in production. Nothing here weakens or replaces that gate:
 * these flags govern product capabilities only, never a payment surface.
 */
export function capabilityEnabled(env: Record<string, string | undefined>, flag: string): boolean {
  return env[flag] === '1';
}

/**
 * The paid publication family: publishing and reading published flows, install
 * health, version history and rollback. None of these take or simulate a
 * payment — they were previously composed inside the fake-payment gate, which
 * is why an owner could not publish (or even read their own publication) in a
 * production-mode deploy.
 */
export function paidPublicationEnabled(env: Record<string, string | undefined>): boolean {
  return capabilityEnabled(env, 'BOOKING_LUMIN_PAID_PUBLICATION');
}

/**
 * The owner booking operations family: the list, the detail view with its
 * answers and activity trail, and owner cancellation.
 *
 * These were gated on BOOKING_LUMIN_ENV==='staging' with no flag at all, so the
 * "owner sees and manages the booking" end of the loop was unreachable in
 * production by construction -- the same shape as the G1 publication defect, in
 * the one place a real business cannot do without. A housekeeping owner who
 * cannot open or cancel a booking has no business running on this.
 *
 * None of these takes, simulates or moves money. Cancellation is explicitly
 * NOT a refund: owner-booking-cancel.ts asserts refundIssued:false and never
 * touches payments, refunds or capacity. A cancelled booking may remain paid --
 * the business decides what happens to the money, outside Booking Lumin.
 */
export function ownerBookingOperationsEnabled(env: Record<string, string | undefined>): boolean {
  return capabilityEnabled(env, 'BOOKING_LUMIN_OWNER_BOOKING_OPS');
}
