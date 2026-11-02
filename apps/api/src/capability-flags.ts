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
