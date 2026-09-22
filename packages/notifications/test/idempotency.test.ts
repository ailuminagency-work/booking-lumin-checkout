import { describe, expect, it } from "vitest";
import { createMockNotificationProvider } from "@lumin/adapters";
import {
  dedupeKey,
  planNotifications,
  sendNotifications,
  toNotificationInput,
} from "../src/index";
import { NOW, baseConfig, bookingContext, flakyProvider } from "./fixtures";

describe("dedupeKey: stable and unique", () => {
  it("is stable for the same parts", () => {
    const a = dedupeKey({ tenantId: "t", bookingId: "b", trigger: "booking.confirmed", channel: "email" });
    const b = dedupeKey({ tenantId: "t", bookingId: "b", trigger: "booking.confirmed", channel: "email" });
    expect(a).toBe(b);
  });

  it("differs by channel", () => {
    const email = dedupeKey({ tenantId: "t", bookingId: "b", trigger: "booking.confirmed", channel: "email" });
    const sms = dedupeKey({ tenantId: "t", bookingId: "b", trigger: "booking.confirmed", channel: "sms" });
    expect(email).not.toBe(sms);
  });

  it("includes the reminder id", () => {
    const key = dedupeKey({ tenantId: "t", bookingId: "b", trigger: "reminder", channel: "email", reminderId: "r-24h" });
    expect(key).toContain("r-24h");
  });
});

describe("toNotificationInput: maps a rendered notification to NotificationInput", () => {
  it("carries channel, recipient, provider template, and rendered text in variables", () => {
    const out = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const email = out.find((n) => n.channel === "email")!;
    const input = toNotificationInput(email);
    expect(input.channel).toBe("email");
    expect(input.to).toBe("dana@example.com");
    expect(input.template).toBe("booking_confirmed");
    expect(input.variables.subject).toBe(email.subject);
    expect(input.variables.body).toBe(email.body);
  });

  it("omits subject in variables for sms", () => {
    const out = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const sms = out.find((n) => n.channel === "sms")!;
    const input = toNotificationInput(sms);
    expect(input.variables.subject).toBeUndefined();
    expect(input.variables.body).toBe(sms.body);
  });
});

describe("sendNotifications: idempotent dedupe", () => {
  it("planning twice yields exactly one send per key", async () => {
    const provider = createMockNotificationProvider();
    const plan = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const batch = [...plan, ...plan]; // planned twice
    const result = await sendNotifications(provider, batch);
    expect(result.sent).toHaveLength(2); // email + sms, each once
    expect(result.skipped).toHaveLength(2); // the duplicate copies
    expect(provider.sentMessages()).toHaveLength(2);
  });

  it("an already-sent key is skipped", async () => {
    const provider = createMockNotificationProvider();
    const plan = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const emailKey = plan.find((n) => n.channel === "email")!.dedupeKey;
    const alreadySent = new Set<string>([emailKey]);
    const result = await sendNotifications(provider, plan, alreadySent);
    expect(result.sent.map((n) => n.channel)).toEqual(["sms"]);
    expect(result.skipped.map((n) => n.channel)).toEqual(["email"]);
  });

  it("successful sends are recorded into the caller's sent set (persists across batches)", async () => {
    const provider = createMockNotificationProvider();
    const sentSet = new Set<string>();
    const plan = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const first = await sendNotifications(provider, plan, sentSet);
    expect(first.sent).toHaveLength(2);
    // A second batch with the same plan sends nothing new.
    const second = await sendNotifications(provider, plan, sentSet);
    expect(second.sent).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(provider.sentMessages()).toHaveLength(2);
  });
});

describe("sendNotifications: fail-safe (a failed send never loses the others, never throws, never reverses a booking)", () => {
  it("one provider error is captured per item; the rest still send", async () => {
    const provider = flakyProvider(new Set(["dana@example.com"])); // email fails
    const plan = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const result = await sendNotifications(provider, plan);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.notification.channel).toBe("email");
    expect(result.sent.map((n) => n.channel)).toEqual(["sms"]); // sms delivered
    expect(provider.sent).toHaveLength(1);
  });

  it("does not throw out of the batch even if every send fails", async () => {
    const provider = flakyProvider(new Set(["dana@example.com", "+15125550111"]));
    const plan = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    await expect(sendNotifications(provider, plan)).resolves.toBeDefined();
    const result = await sendNotifications(provider, plan);
    expect(result.failed).toHaveLength(2);
    expect(result.sent).toHaveLength(0);
  });

  it("a failed key is NOT marked sent, so a retry can re-attempt it", async () => {
    const failing = flakyProvider(new Set(["dana@example.com"]));
    const sentSet = new Set<string>();
    const plan = planNotifications("booking.confirmed", bookingContext(), baseConfig(), NOW);
    const first = await sendNotifications(failing, plan, sentSet);
    expect(first.failed).toHaveLength(1);
    const emailKey = plan.find((n) => n.channel === "email")!.dedupeKey;
    expect(sentSet.has(emailKey)).toBe(false); // not recorded as sent
    // Retry with a healthy provider delivers the previously-failed email.
    const healthy = flakyProvider(new Set());
    const retry = await sendNotifications(healthy, plan, sentSet);
    expect(retry.sent.map((n) => n.channel)).toEqual(["email"]); // sms already sent
  });

  it("a send failure never mutates booking state (notifications can't reverse a booking)", async () => {
    const ctx = bookingContext();
    const stateBefore = ctx.booking.state;
    const provider = flakyProvider(new Set(["dana@example.com", "+15125550111"]));
    await sendNotifications(provider, planNotifications("booking.confirmed", ctx, baseConfig(), NOW));
    expect(ctx.booking.state).toBe(stateBefore);
    expect(ctx.booking.state).toBe("confirmed");
  });
});
