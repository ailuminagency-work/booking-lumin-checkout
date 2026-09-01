import {
  AvailabilityOverride,
  AvailabilityRule,
  SchedulingPolicy,
  Service,
} from "@lumin/contracts";

/** Deterministic valid UUIDs for fixtures. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export const TENANT = uuid(1);

export function makeService(overrides: Partial<Service> & { id: string }): Service {
  return {
    tenantId: TENANT,
    archetype: "simple",
    name: "Service",
    description: "",
    currency: "USD",
    basePrice: 0,
    durationMinutes: 60,
    items: [],
    addons: [],
    questions: [],
    taxRateBp: 0,
    active: true,
    ...overrides,
  };
}

export function rule(
  overrides: Partial<AvailabilityRule> & { weekday: number; startMinute: number; endMinute: number },
): AvailabilityRule {
  return {
    id: uuid(900 + overrides.weekday),
    tenantId: TENANT,
    serviceId: null,
    capacity: 1,
    ...overrides,
  };
}

export function override(
  overrides: Partial<AvailabilityOverride> & { date: string; kind: "closed" | "open" },
): AvailabilityOverride {
  return {
    id: uuid(800),
    tenantId: TENANT,
    serviceId: null,
    ...overrides,
  };
}

export function policy(overrides: Partial<SchedulingPolicy> = {}): SchedulingPolicy {
  return { leadTimeMinutes: 0, horizonDays: 60, slotIntervalMinutes: 60, ...overrides };
}
