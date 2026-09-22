import type {
  NotificationConfig,
  NotificationContext,
  NotificationInput,
  NotificationProvider,
} from "@lumin/contracts";

/** A fixed tenant id (uuid) used across tests. */
export const TENANT_A = "11111111-1111-1111-1111-111111111111";

/** Fixed injected `now` — nothing here ever reads a wall clock. */
export const NOW = "2026-03-10T12:00:00.000Z";

/**
 * A tenant config wired for en-US + es-MX, email + sms templates for
 * confirmed/cancelled, a refund email, and reminder templates. Two reminder
 * rules: 24h (email) and 1h (sms).
 */
export function baseConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    tenantId: TENANT_A,
    locale: "en-US",
    timezone: "America/Chicago",
    sender: {
      emailFrom: "hello@acme.example",
      emailFromName: "Acme Detailing",
      smsFrom: "+15125550100",
    },
    events: [
      { event: "booking.confirmed", channels: ["email", "sms"] },
      { event: "booking.cancelled", channels: ["email"] },
      { event: "booking.refunded", channels: ["email"] },
      { event: "booking.completed", channels: [] },
    ],
    reminders: [
      { id: "r-24h", offsetMinutes: 1440, channels: ["email"] },
      { id: "r-1h", offsetMinutes: 60, channels: ["sms"] },
    ],
    templates: [
      {
        trigger: "booking.confirmed",
        channel: "email",
        locale: "en-US",
        subject: "Your booking {{bookingReference}} is confirmed",
        body: "Hi {{customerName}}, your booking with {{tenantName}} is confirmed for {{slotStart}}. Total: {{total}}.",
      },
      {
        trigger: "booking.confirmed",
        channel: "email",
        locale: "es-MX",
        subject: "Tu reserva {{bookingReference}} está confirmada",
        body: "Hola {{customerName}}, tu reserva con {{tenantName}} está confirmada para {{slotStart}}. Total: {{total}}.",
      },
      {
        trigger: "booking.confirmed",
        channel: "sms",
        locale: "en-US",
        body: "{{tenantName}}: booking {{bookingReference}} confirmed for {{slotStart}}.",
      },
      {
        trigger: "booking.confirmed",
        channel: "sms",
        locale: "es-MX",
        body: "{{tenantName}}: reserva {{bookingReference}} confirmada para {{slotStart}}.",
      },
      {
        trigger: "booking.cancelled",
        channel: "email",
        locale: "en-US",
        subject: "Your booking {{bookingReference}} was cancelled",
        body: "Hi {{customerName}}, your booking {{bookingReference}} has been cancelled.",
      },
      {
        trigger: "booking.refunded",
        channel: "email",
        locale: "en-US",
        subject: "Refund issued for {{bookingReference}}",
        body: "Hi {{customerName}}, we refunded {{total}} for {{bookingReference}}.",
      },
      {
        trigger: "reminder",
        channel: "email",
        locale: "en-US",
        subject: "Reminder: {{bookingReference}} on {{slotDate}}",
        body: "Hi {{customerName}}, this is a reminder for {{slotStart}}.",
      },
      {
        trigger: "reminder",
        channel: "sms",
        locale: "en-US",
        body: "Reminder: {{bookingReference}} at {{slotTime}}.",
      },
    ],
    ...overrides,
  };
}

/** A confirmed booking context. slotStart is well after NOW by default. */
export function bookingContext(
  overrides: Partial<NotificationContext["booking"]> = {},
  tenantName = "Acme Detailing",
): NotificationContext {
  return {
    tenant: { id: TENANT_A, name: tenantName },
    booking: {
      id: "bk-1",
      reference: "LMN-3F8K2Q",
      state: "confirmed",
      slotStart: "2026-03-20T15:00:00.000Z",
      slotEnd: "2026-03-20T16:00:00.000Z",
      customerName: "Dana Rivera",
      customerEmail: "dana@example.com",
      customerPhone: "+15125550111",
      total: { amount: 12500, currency: "USD" },
      ...overrides,
    },
  };
}

/** A provider that throws on any `to` in `failOn`, otherwise records the send. */
export function flakyProvider(failOn: Set<string> = new Set()): NotificationProvider & {
  sent: (NotificationInput & { messageId: string })[];
} {
  const sent: (NotificationInput & { messageId: string })[] = [];
  let counter = 0;
  return {
    providerName: "flaky-test",
    sent,
    async send(input: NotificationInput): Promise<{ messageId: string }> {
      if (failOn.has(input.to)) {
        throw new Error(`provider refused ${input.to}`);
      }
      counter += 1;
      const messageId = `msg_${counter}`;
      sent.push({ ...input, messageId });
      return { messageId };
    },
  };
}
