/** Deterministic valid UUIDs for fixtures (mirrors the media/core helper). */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Neutral demo tenants — never a real business name (contamination invariant). */
export const TENANT_A = uuid(9001);
export const TENANT_B = uuid(9002);

/** Fixed server signing key for deterministic OAuth state tests. */
export const SERVER_KEY = "test-server-key-not-a-real-secret";

/** A fixed clock (epoch ms) so expiry math is deterministic. */
export const NOW = Date.parse("2026-09-07T12:00:00.000Z");
