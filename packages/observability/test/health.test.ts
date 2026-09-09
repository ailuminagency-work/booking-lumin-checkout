import { describe, expect, it } from "vitest";
import { createMockTenantHealth, COUNTERS, COMPONENTS, HEALTH_STATUSES } from "../src/index";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("mock tenant health", () => {
  it("starts unverified and disconnected, then aggregates only explicit mock observations", () => {
    const health = createMockTenantHealth(A);
    expect(health.snapshot().components).toEqual({ checkout: "unknown", payments: "not_connected", calendar: "not_connected", notifications: "not_connected" });
    health.increment({ counter: "bookings_confirmed" });
    health.increment({ counter: "bookings_confirmed" });
    health.setStatus({ component: "checkout", status: "degraded" });
    expect(health.snapshot().counters.bookings_confirmed).toBe(2);
    expect(health.snapshot().components.checkout).toBe("degraded");
    expect(health.snapshot().mode).toBe("mock");
  });

  it("cannot address a different tenant from a bound scope", () => {
    const a = createMockTenantHealth(A), b = createMockTenantHealth(B);
    a.increment({ counter: "payments_failed" });
    expect(() => a.increment({ counter: "payments_failed", tenantId: B })).toThrow("INVALID_TELEMETRY_INPUT");
    expect(() => a.setStatus({ component: "checkout", status: "healthy", tenantId: B })).toThrow();
    expect(a.snapshot().tenantId).toBe(A);
    expect(b.snapshot().counters.payments_failed).toBe(0);
  });

  it.each([
    { counter: "payments_failed", email: "private@example.test" },
    { counter: "payments_failed", data: { token: "private-token" } },
    { counter: "private@example.test" },
    { counter: "__proto__" },
    { counter: "constructor" },
    { counter: "payments_failed", amount: -1 },
    null, [], "private-token",
  ])("rejects arbitrary payloads without reflecting secrets or changing aggregates: %j", input => {
    const h = createMockTenantHealth(A), before = h.snapshot();
    expect(() => h.increment(input)).toThrow(/^INVALID_TELEMETRY_INPUT$/);
    expect(h.snapshot()).toEqual(before);
    expect(JSON.stringify(h.snapshot())).not.toContain("private");
  });

  it("rejects status error text, provider identifiers, and invalid status strings", () => {
    const h = createMockTenantHealth(A);
    for (const input of [
      { component: "payments", status: "degraded", error: "private-token" },
      { component: "private@example.test", status: "healthy" },
      { component: "payments", status: "private-token" },
    ]) expect(() => h.setStatus(input)).toThrow(/^INVALID_TELEMETRY_INPUT$/);
    expect(h.snapshot().components.payments).toBe("not_connected");
  });

  it("rejects inherited fields, symbol extras and accessors without invoking getters", () => {
    const h = createMockTenantHealth(A);
    let read = false;
    const accessor = { get counter() { read = true; return "payments_failed"; } };
    for (const input of [Object.create({ counter: "payments_failed" }), { counter: "payments_failed", [Symbol("secret")]: "private" }, accessor]) {
      expect(() => h.increment(input)).toThrow();
    }
    expect(read).toBe(false);
    expect(h.snapshot().counters.payments_failed).toBe(0);
  });

  it("returns immutable detached snapshots", () => {
    const h = createMockTenantHealth(A), old = h.snapshot();
    expect(() => Object.assign(old.counters, { payments_failed: 999 })).toThrow();
    expect(() => Object.assign(old.components, { payments: "healthy" })).toThrow();
    h.increment({ counter: "payments_failed" });
    expect(old.counters.payments_failed).toBe(0);
    expect(h.snapshot().counters.payments_failed).toBe(1);
  });

  it("rejects PII tenant labels instead of persisting them", () => {
    expect(() => createMockTenantHealth("private@example.test")).toThrow(/^INVALID_TELEMETRY_INPUT$/);
  });
});


describe("allowlist integrity", () => {
  it("cannot mutate any exported allowlist to persist arbitrary labels", () => {
    for (const list of [COUNTERS, COMPONENTS, HEALTH_STATUSES]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect(() => (list as unknown as string[]).push("private@example.test")).toThrow();
      expect(() => Object.assign(list, { 0: "private@example.test" })).toThrow();
    }
    const h = createMockTenantHealth(A);
    expect(() => h.increment({ counter: "private@example.test" })).toThrow();
    expect(() => h.setStatus({ component: "private@example.test", status: "healthy" })).toThrow();
    expect(() => h.setStatus({ component: "checkout", status: "private@example.test" })).toThrow();
    expect(JSON.stringify(h.snapshot())).not.toContain("private@example.test");
  });
});
