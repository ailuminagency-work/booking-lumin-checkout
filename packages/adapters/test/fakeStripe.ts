/**
 * fakeStripe — a deterministic, in-memory implementation of the exact Stripe
 * REST subset the StripePaymentProvider uses, exposed as a `fetchImpl`.
 *
 * It lets the full threat matrix run with ZERO network:
 *  - POST /v1/payment_intents          (create; honors Idempotency-Key)
 *  - GET  /v1/payment_intents/{id}      (retrieve)
 *  - POST /v1/payment_intents/{id}/cancel
 *  - POST /v1/refunds                   (full/partial)
 *
 * Idempotency semantics MATCH Stripe: a create with a previously-seen
 * `Idempotency-Key` returns the ORIGINAL intent verbatim (never a second
 * charge), even if the retried request body differs (the altered amount is
 * ignored — this is the key defense tested by threat item 23).
 *
 * Signed webhook payloads use the SAME real scheme as the adapter, produced via
 * `signStripeTestWebhook` in the test files (identical HMAC), so no signing
 * logic is duplicated here.
 */

import { signStripeTestWebhook } from "../src/stripePayment";

export type StripeStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "canceled";

interface StoredIntent {
  id: string;
  object: "payment_intent";
  status: StripeStatus;
  amount: number;
  currency: string;
  client_secret: string;
  metadata: Record<string, string>;
  captured: number; // amount captured (== amount once succeeded)
  refunded: number; // running refunded total (minor units)
}

interface StoredRefund {
  id: string;
  object: "refund";
  status: "succeeded";
  amount: number;
  currency: string;
  payment_intent: string;
}

export interface FakeStripe {
  /** Pass this to `createStripePaymentProvider({ fetchImpl })`. */
  readonly fetchImpl: typeof fetch;
  /** Drive an intent to a terminal/intermediate status (simulates the customer). */
  drive(intentId: string, status: StripeStatus): void;
  /** Inspect a stored intent (or undefined). */
  getIntent(intentId: string): StoredIntent | undefined;
  /** All intents in creation order. */
  intents(): StoredIntent[];
  /** Refunds recorded against an intent. */
  refunds(intentId: string): StoredRefund[];
  /**
   * Build a real-scheme signed Stripe event for an intent, ready to hand to
   * `parseWebhook(payload, header)`. `ts` defaults to `now` (unix seconds).
   */
  webhook(
    type: string,
    intentId: string,
    opts?: { ts?: number; eventId?: string },
  ): { payload: string; header: string };
  /** Count of network-shaped requests served (helps assert "one charge"). */
  createCalls(): number;
}

export interface FakeStripeOptions {
  webhookSecret: string;
  /** Clock in unix SECONDS for webhook signing defaults. Default 1_760_000_000. */
  nowSeconds?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stripeError(message: string, status = 400): Response {
  return json({ error: { type: "invalid_request_error", message } }, status);
}

export function createFakeStripe(opts: FakeStripeOptions): FakeStripe {
  const intents = new Map<string, StoredIntent>();
  const byIdempotencyKey = new Map<string, string>(); // key → intentId
  const refundsByIntent = new Map<string, StoredRefund[]>();
  const nowSeconds = opts.nowSeconds ?? 1_760_000_000;
  let intentCounter = 0;
  let refundCounter = 0;
  let createCallCount = 0;

  function headerValue(init: RequestInit | undefined, name: string): string | null {
    const h = init?.headers;
    if (!h) return null;
    if (h instanceof Headers) return h.get(name);
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(h as Record<string, string>)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    const body = typeof init?.body === "string" ? init.body : "";
    const params = new URLSearchParams(body);

    // POST /v1/payment_intents
    if (path === "/v1/payment_intents" && method === "POST") {
      createCallCount += 1;
      const idemKey = headerValue(init, "Idempotency-Key");

      // Idempotency: replay the ORIGINAL intent for a seen key (Stripe-native).
      // The current body (possibly tampered) is intentionally ignored.
      if (idemKey && byIdempotencyKey.has(idemKey)) {
        const existing = intents.get(byIdempotencyKey.get(idemKey)!)!;
        return json(existing);
      }

      const amount = Number(params.get("amount"));
      const currency = params.get("currency") ?? "";
      if (!Number.isInteger(amount) || amount <= 0) {
        return stripeError("Invalid integer: amount must be a positive integer");
      }
      if (!/^[a-z]{3}$/.test(currency)) {
        return stripeError("Invalid currency");
      }

      intentCounter += 1;
      const id = `pi_test_${intentCounter}`;
      const metadata: Record<string, string> = {};
      for (const [k, v] of params.entries()) {
        const m = /^metadata\[(.+)\]$/.exec(k);
        if (m) metadata[m[1]!] = v;
      }
      const intent: StoredIntent = {
        id,
        object: "payment_intent",
        status: "requires_payment_method",
        amount,
        currency,
        client_secret: `${id}_secret_${intentCounter}abc`,
        metadata,
        captured: 0,
        refunded: 0,
      };
      intents.set(id, intent);
      if (idemKey) byIdempotencyKey.set(idemKey, id);
      return json(intent);
    }

    // /v1/payment_intents/{id} and /v1/payment_intents/{id}/cancel
    const piMatch = /^\/v1\/payment_intents\/([^/]+)(\/cancel)?$/.exec(path);
    if (piMatch) {
      const id = decodeURIComponent(piMatch[1]!);
      const isCancel = piMatch[2] === "/cancel";
      const intent = intents.get(id);
      if (!intent) return stripeError(`No such payment_intent: ${id}`, 404);

      if (isCancel && method === "POST") {
        if (intent.status === "succeeded") {
          return stripeError("Cannot cancel a succeeded PaymentIntent");
        }
        intent.status = "canceled";
        return json(intent);
      }
      if (method === "GET") return json(intent);
      return stripeError("Method not allowed", 405);
    }

    // POST /v1/refunds
    if (path === "/v1/refunds" && method === "POST") {
      const intentId = params.get("payment_intent") ?? "";
      const intent = intents.get(intentId);
      if (!intent) return stripeError(`No such payment_intent: ${intentId}`, 404);
      if (intent.status !== "succeeded") {
        return stripeError("PaymentIntent is not in a refundable state");
      }
      const requested = params.has("amount") ? Number(params.get("amount")) : intent.amount - intent.refunded;
      if (!Number.isInteger(requested) || requested <= 0) {
        return stripeError("Invalid refund amount");
      }
      if (intent.refunded + requested > intent.captured) {
        return stripeError("Refund amount exceeds the captured amount");
      }
      intent.refunded += requested;
      refundCounter += 1;
      const refund: StoredRefund = {
        id: `re_test_${refundCounter}`,
        object: "refund",
        status: "succeeded",
        amount: requested,
        currency: intent.currency,
        payment_intent: intent.id,
      };
      const list = refundsByIntent.get(intent.id) ?? [];
      list.push(refund);
      refundsByIntent.set(intent.id, list);
      return json(refund);
    }

    return stripeError(`fakeStripe: unhandled ${method} ${path}`, 404);
  };

  return {
    fetchImpl,
    drive(intentId, status) {
      const intent = intents.get(intentId);
      if (!intent) throw new Error(`fakeStripe.drive: unknown intent ${intentId}`);
      intent.status = status;
      if (status === "succeeded") intent.captured = intent.amount;
    },
    getIntent(intentId) {
      return intents.get(intentId);
    },
    intents() {
      return [...intents.values()];
    },
    refunds(intentId) {
      return refundsByIntent.get(intentId) ?? [];
    },
    webhook(type, intentId, webhookOpts) {
      const intent = intents.get(intentId);
      if (!intent) throw new Error(`fakeStripe.webhook: unknown intent ${intentId}`);
      const ts = webhookOpts?.ts ?? nowSeconds;
      const isRefund = type.startsWith("charge.") || type.startsWith("refund.");
      const object = isRefund
        ? { id: `re_evt_${intent.id}`, object: "refund", payment_intent: intent.id, status: "succeeded" }
        : { id: intent.id, object: "payment_intent", status: intent.status, amount: intent.amount, currency: intent.currency };
      const event = {
        id: webhookOpts?.eventId ?? `evt_test_${intent.id}_${type}`,
        object: "event",
        type,
        data: { object },
      };
      const payload = JSON.stringify(event);
      return { payload, header: signStripeTestWebhook(payload, opts.webhookSecret, ts) };
    },
    createCalls() {
      return createCallCount;
    },
  };
}
