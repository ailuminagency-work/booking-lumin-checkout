import { describe, expect, it } from "vitest";
import { PaymentError } from "@lumin/contracts";
import {
  createMockCalendarProvider,
  createMockNotificationProvider,
  createMockPaymentProvider,
  createMockWebhookProvider,
  signMockWebhook,
} from "../src/index";

const TENANT = "00000000-0000-4000-8000-000000000001";
const usd = (amount: number) => ({ amount, currency: "USD" });

function intentInput(key = "idem-key-0000000001") {
  return {
    tenantId: TENANT,
    bookingId: "00000000-0000-4000-8000-000000000002",
    amount: usd(10_000),
    idempotencyKey: key,
  };
}

describe("mock payment: intents", () => {
  it("is idempotent on idempotencyKey — same key never creates a second charge", async () => {
    const provider = createMockPaymentProvider();
    const a = await provider.createIntent(intentInput());
    const b = await provider.createIntent(intentInput());
    expect(b.intentId).toBe(a.intentId);
    expect(provider.listIntents()).toHaveLength(1);
    expect(a.clientToken).toBe(`mock_tok_${a.intentId}`);
    expect(a.state).toBe("requires_payment");
  });

  it("armed failure rejects exactly one createIntent", async () => {
    const provider = createMockPaymentProvider({ failNextIntent: true });
    await expect(provider.createIntent(intentInput("fail-key-0000000001"))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(provider.createIntent(intentInput("ok-key-000000000001"))).resolves.toMatchObject({
      state: "requires_payment",
    });
  });

  it("completePayment drives succeeded/failed outcomes", async () => {
    const provider = createMockPaymentProvider();
    const intent = await provider.createIntent(intentInput());
    provider.completePayment(intent.intentId, "succeeded");
    expect((await provider.getIntent(intent.intentId))?.state).toBe("succeeded");
  });
});

describe("mock payment: refunds", () => {
  it("tracks partial vs full refunds and rejects over-refunds", async () => {
    const provider = createMockPaymentProvider();
    const intent = await provider.createIntent(intentInput());
    // refunding an uncaptured intent is illegal
    await expect(provider.refund(intent.intentId, usd(1_000))).rejects.toBeInstanceOf(PaymentError);
    provider.completePayment(intent.intentId, "succeeded");
    await provider.refund(intent.intentId, usd(4_000));
    expect((await provider.getIntent(intent.intentId))?.state).toBe("partially_refunded");
    await provider.refund(intent.intentId, usd(6_000));
    expect((await provider.getIntent(intent.intentId))?.state).toBe("refunded");
    await expect(provider.refund(intent.intentId, usd(1))).rejects.toBeInstanceOf(PaymentError);
    expect(provider.listRefunds(intent.intentId)).toHaveLength(2);
  });
});

describe("mock payment: webhook verification (SI-10)", () => {
  const payload = JSON.stringify({ kind: "payment_succeeded", intentId: "mpi_1_x" });

  it("parses a correctly signed payload", async () => {
    const provider = createMockPaymentProvider();
    const event = await provider.parseWebhook(payload, signMockWebhook(payload));
    expect(event).toMatchObject({ kind: "payment_succeeded", intentId: "mpi_1_x" });
  });

  it("throws WEBHOOK_UNVERIFIED for a bad or missing signature", async () => {
    const provider = createMockPaymentProvider();
    await expect(provider.parseWebhook(payload, "mock-sig-deadbeef")).rejects.toMatchObject({
      code: "WEBHOOK_UNVERIFIED",
    });
    await expect(provider.parseWebhook(payload, null)).rejects.toMatchObject({ code: "WEBHOOK_UNVERIFIED" });
    // signature of DIFFERENT content must not verify this payload
    const other = JSON.stringify({ kind: "payment_failed", intentId: "mpi_1_x" });
    await expect(provider.parseWebhook(payload, signMockWebhook(other))).rejects.toMatchObject({
      code: "WEBHOOK_UNVERIFIED",
    });
  });

  it("normalizes unknown kinds as unrecognized (still only when verified)", async () => {
    const provider = createMockPaymentProvider();
    const weird = JSON.stringify({ kind: "mystery", intentId: 42 });
    const event = await provider.parseWebhook(weird, signMockWebhook(weird));
    expect(event).toMatchObject({ kind: "unrecognized", intentId: null });
  });
});

describe("mock calendar / notification / webhook", () => {
  it("calendar records created and deleted events per tenant", async () => {
    const calendar = createMockCalendarProvider();
    const { eventId } = await calendar.createEvent({
      tenantId: TENANT,
      bookingId: "b1",
      title: "Cleaning",
      start: "2026-01-05T16:00:00.000Z",
      end: "2026-01-05T17:00:00.000Z",
    });
    expect(calendar.listEvents()).toHaveLength(1);
    await calendar.deleteEvent("other-tenant", eventId); // wrong tenant: no-op
    expect(calendar.listEvents()).toHaveLength(1);
    await calendar.deleteEvent(TENANT, eventId);
    expect(calendar.listEvents()).toHaveLength(0);
    expect(calendar.deletedEventIds()).toEqual([eventId]);
  });

  it("notification provider records sent messages", async () => {
    const notify = createMockNotificationProvider();
    await notify.send({
      tenantId: TENANT,
      channel: "email",
      to: "ada@example.com",
      template: "booking_confirmed",
      variables: { reference: "LMN-ABC123" },
    });
    expect(notify.sentMessages()).toHaveLength(1);
    expect(notify.sentMessages()[0]).toMatchObject({ template: "booking_confirmed", to: "ada@example.com" });
  });

  it("webhook provider reports delivered/failed and keeps an attempt log", async () => {
    const hooks = createMockWebhookProvider();
    const ok = await hooks.deliver({ tenantId: TENANT, event: "booking.confirmed", payload: { id: "b1" } });
    expect(ok.status).toBe("delivered");
    hooks.setFailing(true);
    const bad = await hooks.deliver({ tenantId: TENANT, event: "booking.confirmed", payload: { id: "b2" } });
    expect(bad.status).toBe("failed");
    expect(hooks.deliveries().map((d) => d.status)).toEqual(["delivered", "failed"]);
  });
});
