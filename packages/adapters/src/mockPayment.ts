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
 * credentials. In-memory intents, idempotent creation, deterministic
 * webhook "signatures".
 */

export interface MockPaymentProviderOptions {
  now?: () => string;
  /** When true, the next createIntent call fails (then the flag resets). */
  failNextIntent?: boolean;
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

/** Trivial deterministic hash (djb2) — mock signatures only, NOT crypto. */
export function mockHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Signature a legitimate mock webhook delivery carries for `payload`. */
export function signMockWebhook(payload: string): string {
  return `mock-sig-${mockHash(payload)}`;
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
      // SI-10: never process an unverified payload.
      if (signatureHeader === null || signatureHeader !== signMockWebhook(payload)) {
        throw new PaymentError("WEBHOOK_UNVERIFIED");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return { kind: "unrecognized", intentId: null, raw: payload };
      }
      const body = parsed as { kind?: unknown; intentId?: unknown };
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
