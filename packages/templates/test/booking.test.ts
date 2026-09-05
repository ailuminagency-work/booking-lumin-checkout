import { describe, expect, it } from "vitest";
import { AvailabilityRule, SchedulingPolicy } from "@lumin/contracts";
import { createBookingEngine } from "@lumin/core";
import { createMockPaymentProvider } from "@lumin/adapters";
import { DEMO_TENANT, DEMO_TIMEZONE, templateCases, uuid } from "./fixtures";

/**
 * End-to-end proof: EVERY template drives the SAME booking engine from
 * draft → pending_payment → confirmed via the mock payment provider. The
 * engine is constructed identically for all verticals — no per-vertical wiring.
 */

// Full-day availability every weekday so any archetype's slot window fits.
const rules: AvailabilityRule[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  id: uuid(900 + weekday),
  tenantId: DEMO_TENANT,
  serviceId: null,
  weekday,
  startMinute: 0,
  endMinute: 1440,
  capacity: 5,
}));

const policy: SchedulingPolicy = { leadTimeMinutes: 0, horizonDays: 60, slotIntervalMinutes: 60 };

// 2026-01-05 is a Monday; 16:00Z == 10:00 America/Chicago (CST) == minute 600.
const NOW = "2026-01-04T00:00:00.000Z";
const SLOT_START = "2026-01-05T16:00:00.000Z";

describe("every template books to confirmed on the shared booking engine", () => {
  for (const c of templateCases()) {
    it(`${c.key}: draft → confirmed, charges ${c.charge}`, async () => {
      const payments = createMockPaymentProvider();
      const engine = createBookingEngine({
        services: [c.service],
        rules,
        overrides: [],
        policy,
        tenantTimezone: DEMO_TIMEZONE,
        payments,
        now: () => NOW,
      });

      const record = await engine.createBooking({
        tenantId: DEMO_TENANT,
        idempotencyKey: `key-${c.key}-000001`,
        selection: c.selection,
        slotStart: SLOT_START,
        customer: { name: "Demo Customer", email: "demo@example.com" },
      });

      expect(record.state).toBe("pending_payment");
      expect(record.pricing.total.amount).toBe(c.total);
      expect(record.pricing.deposit.amount).toBe(c.deposit);

      const intent = payments.listIntents()[0]!;
      // Amount charged now = server-computed total + deposit (SI-1).
      expect(intent.amount.amount).toBe(c.charge);

      payments.completePayment(intent.intentId, "succeeded");
      const confirmed = await engine.confirmFromPayment(intent.intentId);
      expect(confirmed.state).toBe("confirmed");
    });
  }
});
