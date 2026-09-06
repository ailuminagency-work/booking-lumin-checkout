/**
 * StripePaymentProvider — REAL Stripe (TEST MODE) behind the PaymentProvider
 * contract (packages/contracts/src/payment.ts).
 *
 * ┌─ SECRET HANDLING (SI-5) ──────────────────────────────────────────────┐
 * │ `secretKey` and `webhookSecret` are SERVER-ONLY. This adapter is        │
 * │ constructed exclusively inside trusted server runtime (Supabase Edge    │
 * │ Functions with service_role); it must NEVER be instantiated in, nor its │
 * │ options bundled to, the browser. Only `clientToken` (Stripe's           │
 * │ non-secret client_secret) ever crosses to the frontend.                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * No `stripe` npm SDK is used (avoids a new dependency and keeps the adapter
 * cross-environment): the Stripe REST API is called directly with
 * `application/x-www-form-urlencoded` bodies via an injected `fetchImpl`.
 *
 * Stripe uses MINOR UNITS for `amount` (cents) — the same unit as MoneyContract
 * — so no scaling is applied. The amount charged is ALWAYS the server-computed
 * `input.amount`; the adapter never accepts a client-supplied amount (SI-1).
 *
 * Idempotency is Stripe-native: `createIntent` sends the caller's
 * `idempotencyKey` as the `Idempotency-Key` HTTP header, so a retried create
 * with the same key returns Stripe's ORIGINAL intent and never charges twice —
 * even if the retried request body was tampered with (Stripe replays the first
 * response; the altered amount is ignored).
 */

import { constantTimeEqual, hmacSha256Hex } from "./webhookCrypto";
import {
  CreateIntentInput,
  Money,
  PaymentError,
  PaymentIntentRef,
  PaymentProvider,
  PaymentState,
  WebhookEvent,
} from "@lumin/contracts";

export interface StripePaymentProviderOptions {
  /** Stripe secret key (sk_test_… in test mode). SERVER-ONLY (SI-5). */
  secretKey: string;
  /** Stripe webhook signing secret (whsec_…). SERVER-ONLY (SI-5). */
  webhookSecret: string;
  /** API base; defaults to Stripe production host (test mode is key-scoped). */
  apiBase?: string;
  /** Injected fetch (default global fetch). Tests inject the fake Stripe. */
  fetchImpl?: typeof fetch;
  /** Injected clock in epoch MILLISECONDS (default Date.now). Used for webhook skew. */
  now?: () => number;
}

/** Stripe's clock-skew tolerance for webhook timestamps: 5 minutes. */
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** Minimal shape of a Stripe PaymentIntent we depend on. */
interface StripePaymentIntent {
  id: string;
  object?: string;
  status: string;
  amount: number;
  currency: string;
  client_secret: string | null;
}

/** Map a Stripe PaymentIntent.status → contract PaymentState. */
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
      // Unknown/future status: fail closed to a non-terminal, non-succeeded
      // state so it can never be mistaken for a completed payment.
      return "requires_payment";
  }
}

/** application/x-www-form-urlencoded body from nested params (metadata[...]). */
function formEncode(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

function toMoney(intent: StripePaymentIntent): Money {
  return { amount: intent.amount, currency: intent.currency.toUpperCase() };
}

function toRef(intent: StripePaymentIntent): PaymentIntentRef {
  return {
    intentId: intent.id,
    // Stripe's client_secret is a non-secret, single-intent token used by the
    // browser to confirm the payment. It is NOT the account secret key.
    clientToken: intent.client_secret ?? "",
    state: mapIntentStatus(intent.status),
    amount: toMoney(intent),
  };
}

/**
 * Test helper: produce a real-scheme Stripe `Stripe-Signature` header value for
 * `payload`, signed with `secret` at unix-seconds timestamp `ts`.
 * Scheme: `t=<ts>,v1=<hex hmac_sha256(secret, "<ts>.<payload>")>`.
 */
export function signStripeTestWebhook(payload: string, secret: string, ts: number): string {
  const signature = hmacSha256Hex(secret, `${ts}.${payload}`);
  return `t=${ts},v1=${signature}`;
}

/** Parse a `t=…,v1=…[,v1=…]` header into its timestamp and v1 signatures. */
function parseSignatureHeader(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const parsed = Number(value);
      t = Number.isFinite(parsed) ? parsed : null;
    } else if (key === "v1") {
      v1.push(value);
    }
  }
  return { t, v1 };
}

export function createStripePaymentProvider(opts: StripePaymentProviderOptions): PaymentProvider {
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
    providerName: "stripe",

    async createIntent(input: CreateIntentInput): Promise<PaymentIntentRef> {
      // SI-1: the adapter charges ONLY the server-computed amount. Reject a
      // non-positive or malformed amount before any network call so a mispriced
      // charge can never reach Stripe.
      const amount = input.amount.amount;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new PaymentError("INVALID_REQUEST", "charge amount must be a positive integer (minor units)");
      }

      const body = formEncode({
        amount, // MINOR UNITS — Stripe's native unit, same as MoneyContract.
        currency: input.amount.currency.toLowerCase(),
        // `amount`/`currency` above come only from the server-computed
        // `input.amount`; there is no client-controllable amount path (SI-1).
        "metadata[tenantId]": input.tenantId,
        "metadata[bookingId]": input.bookingId,
        ...encodeMetadata(input.metadata),
        // Modern PI setup: no explicit payment_method_types needed.
        "automatic_payment_methods[enabled]": "true",
      });

      const res = await doFetch(`${apiBase}/v1/payment_intents`, {
        method: "POST",
        // Stripe-native idempotency: the SAME key returns the ORIGINAL intent
        // (no second charge), even if this retried body was altered (D8/D23).
        headers: authHeaders({ "Idempotency-Key": input.idempotencyKey }),
        body,
      });
      if (!res.ok) {
        const err = await readJson(res);
        throw new PaymentError("PROVIDER_UNAVAILABLE", stripeErrorMessage(err) ?? "stripe createIntent failed");
      }
      return toRef((await readJson(res)) as StripePaymentIntent);
    },

    async getIntent(intentId: string): Promise<PaymentIntentRef | null> {
      const res = await doFetch(`${apiBase}/v1/payment_intents/${encodeURIComponent(intentId)}`, {
        method: "GET",
        headers: authHeaders(),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const err = await readJson(res);
        throw new PaymentError("PROVIDER_UNAVAILABLE", stripeErrorMessage(err) ?? "stripe getIntent failed");
      }
      return toRef((await readJson(res)) as StripePaymentIntent);
    },

    async cancelIntent(intentId: string): Promise<void> {
      const res = await doFetch(`${apiBase}/v1/payment_intents/${encodeURIComponent(intentId)}/cancel`, {
        method: "POST",
        headers: authHeaders(),
        body: "",
      });
      if (!res.ok) {
        const err = await readJson(res);
        throw new PaymentError("PROVIDER_UNAVAILABLE", stripeErrorMessage(err) ?? "stripe cancelIntent failed");
      }
    },

    async refund(intentId: string, amount: Money): Promise<{ refundId: string }> {
      if (!Number.isSafeInteger(amount.amount) || amount.amount <= 0) {
        throw new PaymentError("INVALID_REQUEST", "refund amount must be a positive integer (minor units)");
      }
      // Passing `amount` makes this a PARTIAL refund when it is less than the
      // captured total, and a FULL refund when it equals it; Stripe rejects an
      // amount above the captured total (over-refund).
      const res = await doFetch(`${apiBase}/v1/refunds`, {
        method: "POST",
        headers: authHeaders(),
        body: formEncode({ payment_intent: intentId, amount: amount.amount }),
      });
      if (!res.ok) {
        const err = await readJson(res);
        throw new PaymentError("PROVIDER_UNAVAILABLE", stripeErrorMessage(err) ?? "stripe refund failed");
      }
      const refund = (await readJson(res)) as { id: string };
      return { refundId: refund.id };
    },

    async parseWebhook(payload: string, signatureHeader: string | null): Promise<WebhookEvent> {
      // SI-10: never process an unverified payload. Implements Stripe's real
      // signature scheme: header `t=<ts>,v1=<hex hmac_sha256(secret,"<ts>.<payload>")>`.
      if (signatureHeader === null || signatureHeader === "") {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "missing Stripe-Signature header");
      }
      const { t, v1 } = parseSignatureHeader(signatureHeader);
      if (t === null || v1.length === 0) {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "malformed Stripe-Signature header");
      }
      // Reject stale/future deliveries outside the 5-minute tolerance — this is
      // the coarse replay window; fine-grained dedup is the booking layer's job.
      const nowSec = Math.floor(now() / 1000);
      if (Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SECONDS) {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "timestamp outside tolerance");
      }
      const expected = hmacSha256Hex(opts.webhookSecret, `${t}.${payload}`);
      // Constant-time compare against every provided v1 signature.
      const verified = v1.some((candidate) => constantTimeEqual(candidate, expected));
      if (!verified) {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "signature mismatch");
      }

      // REPLAY GUARD NOTE: a verified webhook can still be RE-DELIVERED (Stripe
      // retries, or an attacker replays the exact signed bytes within the 5-min
      // window). This adapter does NOT dedup — deduplication is the booking
      // layer's responsibility: `payments(provider, provider_intent_id)` is
      // UNIQUE (migration 0005) and confirmation is idempotent
      // (pending_payment→confirmed exactly once), so a replayed
      // payment_intent.succeeded maps to an already-confirmed booking and is a
      // no-op. Keeping the adapter stateless keeps verification pure and lets
      // the DB be the single source of replay truth (SI-3).
      let event: { id?: unknown; type?: unknown; data?: { object?: unknown } };
      try {
        event = JSON.parse(payload);
      } catch {
        return { kind: "unrecognized", intentId: null, raw: payload };
      }
      return normalizeEvent(event);
    },
  };
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/**
 * F4 refund accounting — interpret a verified refund event (charge.refunded /
 * refund.created / refund.updated) against the SERVER-authoritative payment
 * amount. This is the pure decision the webhook handler applies; it is exported
 * (and mirrored in supabase/functions/_shared/stripe.ts) so the partial-vs-full
 * and dedupe-key behavior is unit-tested offline.
 *
 *  - `refundedTotal` — cumulative amount refunded so far (minor units). A Charge
 *    object carries `amount_refunded`; a bare Refund object carries only its own
 *    `amount` (best-effort cumulative).
 *  - `isFullyRefunded` — true ONLY when refundedTotal ≥ the server amount. A
 *    PARTIAL refund is NOT full, so the booking must NOT be driven to `refunded`
 *    (payments.state → partially_refunded; the booking stays confirmed/completed).
 *  - `refundId` — the Stripe refund id (re_…) used as the DEDUPE key: a charge
 *    carries it under refunds.data[], a bare refund object is its own id. A
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

/** metadata[key]=value form fields from an optional metadata bag. */
function encodeMetadata(metadata?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!metadata) return out;
  for (const [k, v] of Object.entries(metadata)) out[`metadata[${k}]`] = v;
  return out;
}

function stripeErrorMessage(err: unknown): string | undefined {
  const e = err as { error?: { message?: unknown } };
  return typeof e?.error?.message === "string" ? e.error.message : undefined;
}

/** Map a verified Stripe event → normalized, provider-agnostic WebhookEvent. */
function normalizeEvent(event: { type?: unknown; data?: { object?: unknown } }): WebhookEvent {
  const type = typeof event.type === "string" ? event.type : "";
  const object = (event.data?.object ?? {}) as {
    id?: unknown;
    payment_intent?: unknown;
    status?: unknown;
  };
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
      // For refund/charge events the PaymentIntent id lives on `payment_intent`.
      return { kind: "refund_completed", intentId: linkedIntent ?? objectId, raw: event };
    default:
      return { kind: "unrecognized", intentId: objectId ?? linkedIntent, raw: event };
  }
}
