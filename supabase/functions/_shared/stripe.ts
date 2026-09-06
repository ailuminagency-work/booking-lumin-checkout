// _shared/stripe.ts — Deno-native mirror of packages/adapters/src/stripePayment.ts.
//
// ⚠️ DELIBERATE DUPLICATION. Same rationale as the pricing/availability mirrors:
// the edge runtime is self-contained (no @lumin/* imports) and uses Deno's Web
// Crypto (crypto.subtle) for HMAC, whereas the browser/Node adapter uses the
// dependency-free webhookCrypto. The Stripe wire protocol implemented here is
// IDENTICAL to the adapter's:
//   - REST via application/x-www-form-urlencoded, Bearer secret key
//   - amounts in MINOR UNITS (Stripe-native, == MoneyContract)
//   - Idempotency-Key header for Stripe-native create idempotency
//   - webhook signature scheme  t=<ts>,v1=<hex hmac_sha256(secret,"<ts>.<payload>")>
//
// SECRETS ARE SERVER-ONLY (SI-5): STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET come
// from Deno.env (Supabase function secrets / Vault). They are NEVER returned to
// the client and NEVER logged. Only client_secret (non-secret) crosses to the
// browser.

const encoder = new TextEncoder();

export type Money = { amount: number; currency: string };

export type PaymentState =
  | "requires_payment"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded";

export type PaymentIntentRef = {
  intentId: string;
  clientToken: string;
  state: PaymentState;
  amount: Money;
};

export type WebhookEvent = {
  kind: "payment_succeeded" | "payment_failed" | "refund_completed" | "unrecognized";
  intentId: string | null;
  raw: unknown;
};

export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PaymentError";
  }
}

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function mapIntentStatus(status: string): PaymentState {
  switch (status) {
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
      return "requires_payment";
    case "processing":
      return "processing";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "failed";
    default:
      return "requires_payment"; // fail closed
  }
}

interface StripeIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  client_secret: string | null;
}

function toRef(i: StripeIntent): PaymentIntentRef {
  return {
    intentId: i.id,
    clientToken: i.client_secret ?? "",
    state: mapIntentStatus(i.status),
    amount: { amount: i.amount, currency: i.currency.toUpperCase() },
  };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time hex-string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StripeClientOptions {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number; // epoch ms
}

export function createStripeClient(opts: StripeClientOptions) {
  const apiBase = (opts.apiBase ?? "https://api.stripe.com").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${opts.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...extra,
    };
  }

  async function readJson(res: Response): Promise<any> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe returned a non-JSON body");
    }
  }

  return {
    /**
     * Create (or, with a repeated Idempotency-Key, reuse) a PaymentIntent for a
     * SERVER-COMPUTED amount in minor units. `idempotencyKey` MUST be stable per
     * (tenant, idempotency_key) so a retry never double-charges (Stripe-native).
     */
    async createIntent(input: {
      tenantId: string;
      bookingId: string;
      amount: Money;
      idempotencyKey: string;
      metadata?: Record<string, string>;
    }): Promise<PaymentIntentRef> {
      const amount = input.amount.amount;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new PaymentError("INVALID_REQUEST", "charge amount must be a positive integer (minor units)");
      }
      const body = new URLSearchParams();
      body.set("amount", String(amount));
      body.set("currency", input.amount.currency.toLowerCase());
      body.set("metadata[tenantId]", input.tenantId);
      body.set("metadata[bookingId]", input.bookingId);
      for (const [k, v] of Object.entries(input.metadata ?? {})) body.set(`metadata[${k}]`, v);
      body.set("automatic_payment_methods[enabled]", "true");

      const res = await doFetch(`${apiBase}/v1/payment_intents`, {
        method: "POST",
        headers: authHeaders({ "Idempotency-Key": input.idempotencyKey }),
        body: body.toString(),
      });
      if (!res.ok) throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe createIntent failed");
      return toRef((await readJson(res)) as StripeIntent);
    },

    async getIntent(intentId: string): Promise<PaymentIntentRef | null> {
      const res = await doFetch(`${apiBase}/v1/payment_intents/${encodeURIComponent(intentId)}`, {
        method: "GET",
        headers: authHeaders(),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe getIntent failed");
      return toRef((await readJson(res)) as StripeIntent);
    },

    /**
     * Issue a refund against a PaymentIntent (F1 compensation / F4). Passing an
     * explicit `amount` (minor units) makes a partial refund when it is less
     * than the captured total and a full refund when it equals it; Stripe
     * rejects an amount above the captured total (over-refund).
     */
    async refund(intentId: string, amount: Money): Promise<{ refundId: string }> {
      if (!Number.isSafeInteger(amount.amount) || amount.amount <= 0) {
        throw new PaymentError("INVALID_REQUEST", "refund amount must be a positive integer (minor units)");
      }
      const body = new URLSearchParams();
      body.set("payment_intent", intentId);
      body.set("amount", String(amount.amount));
      const res = await doFetch(`${apiBase}/v1/refunds`, {
        method: "POST",
        headers: authHeaders(),
        body: body.toString(),
      });
      if (!res.ok) throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe refund failed");
      const refund = (await readJson(res)) as { id: string };
      return { refundId: refund.id };
    },

    /**
     * Verify + normalize a Stripe webhook. Throws PaymentError("WEBHOOK_UNVERIFIED")
     * on any signature/timestamp failure (SI-10). Stateless: replay dedup is the
     * DB's job via unique (provider, provider_intent_id) + idempotent confirm.
     */
    async parseWebhook(payload: string, signatureHeader: string | null): Promise<WebhookEvent> {
      if (!signatureHeader) throw new PaymentError("WEBHOOK_UNVERIFIED", "missing Stripe-Signature header");
      let t: number | null = null;
      const v1: string[] = [];
      for (const part of signatureHeader.split(",")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (key === "t") {
          const n = Number(value);
          t = Number.isFinite(n) ? n : null;
        } else if (key === "v1") {
          v1.push(value);
        }
      }
      if (t === null || v1.length === 0) throw new PaymentError("WEBHOOK_UNVERIFIED", "malformed signature header");

      const nowSec = Math.floor(now() / 1000);
      if (Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SECONDS) {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "timestamp outside tolerance");
      }
      const expected = await hmacSha256Hex(opts.webhookSecret, `${t}.${payload}`);
      if (!v1.some((candidate) => constantTimeEqual(candidate, expected))) {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "signature mismatch");
      }

      let event: { type?: unknown; data?: { object?: unknown } };
      try {
        event = JSON.parse(payload);
      } catch {
        return { kind: "unrecognized", intentId: null, raw: payload };
      }
      const type = typeof event.type === "string" ? event.type : "";
      const object = (event.data?.object ?? {}) as { id?: unknown; payment_intent?: unknown; amount?: unknown };
      const objectId = typeof object.id === "string" ? object.id : null;
      const linkedIntent = typeof object.payment_intent === "string" ? object.payment_intent : null;

      switch (type) {
        case "payment_intent.succeeded":
          return { kind: "payment_succeeded", intentId: objectId, raw: event };
        case "payment_intent.payment_failed":
        case "payment_intent.canceled":
          return { kind: "payment_failed", intentId: objectId, raw: event };
        case "charge.refunded":
        case "refund.updated":
        case "refund.created":
          return { kind: "refund_completed", intentId: linkedIntent ?? objectId, raw: event };
        default:
          return { kind: "unrecognized", intentId: objectId ?? linkedIntent, raw: event };
      }
    },
  };
}

/** Pull the succeeded PaymentIntent's amount (minor units) from a verified event, if present. */
export function webhookIntentAmount(raw: unknown): number | null {
  const ev = raw as { data?: { object?: { amount?: unknown; amount_received?: unknown } } };
  const obj = ev?.data?.object ?? {};
  const amount = (obj as { amount_received?: unknown }).amount_received ?? (obj as { amount?: unknown }).amount;
  return typeof amount === "number" && Number.isInteger(amount) ? amount : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/**
 * F4 refund accounting — interpret a verified refund event (charge.refunded /
 * refund.created / refund.updated) against the SERVER-authoritative payment
 * amount. Mirror of packages/adapters/src/stripePayment.ts#interpretRefundEvent.
 *
 *  - `refundedTotal` — cumulative amount refunded so far, in minor units:
 *    a Charge object carries `amount_refunded`; a bare Refund object carries
 *    only its own `amount` (best-effort cumulative).
 *  - `isFullyRefunded` — true ONLY when refundedTotal ≥ the server amount. A
 *    partial refund is NOT full, so the booking must NOT be driven to refunded.
 *  - `refundId` — the Stripe refund id (re_…) used as the DEDUPE key. A charge
 *    carries it under refunds.data[]; a bare refund object is its own id. A
 *    replayed identical event yields the SAME id ⇒ the unique insert is a no-op.
 */
export interface RefundOutcome {
  refundId: string | null;
  refundedTotal: number | null;
  isFullyRefunded: boolean;
}

export function interpretRefundEvent(raw: unknown, serverAmount: number): RefundOutcome {
  const ev = raw as { data?: { object?: Record<string, unknown> } };
  const obj = (ev?.data?.object ?? {}) as Record<string, unknown>;

  let refundedTotal = intOrNull(obj.amount_refunded);
  let refundId: string | null = null;

  const refunds = (obj.refunds as { data?: unknown } | undefined)?.data;
  if (Array.isArray(refunds) && refunds.length > 0) {
    const last = refunds[refunds.length - 1] as { id?: unknown };
    if (typeof last.id === "string") refundId = last.id;
  }
  if (obj.object === "refund") {
    if (typeof obj.id === "string") refundId = obj.id;
    if (refundedTotal === null) refundedTotal = intOrNull(obj.amount);
  }

  const isFullyRefunded = refundedTotal !== null && refundedTotal >= serverAmount;
  return { refundId, refundedTotal, isFullyRefunded };
}
