import { describe, expect, it } from "vitest";
import { createMockWebhookProvider } from "@lumin/adapters";
import {
  WebhookSubscription,
  WebhookEventEnvelope,
  type WebhookEventEnvelope as Envelope,
  type WebhookSubscription as Subscription,
} from "@lumin/contracts";
import {
  buildDelivery,
  buildSignatureHeader,
  computeNextRetryAtMs,
  deliveryIdempotencyKey,
  dispatch,
  dispatchUntilSettled,
  matchSubscriptions,
  nextRetryDelayMs,
  serializeEnvelope,
  subscriptionMatches,
  verifySignature,
  DEFAULT_MAX_ATTEMPTS,
  SIGNATURE_HEADER,
  IDEMPOTENCY_HEADER,
} from "../src/index";

// ── Fixtures ────────────────────────────────────────────────────────────────
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SECRET = "whsec_test_secret_value";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // fixed injected clock (epoch ms)

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-a",
    tenantId: TENANT_A,
    url: "https://tenant-a.example.com/hooks",
    eventFilter: ["booking.created", "booking.confirmed"],
    active: true,
    signingSecretRef: "secretref_abc123",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function envelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    id: "evt-1",
    name: "booking.created",
    tenantId: TENANT_A,
    occurredAt: "2026-01-15T12:00:00.000Z",
    data: { bookingId: "bk_1", status: "created" },
    ...overrides,
  };
}

// ── Contract schema (additive, reuses EVENT_NAMES) ──────────────────────────
describe("WebhookContract schema", () => {
  it("accepts a well-formed subscription with a real uuid", () => {
    const parsed = WebhookSubscription.parse({
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: TENANT_A,
      url: "https://ok.example.com/h",
      eventFilter: ["booking.created"],
      active: true,
      signingSecretRef: "secretref_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.eventFilter).toEqual(["booking.created"]);
    // Secret VALUE is never a field on the contract — only a reference.
    expect(Object.keys(parsed)).not.toContain("signingSecret");
    expect(parsed.signingSecretRef).toBe("secretref_1");
  });

  it("accepts the wildcard filter", () => {
    const parsed = WebhookSubscription.parse({
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: TENANT_A,
      url: "https://ok.example.com/h",
      eventFilter: "*",
      active: true,
      signingSecretRef: "secretref_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parsed.eventFilter).toBe("*");
  });

  it("rejects an empty explicit filter list", () => {
    expect(() =>
      WebhookSubscription.parse({
        id: "33333333-3333-4333-8333-333333333333",
        tenantId: TENANT_A,
        url: "https://ok.example.com/h",
        eventFilter: [],
        active: true,
        signingSecretRef: "secretref_1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects an envelope with an unknown event name", () => {
    expect(() =>
      WebhookEventEnvelope.parse({ ...envelope(), name: "not.a.real.event" as never }),
    ).toThrow();
  });
});

// ── Filter matching ─────────────────────────────────────────────────────────
describe("matchSubscriptions — filtering", () => {
  it("matches an exact event name in the filter list", () => {
    const matched = matchSubscriptions(envelope({ name: "booking.created" }), [sub()]);
    expect(matched).toHaveLength(1);
  });

  it("matches a wildcard subscription", () => {
    const matched = matchSubscriptions(envelope({ name: "payment.succeeded" }), [
      sub({ eventFilter: "*" }),
    ]);
    expect(matched).toHaveLength(1);
  });

  it("excludes an event not in the filter list", () => {
    const matched = matchSubscriptions(envelope({ name: "payment.refunded" }), [sub()]);
    expect(matched).toHaveLength(0);
  });

  it("excludes an inactive subscription even on an exact match", () => {
    const matched = matchSubscriptions(envelope({ name: "booking.created" }), [
      sub({ active: false }),
    ]);
    expect(matched).toHaveLength(0);
  });

  it("returns only the matching subset from a mixed list, in order", () => {
    const s1 = sub({ id: "s1", eventFilter: ["booking.created"] });
    const s2 = sub({ id: "s2", eventFilter: ["payment.succeeded"] });
    const s3 = sub({ id: "s3", eventFilter: "*" });
    const matched = matchSubscriptions(envelope({ name: "booking.created" }), [s1, s2, s3]);
    expect(matched.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("subscriptionMatches agrees with matchSubscriptions for a single sub", () => {
    const ev = envelope({ name: "booking.confirmed" });
    expect(subscriptionMatches(sub(), ev)).toBe(true);
  });
});

// ── Tenant isolation (security property) ────────────────────────────────────
describe("tenant isolation", () => {
  it("tenant B's subscription never matches tenant A's event (wildcard)", () => {
    const tenantB = sub({ id: "sub-b", tenantId: TENANT_B, eventFilter: "*" });
    const matched = matchSubscriptions(envelope({ tenantId: TENANT_A }), [tenantB]);
    expect(matched).toHaveLength(0);
  });

  it("tenant B's subscription never matches tenant A's event (exact filter)", () => {
    const tenantB = sub({ id: "sub-b", tenantId: TENANT_B, eventFilter: ["booking.created"] });
    const matched = matchSubscriptions(
      envelope({ tenantId: TENANT_A, name: "booking.created" }),
      [tenantB],
    );
    expect(matched).toHaveLength(0);
  });

  it("only same-tenant subscriptions are selected from a cross-tenant pool", () => {
    const a = sub({ id: "a", tenantId: TENANT_A, eventFilter: "*" });
    const b = sub({ id: "b", tenantId: TENANT_B, eventFilter: "*" });
    const matched = matchSubscriptions(envelope({ tenantId: TENANT_A }), [a, b]);
    expect(matched.map((s) => s.id)).toEqual(["a"]);
  });

  it("buildDelivery refuses to sign a cross-tenant delivery", () => {
    const tenantB = sub({ tenantId: TENANT_B });
    expect(() => buildDelivery(envelope({ tenantId: TENANT_A }), tenantB, SECRET, NOW)).toThrow(
      /tenant isolation/i,
    );
  });
});

// ── Signature: verify pass, forgery + replay rejection ──────────────────────
describe("signature verify / replay", () => {
  it("verifies a freshly signed body", () => {
    const body = serializeEnvelope(envelope());
    const ts = Math.floor(NOW / 1000);
    const header = buildSignatureHeader(body, SECRET, ts);
    expect(verifySignature(body, header, SECRET, NOW)).toBe(true);
  });

  it("a built delivery's signature verifies with its secret", () => {
    const delivery = buildDelivery(envelope(), sub(), SECRET, NOW);
    expect(verifySignature(delivery.body, delivery.signature, SECRET, NOW)).toBe(true);
    expect(delivery.headers[SIGNATURE_HEADER]).toBe(delivery.signature);
  });

  it("rejects a forged signature (wrong secret)", () => {
    const body = serializeEnvelope(envelope());
    const ts = Math.floor(NOW / 1000);
    const forged = buildSignatureHeader(body, "attacker_secret", ts);
    expect(verifySignature(body, forged, SECRET, NOW)).toBe(false);
  });

  it("rejects a body tampered after signing", () => {
    const ts = Math.floor(NOW / 1000);
    const header = buildSignatureHeader(serializeEnvelope(envelope()), SECRET, ts);
    const tampered = serializeEnvelope(envelope({ data: { bookingId: "bk_HACKED" } }));
    expect(verifySignature(tampered, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a replayed/stale signature outside the skew window", () => {
    const body = serializeEnvelope(envelope());
    const oldTs = Math.floor(NOW / 1000) - 10 * 60; // 10 minutes old
    const header = buildSignatureHeader(body, SECRET, oldTs);
    expect(verifySignature(body, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a future-dated signature outside the skew window", () => {
    const body = serializeEnvelope(envelope());
    const futureTs = Math.floor(NOW / 1000) + 10 * 60;
    const header = buildSignatureHeader(body, SECRET, futureTs);
    expect(verifySignature(body, header, SECRET, NOW)).toBe(false);
  });

  it("accepts a signature within a custom skew window", () => {
    const body = serializeEnvelope(envelope());
    const ts = Math.floor(NOW / 1000) - 120;
    const header = buildSignatureHeader(body, SECRET, ts);
    expect(verifySignature(body, header, SECRET, NOW, { skewSeconds: 300 })).toBe(true);
  });

  it("rejects a missing or malformed signature header", () => {
    const body = serializeEnvelope(envelope());
    expect(verifySignature(body, null, SECRET, NOW)).toBe(false);
    expect(verifySignature(body, "", SECRET, NOW)).toBe(false);
    expect(verifySignature(body, "garbage", SECRET, NOW)).toBe(false);
  });
});

// ── Idempotency key ─────────────────────────────────────────────────────────
describe("idempotency key", () => {
  it("is stable per (subscription, envelope) across builds", () => {
    const d1 = buildDelivery(envelope(), sub(), SECRET, NOW);
    const d2 = buildDelivery(envelope(), sub(), SECRET, NOW + 5_000);
    expect(d1.idempotencyKey).toBe(d2.idempotencyKey);
    expect(d1.idempotencyKey).toBe(deliveryIdempotencyKey("sub-a", "evt-1"));
    expect(d1.headers[IDEMPOTENCY_HEADER]).toBe(d1.idempotencyKey);
  });

  it("differs for a different subscription or a different envelope", () => {
    const base = buildDelivery(envelope(), sub(), SECRET, NOW);
    const otherSub = buildDelivery(envelope(), sub({ id: "sub-x" }), SECRET, NOW);
    const otherEvt = buildDelivery(envelope({ id: "evt-2" }), sub(), SECRET, NOW);
    expect(base.idempotencyKey).not.toBe(otherSub.idempotencyKey);
    expect(base.idempotencyKey).not.toBe(otherEvt.idempotencyKey);
  });
});

// ── Dispatch: delivery + idempotency ────────────────────────────────────────
describe("dispatch — delivery & idempotency", () => {
  it("delivers once on success and records the attempt", async () => {
    const provider = createMockWebhookProvider();
    const outcome = await dispatch({ provider, envelope: envelope(), subscription: sub(), secret: SECRET, now: NOW });
    expect(outcome.status).toBe("delivered");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.nextRetryAt).toBeNull();
    expect(provider.deliveries()).toHaveLength(1);
  });

  it("re-dispatching a delivered outcome is a no-op (never double-delivers)", async () => {
    const provider = createMockWebhookProvider();
    const first = await dispatch({ provider, envelope: envelope(), subscription: sub(), secret: SECRET, now: NOW });
    const again = await dispatch({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: NOW + 60_000,
      prior: first,
    });
    expect(again).toBe(first);
    // No second provider call happened.
    expect(provider.deliveries()).toHaveLength(1);
  });

  it("carries the signed envelope as the delivered payload", async () => {
    const provider = createMockWebhookProvider();
    await dispatch({ provider, envelope: envelope(), subscription: sub(), secret: SECRET, now: NOW });
    const delivered = provider.deliveries()[0]!;
    expect(delivered.event).toBe("booking.created");
    expect(delivered.tenantId).toBe(TENANT_A);
  });
});

// ── Backoff schedule ────────────────────────────────────────────────────────
describe("retry backoff schedule", () => {
  it("grows exponentially with the attempt number", () => {
    expect(nextRetryDelayMs(1)).toBe(1_000);
    expect(nextRetryDelayMs(2)).toBe(2_000);
    expect(nextRetryDelayMs(3)).toBe(4_000);
    expect(nextRetryDelayMs(4)).toBe(8_000);
  });

  it("honors a custom base and factor", () => {
    expect(nextRetryDelayMs(1, { baseRetryMs: 500, backoffFactor: 3 })).toBe(500);
    expect(nextRetryDelayMs(2, { baseRetryMs: 500, backoffFactor: 3 })).toBe(1_500);
  });

  it("computeNextRetryAtMs offsets from the injected now", () => {
    expect(computeNextRetryAtMs(1, NOW)).toBe(NOW + 1_000);
    expect(computeNextRetryAtMs(2, NOW)).toBe(NOW + 2_000);
  });
});

// ── Dispatch: retry, growing backoff, dead-letter ───────────────────────────
describe("dispatch — retry & dead-letter", () => {
  it("schedules a backed-off retry on a single failure", async () => {
    const provider = createMockWebhookProvider();
    provider.setFailing(true);
    const outcome = await dispatch({ provider, envelope: envelope(), subscription: sub(), secret: SECRET, now: NOW });
    expect(outcome.status).toBe("failed");
    expect(outcome.deadLettered).toBe(false);
    expect(outcome.attempts).toHaveLength(1);
    expect(Date.parse(outcome.nextRetryAt as string)).toBe(NOW + 1_000);
  });

  it("retries with growing backoff and dead-letters after max attempts", async () => {
    const provider = createMockWebhookProvider();
    provider.setFailing(true);
    const outcomes = await dispatchUntilSettled({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: NOW,
    });
    // One outcome per attempt, up to the ceiling.
    expect(outcomes).toHaveLength(DEFAULT_MAX_ATTEMPTS);
    const final = outcomes[outcomes.length - 1]!;
    expect(final.status).toBe("dead_letter");
    expect(final.deadLettered).toBe(true);
    expect(final.nextRetryAt).toBeNull();
    expect(final.attempts).toHaveLength(DEFAULT_MAX_ATTEMPTS);
    expect(provider.deliveries()).toHaveLength(DEFAULT_MAX_ATTEMPTS);

    // Non-final outcomes each schedule a strictly larger backoff.
    const delays = outcomes
      .slice(0, -1)
      .map((o) => Date.parse(o.nextRetryAt as string) - Date.parse(o.attempts[o.attempts.length - 1]!.at));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it("re-dispatching a dead-lettered outcome is a no-op", async () => {
    const provider = createMockWebhookProvider();
    provider.setFailing(true);
    const outcomes = await dispatchUntilSettled({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: NOW,
    });
    const dead = outcomes[outcomes.length - 1]!;
    const callsBefore = provider.deliveries().length;
    const again = await dispatch({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: NOW + 1_000_000,
      prior: dead,
    });
    expect(again).toBe(dead);
    expect(provider.deliveries()).toHaveLength(callsBefore);
  });

  it("stops retrying as soon as a delivery succeeds (recovery)", async () => {
    const provider = createMockWebhookProvider();
    provider.setFailing(true);
    const first = await dispatch({ provider, envelope: envelope(), subscription: sub(), secret: SECRET, now: NOW });
    expect(first.status).toBe("failed");
    provider.setFailing(false);
    const second = await dispatch({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: Date.parse(first.nextRetryAt as string),
      prior: first,
    });
    expect(second.status).toBe("delivered");
    expect(second.attempts).toHaveLength(2);
    expect(second.nextRetryAt).toBeNull();
  });

  it("a delivered event is never retried even if dispatch is called again", async () => {
    const provider = createMockWebhookProvider();
    const delivered = await dispatch({ provider, envelope: envelope(), subscription: sub(), secret: SECRET, now: NOW });
    // Flip to failing; a re-dispatch of a delivered outcome must NOT call the provider.
    provider.setFailing(true);
    const again = await dispatch({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: NOW + 5_000,
      prior: delivered,
    });
    expect(again.status).toBe("delivered");
    expect(provider.deliveries()).toHaveLength(1);
  });

  it("respects a custom maxAttempts ceiling", async () => {
    const provider = createMockWebhookProvider();
    provider.setFailing(true);
    const outcomes = await dispatchUntilSettled({
      provider,
      envelope: envelope(),
      subscription: sub(),
      secret: SECRET,
      now: NOW,
      maxAttempts: 2,
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes[outcomes.length - 1]!.status).toBe("dead_letter");
  });
});

// ── End-to-end: match → build → dispatch across tenants ─────────────────────
describe("end-to-end match + dispatch", () => {
  it("only the matched, same-tenant subscription receives a signed delivery", async () => {
    const provider = createMockWebhookProvider();
    const a = sub({ id: "a", tenantId: TENANT_A, eventFilter: ["booking.created"] });
    const b = sub({ id: "b", tenantId: TENANT_B, eventFilter: "*" });
    const ev = envelope({ tenantId: TENANT_A, name: "booking.created" });

    const matched = matchSubscriptions(ev, [a, b]);
    expect(matched.map((s) => s.id)).toEqual(["a"]);

    for (const s of matched) {
      const outcome = await dispatch({ provider, envelope: ev, subscription: s, secret: SECRET, now: NOW });
      expect(outcome.status).toBe("delivered");
    }
    expect(provider.deliveries()).toHaveLength(1);
    const delivered = provider.deliveries()[0]!;
    expect(delivered.tenantId).toBe(TENANT_A);
    // Signature on the wire verifies for tenant A's secret.
    const built = buildDelivery(ev, a, SECRET, NOW);
    expect(verifySignature(built.body, built.signature, SECRET, NOW)).toBe(true);
  });
});
