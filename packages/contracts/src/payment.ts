import { z } from "zod";
import { Money } from "./money";
import { TenantId } from "./tenant";

/**
 * PaymentProviderContract v1
 *
 * Every external payment service sits behind this adapter. Domain code knows
 * only this interface; provider SDKs, API keys, and webhook formats never
 * cross it. Credentials belong to exactly one tenant connection and NEVER
 * reach the browser (Security Invariants 5 & 8).
 *
 * Development uses MockPaymentProvider. Real providers (Stripe, Mercado
 * Pago, Mollie, …) are added later as separate adapter implementations and
 * connected per-tenant, only after security gates pass.
 */

export const PaymentState = z.enum([
  "requires_payment",
  "processing",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);
export type PaymentState = z.infer<typeof PaymentState>;

export const PaymentIntentRef = z.object({
  /** Adapter-scoped intent id (opaque to the domain). */
  intentId: z.string().min(1),
  /** Token the frontend needs to drive the provider's payment UI. Not a secret key. */
  clientToken: z.string().min(1),
  state: PaymentState,
  amount: Money,
});
export type PaymentIntentRef = z.infer<typeof PaymentIntentRef>;

export interface CreateIntentInput {
  tenantId: TenantId;
  bookingId: string;
  amount: Money;
  /** Same idempotency key as the booking: retries must not double-charge. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface WebhookEvent {
  /** Normalized event kind, provider-agnostic. */
  kind: "payment_succeeded" | "payment_failed" | "refund_completed" | "unrecognized";
  intentId: string | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly providerName: string;
  createIntent(input: CreateIntentInput): Promise<PaymentIntentRef>;
  getIntent(intentId: string): Promise<PaymentIntentRef | null>;
  cancelIntent(intentId: string): Promise<void>;
  refund(intentId: string, amount: Money): Promise<{ refundId: string }>;
  /**
   * Verify authenticity and normalize a webhook delivery.
   * MUST throw PaymentError("WEBHOOK_UNVERIFIED") when the signature cannot
   * be verified (Security Invariant 10) — never process unverified payloads.
   */
  parseWebhook(payload: string, signatureHeader: string | null): Promise<WebhookEvent>;
}

export const PaymentRecord = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  bookingId: z.string().uuid(),
  provider: z.string(),
  providerIntentId: z.string(),
  state: PaymentState,
  amount: Money,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaymentRecord = z.infer<typeof PaymentRecord>;
