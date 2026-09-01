import { constantTimeEqual, hmacSha256Hex, randomHex } from "./webhookCrypto";
import {
  CreateIntentInput,
  Money,
  PaymentError,
  PaymentIntentRef,
  PaymentProvider,
  PaymentState,
  WebhookEvent,
} from "@lumin/contracts";

/**
 * MockPaymentProvider — SI-12: full development flow with zero external
 * credentials. In-memory intents, idempotent creation.
 *
 * DEV MOCK ONLY. Webhook authenticity here uses an HMAC-SHA256 over the raw
 * payload keyed by a per-provider `webhookSecret`, with a constant-time
 * comparison and a replay guard. This mirrors the SHAPE of real verification
 * but is NOT a substitute for it: real providers (Stripe, Mercado Pago, …)
 * MUST implement their own provider-native signature verification and replay
 * protection inside their own PaymentProviderContract adapter.
 */

export interface MockPaymentProviderOptions {
  now?: () => string;
  /** When true, the next createIntent call fails (then the flag resets). */
  failNextIntent?: boolean;
  /**
   * Secret keying webhook HMAC signatures. Supply the SAME secret to
   * signMockWebhook to produce a verifiable delivery. Defaults to a random
   * per-instance secret, which makes unsigned/forged deliveries unverifiable.
   */
  webhookSecret?: string;
}

export interface MockPaymentProvider extends PaymentProvider {
  /** Drive a test/UI payment to its outcome. */
  completePayment(intentId: string, outcome: "succeeded" | "failed"): PaymentIntentRef;
  /** Arm a one-shot failure for the next createIntent call. */
  armFailure(): void;
  /** Inspection: all intents ever created, in creation order. */
  listIntents(): PaymentIntentRef[];
  /** Inspection: refunds issued against an intent. */
  listRefunds(intentId: string): { refundId: string; amount: Money }[];
}

/** Trivial deterministic hash (djb2) — opaque intent ids only, NOT crypto. */
export function mockHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * Signature a legitimate mock webhook delivery carries for `payload`.
 * Keyed HMAC-SHA256 — the caller MUST know the provider's `webhookSecret`;
 * a keyless hash (as before) was trivially forgeable.
 */
export function signMockWebhook(payload: string, secret: string): string {
  return `mock-sig-${hmacSha256Hex(secret, payload)}`;
}

/** Constant-time string equality (length-safe). */
function safeEqual(a: string, b: string): boolean {
  return constantTimeEqual(a, b);
}

interface IntentState {
  ref: PaymentIntentRef;
  tenantId: string;
  bookingId: string;
  refundedMinorUnits: number;
  refunds: { refundId: string; amount: Money }[];
}

export function createMockPaymentProvider(opts: MockPaymentProviderOptions = {}): MockPaymentProvider {
  const intents = new Map<string, IntentState>(); // intentId → state
  const byIdempotencyKey = new Map<string, string>(); // key → intentId
  const seenWebhookEvents = new Set<string>(); // replay guard (verified events)
  const webhookSecret = opts.webhookSecret ?? randomHex(32);
  let failNext = opts.failNextIntent ?? false;
  let counter = 0;

  function mustGet(intentId: string): IntentState {
    const state = intents.get(intentId);
    if (!state) throw new PaymentError("PAYMENT_FAILED", `unknown intent ${intentId}`);
    return state;
  }

  return {
    providerName: "mock",

    async createIntent(input: CreateIntentInput): Promise<PaymentIntentRef> {
      // Idempotent: the same key NEVER creates a second charge.
      const existingId = byIdempotencyKey.get(input.idempotencyKey);
      if (existingId) return { ...mustGet(existingId).ref };

      if (failNext) {
        failNext = false;
        throw new PaymentError("PROVIDER_UNAVAILABLE", "mock provider failure (armed)");
      }

      counter += 1;
      const intentId = `mpi_${counter}_${mockHash(input.idempotencyKey)}`;
      const ref: PaymentIntentRef = {
        intentId,
        clientToken: `mock_tok_${intentId}`,
        state: "requires_payment",
        amount: { ...input.amount },
      };
      intents.set(intentId, {
        ref,
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        refundedMinorUnits: 0,
        refunds: [],
      });
      byIdempotencyKey.set(input.idempotencyKey, intentId);
      return { ...ref };
    },

    async getIntent(intentId: string): Promise<PaymentIntentRef | null> {
      const state = intents.get(intentId);
      return state ? { ...state.ref } : null;
    },

    async cancelIntent(intentId: string): Promise<void> {
      const state = mustGet(intentId);
      if (state.ref.state !== "requires_payment" && state.ref.state !== "processing") {
        throw new PaymentError("ILLEGAL_TRANSITION", `cannot cancel intent in state ${state.ref.state}`);
      }
      state.ref.state = "failed";
    },

    async refund(intentId: string, amount: Money): Promise<{ refundId: string }> {
      const state = mustGet(intentId);
      if (amount.currency !== state.ref.amount.currency) {
        throw new PaymentError("INVALID_REQUEST", "refund currency mismatch");
      }
      if (amount.amount <= 0) throw new PaymentError("INVALID_REQUEST", "refund amount must be positive");
      const refundable: PaymentState[] = ["succeeded", "partially_refunded"];
      if (!refundable.includes(state.ref.state)) {
        throw new PaymentError("ILLEGAL_TRANSITION", `cannot refund intent in state ${state.ref.state}`);
      }
      if (state.refundedMinorUnits + amount.amount > state.ref.amount.amount) {
        throw new PaymentError("INVALID_REQUEST", "refund exceeds captured amount");
      }
      state.refundedMinorUnits += amount.amount;
      state.ref.state = state.refundedMinorUnits === state.ref.amount.amount ? "refunded" : "partially_refunded";
      const refundId = `mre_${state.refunds.length + 1}_${intentId}`;
      state.refunds.push({ refundId, amount: { ...amount } });
      return { refundId };
    },

    async parseWebhook(payload: string, signatureHeader: string | null): Promise<WebhookEvent> {
      // SI-10: never process an unverified payload. HMAC keyed by the
      // provider secret, compared in constant time.
      if (signatureHeader === null || !safeEqual(signatureHeader, signMockWebhook(payload, webhookSecret))) {
        throw new PaymentError("WEBHOOK_UNVERIFIED");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return { kind: "unrecognized", intentId: null, raw: payload };
      }
      const body = parsed as { kind?: unknown; intentId?: unknown; id?: unknown };
      // Replay guard: a verified event is processed at most once. Key on the
      // event id when present, else the exact payload (a re-delivered identical
      // event is a replay). Only verified events are recorded, so rejected
      // signatures never poison the set.
      const eventKey = typeof body.id === "string" ? `id:${body.id}` : `payload:${payload}`;
      if (seenWebhookEvents.has(eventKey)) {
        throw new PaymentError("WEBHOOK_UNVERIFIED", "replayed webhook event");
      }
      seenWebhookEvents.add(eventKey);
      const kinds = ["payment_succeeded", "payment_failed", "refund_completed"] as const;
      const kind = kinds.find((k) => k === body.kind) ?? "unrecognized";
      const intentId = typeof body.intentId === "string" ? body.intentId : null;
      return { kind, intentId, raw: parsed };
    },

    completePayment(intentId: string, outcome: "succeeded" | "failed"): PaymentIntentRef {
      const state = mustGet(intentId);
      if (state.ref.state !== "requires_payment" && state.ref.state !== "processing") {
        throw new PaymentError("ILLEGAL_TRANSITION", `cannot complete intent in state ${state.ref.state}`);
      }
      state.ref.state = outcome === "succeeded" ? "succeeded" : "failed";
      return { ...state.ref };
    },

    armFailure(): void {
      failNext = true;
    },

    listIntents(): PaymentIntentRef[] {
      return [...intents.values()].map((s) => ({ ...s.ref }));
    },

    listRefunds(intentId: string): { refundId: string; amount: Money }[] {
      return mustGet(intentId).refunds.map((r) => ({ refundId: r.refundId, amount: { ...r.amount } }));
    },
  };
}
