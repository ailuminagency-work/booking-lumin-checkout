/** Mock aggregates only: no AuditEvent.data, error strings, labels, or network.
 * The caller must bind the tenant from authenticated context before creating
 * this scope. This in-memory model is not an authorization boundary or collector.
 */
export const COUNTERS = ["bookings_confirmed", "bookings_failed", "payments_failed", "deliveries_failed"] as const;
export const COMPONENTS = ["checkout", "payments", "calendar", "notifications"] as const;
export const HEALTH_STATUSES = ["unknown", "healthy", "degraded", "unavailable", "not_connected"] as const;
export type Counter = typeof COUNTERS[number];
export type Component = typeof COMPONENTS[number];
export type HealthStatus = typeof HEALTH_STATUSES[number];

export interface HealthSnapshot {
  readonly tenantId: string;
  readonly mode: "mock";
  readonly counters: Readonly<Record<Counter, number>>;
  readonly components: Readonly<Record<Component, HealthStatus>>;
}

const invalid = (): never => { throw new Error("INVALID_TELEMETRY_INPUT"); };

/** Fail closed rather than trying to redact unknown arbitrary payloads. */
function fields(input: unknown, names: readonly string[]): Record<string, string> {
  if (typeof input !== "object" || input === null) return invalid();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key))) return invalid();
  const result: Record<string, string> = Object.create(null);
  for (const name of names) {
    const property = Object.getOwnPropertyDescriptor(input, name);
    if (!property || !("value" in property) || typeof property.value !== "string") return invalid();
    result[name] = property.value;
  }
  return result;
}

export function createMockTenantHealth(tenantId: string) {
  if (typeof tenantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return invalid();
  const counters: Record<Counter, number> = { bookings_confirmed: 0, bookings_failed: 0, payments_failed: 0, deliveries_failed: 0 };
  const components: Record<Component, HealthStatus> = { checkout: "unknown", payments: "not_connected", calendar: "not_connected", notifications: "not_connected" };
  return {
    increment(input: unknown): void {
      const { counter } = fields(input, ["counter"]);
      if (!COUNTERS.includes(counter as Counter)) return invalid();
      const key = counter as Counter;
      if (counters[key] === Number.MAX_SAFE_INTEGER) throw new Error("TELEMETRY_COUNTER_LIMIT");
      counters[key] += 1;
    },
    setStatus(input: unknown): void {
      const { component, status } = fields(input, ["component", "status"]);
      if (!COMPONENTS.includes(component as Component) || !HEALTH_STATUSES.includes(status as HealthStatus)) return invalid();
      components[component as Component] = status as HealthStatus;
    },
    snapshot(): HealthSnapshot {
      return Object.freeze({ tenantId, mode: "mock" as const, counters: Object.freeze({ ...counters }), components: Object.freeze({ ...components }) });
    },
  };
}
