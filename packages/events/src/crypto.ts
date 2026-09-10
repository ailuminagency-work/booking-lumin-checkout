/**
 * crypto — HMAC-SHA256 signing primitives for outbound webhook delivery.
 *
 * Unlike the DEV mock payment provider (which must run in the browser and
 * therefore ships its own pure-JS SHA-256), @lumin/events is a SERVER-SIDE
 * dispatch engine: it runs only in trusted server runtime, so it uses Node's
 * audited `node:crypto`. No new npm dependency is introduced.
 *
 * The signing scheme mirrors the Stripe adapter: the signed string is
 * `"<timestamp>.<body>"` and verification is constant-time.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256(secret, message) → lowercase hex. */
export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/**
 * Constant-time string comparison. Returns false for length mismatch without
 * leaking timing; equal-length inputs are compared with `timingSafeEqual`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
