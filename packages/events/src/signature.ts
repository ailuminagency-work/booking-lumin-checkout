/**
 * signature — sign and verify outbound webhook bodies.
 *
 * Scheme (mirrors the Stripe adapter, packages/adapters/src/stripePayment.ts):
 *   header = `t=<unix-seconds>,v1=<hex hmac_sha256(secret, "<t>.<body>")>`
 *
 * Binding the timestamp INTO the signed string makes the signature both
 * forgery-resistant (needs the secret) and replay-resistant (a stale/future
 * timestamp is rejected by the skew window at verify time). Verification is
 * constant-time.
 */

import { constantTimeEqual, hmacSha256Hex } from "./crypto";

/** Default clock-skew tolerance for a delivery timestamp: 5 minutes. */
export const DEFAULT_SKEW_SECONDS = 5 * 60;

/** Header name carrying the signature on an outbound delivery. */
export const SIGNATURE_HEADER = "x-lumin-signature";

/**
 * Produce the signature header value for `body`, signed with `secret` at unix
 * `tsSeconds`. Scheme: `t=<ts>,v1=<hex hmac_sha256(secret,"<ts>.<body>")>`.
 */
export function buildSignatureHeader(body: string, secret: string, tsSeconds: number): string {
  const signature = hmacSha256Hex(secret, `${tsSeconds}.${body}`);
  return `t=${tsSeconds},v1=${signature}`;
}

/** Parse a `t=…,v1=…[,v1=…]` header into its timestamp and v1 signatures. */
export function parseSignatureHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const parsed = Number(value);
      t = Number.isFinite(parsed) ? parsed : null;
    } else if (key === "v1") {
      v1.push(value);
    }
  }
  return { t, v1 };
}

export interface VerifyOptions {
  /** Clock-skew tolerance in seconds (default 5 minutes). */
  skewSeconds?: number;
}

/**
 * Verify a signature header over `body`. Returns true ONLY when the header is
 * well-formed, its timestamp is within the skew window of `nowMs` (replay
 * resistance), and a v1 signature matches the recomputed HMAC (constant-time).
 *
 * A forged signature, a body tampered after signing, a wrong secret, or a
 * timestamp outside the window all return false.
 */
export function verifySignature(
  body: string,
  header: string | null,
  secret: string,
  nowMs: number,
  opts?: VerifyOptions,
): boolean {
  if (header === null || header === "") return false;
  const { t, v1 } = parseSignatureHeader(header);
  if (t === null || v1.length === 0) return false;

  const skew = opts?.skewSeconds ?? DEFAULT_SKEW_SECONDS;
  const nowSec = Math.floor(nowMs / 1000);
  // Reject stale or future deliveries: the coarse replay window.
  if (Math.abs(nowSec - t) > skew) return false;

  const expected = hmacSha256Hex(secret, `${t}.${body}`);
  return v1.some((candidate) => constantTimeEqual(candidate, expected));
}
