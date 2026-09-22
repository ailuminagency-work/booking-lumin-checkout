// payment-gateway.ts — the server-side payment seam for the confirm authority.
//
// R2 (payment authority) / R6 (secret boundary): a booking is charged ONLY here,
// server-side, for the SERVER-recomputed amount (integer minor units + currency).
// Provider secrets are read from the environment, used server-only, and NEVER
// returned to a caller or logged.
//
// The seam is a thin, synchronous CAPTURE surface (charge + refund) over the
// provider-neutral MerchantPaymentProvider contract (@lumin/payments):
//
//   * DEFAULT — the in-memory MOCK MerchantPaymentProvider (createMockMerchant
//     ProviderA). Zero external credentials; a direct charge captures
//     immediately. This is what `npm test` / the integration harness exercise.
//   * STRIPE TEST — only when STRIPE_SECRET_KEY is configured. A minimal,
//     self-contained PaymentIntents(confirm=true) capture in Stripe TEST mode,
//     with a Stripe-native Idempotency-Key (RC-3 RISK-1) so a retry never
//     double-charges and a compensation refund is idempotent. The secret key
//     is read from env, sent only to api.stripe.com, and never surfaced.
//
// The confirm route pins the amount it charges to its own server reprice, so no
// provider can widen the charge: `charge()` sends exactly `input.amount`.

import { PaymentError } from "@lumin/contracts";
import { createMockMerchantProviderA, type MerchantPaymentProvider, type ProviderCapability } from "@lumin/payments";
import type { Money } from "./confirm-pricing";

export interface ChargeInput {
  tenantId: string;
  bookingId: string;
  amount: Money;
  /** Booking idempotency_key — a retry with the same key must NOT double-charge. */
  idempotencyKey: string;
}

export interface ChargeResult {
  chargeId: string;
  provider: string;
  amount: Money;
}

/** A verified DECLINE / provider failure — the booking must NOT confirm. */
export class PaymentDeclined extends Error {
  constructor(message = "payment was not captured") {
    super(message);
    this.name = "PaymentDeclined";
  }
}

export interface PaymentGateway {
  readonly providerName: string;
  /** Capture the amount synchronously. Throws PaymentDeclined if not captured. */
  charge(input: ChargeInput): Promise<ChargeResult>;
  /** Full refund of a prior capture (F1 compensation). Idempotent per provider. */
  refund(chargeId: string, amount: Money, idempotencyKey: string): Promise<{ refundId: string }>;
}

// ---------------------------------------------------------------------------
// Mock gateway — the default. Wraps the mock MerchantPaymentProvider.
// ---------------------------------------------------------------------------

/**
 * The mock provider declares a fixed country/currency/method footprint. The
 * confirm route is provider-neutral about the customer's method; for the mock we
 * present a `card` charge in the caller's country. The capability is widened to
 * accept whatever currency the server reprice produced so a dev/test tenant in
 * any currency can be charged deterministically without external credentials.
 */
export function createMockPaymentGateway(
  provider: MerchantPaymentProvider & { readonly capability?: ProviderCapability } = createMockMerchantProviderA(),
  country = "US",
): PaymentGateway {
  return {
    providerName: provider.providerName,
    async charge(input: ChargeInput): Promise<ChargeResult> {
      let charge;
      try {
        charge = await provider.createCharge({
          tenantId: input.tenantId,
          reference: input.bookingId,
          amount: input.amount,
          country: country as never,
          method: "card",
          idempotencyKey: input.idempotencyKey,
        });
      } catch (e) {
        // A provider refusal (PROVIDER_UNAVAILABLE / INVALID_REQUEST) is a
        // decline for our purposes: the booking must not confirm.
        throw new PaymentDeclined(e instanceof PaymentError ? e.code : "provider error");
      }
      if (charge.state !== "captured") throw new PaymentDeclined(`unexpected charge state ${charge.state}`);
      return { chargeId: charge.chargeId, provider: charge.provider, amount: charge.captured };
    },
    async refund(chargeId: string, _amount: Money, _idempotencyKey: string): Promise<{ refundId: string }> {
      const refunded = await provider.refund(chargeId);
      // The mock charge id is stable per idempotency key; the DB-level dedupe
      // (payment.state='refunded' + unique refund row) makes the compensation
      // idempotent even though the mock provider itself is single-shot.
      return { refundId: `${refunded.chargeId}:refund` };
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe TEST gateway — only constructed when STRIPE_SECRET_KEY is present.
// ---------------------------------------------------------------------------

interface StripeIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

/**
 * Minimal Stripe TEST-mode capture. Self-contained (no SDK), form-encoded REST,
 * Bearer secret key from env. A confirmed PaymentIntent with the test card token
 * captures synchronously in TEST mode. The Idempotency-Key is the booking
 * idempotency_key (create) / `refund_<key>` (refund) so retries never duplicate.
 * SECRET STAYS SERVER-ONLY: the key is only sent to api.stripe.com, never
 * returned or logged.
 */
export function createStripeTestPaymentGateway(
  secretKey: string,
  deps: { fetchImpl?: typeof fetch; apiBase?: string } = {},
): PaymentGateway {
  const apiBase = (deps.apiBase ?? "https://api.stripe.com").replace(/\/$/, "");
  const doFetch = deps.fetchImpl ?? fetch;
  const headers = (idem: string): Record<string, string> => ({
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Idempotency-Key": idem,
  });

  return {
    providerName: "stripe-test",
    async charge(input: ChargeInput): Promise<ChargeResult> {
      if (!Number.isSafeInteger(input.amount.amount) || input.amount.amount <= 0) {
        throw new PaymentDeclined("charge amount must be a positive integer (minor units)");
      }
      const body = new URLSearchParams();
      body.set("amount", String(input.amount.amount));
      body.set("currency", input.amount.currency.toLowerCase());
      body.set("confirm", "true");
      body.set("payment_method", "pm_card_visa"); // Stripe TEST-mode card token
      body.set("automatic_payment_methods[enabled]", "true");
      body.set("automatic_payment_methods[allow_redirects]", "never");
      body.set("metadata[tenantId]", input.tenantId);
      body.set("metadata[bookingId]", input.bookingId);
      let intent: StripeIntent;
      try {
        const res = await doFetch(`${apiBase}/v1/payment_intents`, {
          method: "POST",
          headers: headers(input.idempotencyKey),
          body: body.toString(),
        });
        if (!res.ok) throw new PaymentDeclined("stripe createIntent failed");
        intent = (await res.json()) as StripeIntent;
      } catch (e) {
        throw e instanceof PaymentDeclined ? e : new PaymentDeclined("stripe unreachable");
      }
      if (intent.status !== "succeeded") throw new PaymentDeclined(`intent status ${intent.status}`);
      return {
        chargeId: intent.id,
        provider: "stripe",
        amount: { amount: intent.amount, currency: intent.currency.toUpperCase() },
      };
    },
    async refund(chargeId: string, amount: Money, idempotencyKey: string): Promise<{ refundId: string }> {
      const body = new URLSearchParams();
      body.set("payment_intent", chargeId);
      body.set("amount", String(amount.amount));
      const res = await doFetch(`${apiBase}/v1/refunds`, {
        method: "POST",
        headers: headers(`refund_${idempotencyKey}`),
        body: body.toString(),
      });
      if (!res.ok) throw new Error("stripe refund failed");
      const refund = (await res.json()) as { id: string };
      return { refundId: refund.id };
    },
  };
}

/**
 * Select the payment gateway from the environment. STRIPE_SECRET_KEY (a TEST key
 * — `sk_test_…`) enables the Stripe TEST gateway; otherwise the MOCK gateway is
 * used. The key never leaves this module except in a request to Stripe.
 */
export function paymentGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentGateway {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (secret && secret.length > 0) return createStripeTestPaymentGateway(secret);
  return createMockPaymentGateway();
}
