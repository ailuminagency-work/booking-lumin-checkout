import { z } from "zod";
import { Money, TenantId } from "@lumin/contracts";
import { CountryCode, PaymentMethod } from "./capability";

/**
 * MerchantPaymentProviderContract v1
 *
 * The provider-neutral contract for how a TENANT collects money from THEIR
 * customers. It is a richer, additive SUPERSET of the minimal
 * `PaymentProvider` contract in @lumin/contracts.
 *
 * Relationship to the existing contract (do NOT confuse the two):
 *  - @lumin/contracts `PaymentProvider` is the minimal charge/refund/webhook
 *    surface the RC-3 Stripe adapter implements TODAY (createIntent, getIntent,
 *    cancelIntent, refund, parseWebhook). It stays exactly as-is.
 *  - `MerchantPaymentProvider` (this file) is the FULLER merchant-collection
 *    surface: it adds authorize/capture, partial refunds, saved methods and
 *    method discovery, and optional marketplace/connect onboarding. A future
 *    `StripeMerchantAdapter` would implement THIS interface; the existing
 *    minimal adapter is unaffected.
 *
 * Everything here is provider-neutral. Money is always integer minor units +
 * an explicit ISO-4217 currency. Not every provider supports every capability
 * — operations a provider does not declare MUST throw
 * PaymentError("PROVIDER_UNAVAILABLE"); the capability registry + routing
 * layer keep callers from reaching for an unsupported flow in the first place.
 */

/**
 * Normalized, provider-agnostic lifecycle of a merchant charge. Richer than
 * the minimal contract's `PaymentState` (it distinguishes an authorization
 * held-but-not-captured), but maps cleanly onto it:
 *   requires_action / authorized      -> requires_payment / processing
 *   captured                          -> succeeded
 *   failed / canceled                 -> failed
 *   refunded / partially_refunded     -> refunded / partially_refunded
 */
export const MerchantPaymentState = z.enum([
  "requires_action", // customer action needed (3DS, redirect, voucher)
  "authorized", // funds held, not yet captured (auth/capture flow)
  "captured", // funds captured — the money moved
  "failed",
  "canceled",
  "refunded",
  "partially_refunded",
]);
export type MerchantPaymentState = z.infer<typeof MerchantPaymentState>;

/** A normalized handle on a merchant charge, opaque provider id inside. */
export const MerchantCharge = z.object({
  chargeId: z.string().min(1),
  provider: z.string().min(1),
  state: MerchantPaymentState,
  /** Amount originally authorized/charged. */
  amount: Money,
  /** Amount actually captured so far (<= amount). */
  captured: Money,
  /** Amount refunded so far (<= captured). */
  refunded: Money,
  method: PaymentMethod,
});
export type MerchantCharge = z.infer<typeof MerchantCharge>;

export interface CreateChargeInput {
  tenantId: TenantId;
  /** Opaque reference from the tenant's domain (booking id, order id, …). */
  reference: string;
  amount: Money;
  country: CountryCode;
  method: PaymentMethod;
  /** Retries with the same key MUST NOT create a second charge. */
  idempotencyKey: string;
  /** Token from saveMethod, to charge a stored method (merchant-initiated). */
  savedMethodId?: string;
  metadata?: Record<string, string>;
}

export interface AuthorizeInput extends CreateChargeInput {}

export interface SaveMethodInput {
  tenantId: TenantId;
  /** Opaque per-customer key (session key / customer id) owning the method. */
  customerRef: string;
  method: PaymentMethod;
  country: CountryCode;
  currency: string;
}

export interface SavedMethodRef {
  savedMethodId: string;
  provider: string;
  method: PaymentMethod;
}

export interface MarketplaceAccountInput {
  tenantId: TenantId;
  /** The sub-merchant/seller being onboarded to collect via the platform. */
  sellerRef: string;
  country: CountryCode;
  currency: string;
}

export interface MarketplaceAccountRef {
  accountId: string;
  provider: string;
  onboardingComplete: boolean;
}

/**
 * The provider-neutral merchant payment contract. An adapter implements the
 * operations its capability record declares; every other operation MUST throw
 * PaymentError("PROVIDER_UNAVAILABLE").
 */
export interface MerchantPaymentProvider {
  readonly providerName: string;

  // --- Simple charge (all providers) ---
  createCharge(input: CreateChargeInput): Promise<MerchantCharge>;
  getCharge(chargeId: string): Promise<MerchantCharge | null>;

  // --- Auth / capture (supportsAuthCapture) ---
  authorize(input: AuthorizeInput): Promise<MerchantCharge>;
  /** Capture up to the authorized amount; omit `amount` to capture in full. */
  capture(chargeId: string, amount?: Money): Promise<MerchantCharge>;

  // --- Refunds ---
  /** Full refund of the captured amount. */
  refund(chargeId: string): Promise<MerchantCharge>;
  /** Partial refund (supportsPartialRefund). */
  partialRefund(chargeId: string, amount: Money): Promise<MerchantCharge>;

  // --- Saved methods (supportsSavedMethods) ---
  saveMethod(input: SaveMethodInput): Promise<SavedMethodRef>;
  chargeSavedMethod(savedMethodId: string, input: CreateChargeInput): Promise<MerchantCharge>;

  // --- Method discovery (all providers) ---
  /** Which methods this provider can present for a country+currency pair. */
  listSupportedMethods(country: CountryCode, currency: string): PaymentMethod[];

  // --- Marketplace / connect (supportsMarketplace) ---
  onboardMarketplaceAccount(input: MarketplaceAccountInput): Promise<MarketplaceAccountRef>;
}
