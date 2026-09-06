/**
 * @lumin/payments — provider-NEUTRAL merchant payment collection.
 *
 * How a TENANT collects money from THEIR customers, abstracted over any
 * concrete provider. This package is STRICTLY ADDITIVE and does NOT replace or
 * modify the minimal `PaymentProvider` contract in @lumin/contracts (the
 * charge/refund/webhook surface the RC-3 Stripe adapter implements today).
 *
 * Three pieces work together, capability-first:
 *  1. capability.ts — ProviderCapability records (DATA): countries, currencies,
 *     methods, and optional-flow flags. A registry, not a hardcoded provider.
 *  2. contract.ts   — MerchantPaymentProvider, the fuller merchant contract
 *     (createCharge, authorize/capture, refund/partialRefund, saved methods,
 *     method discovery, marketplace onboarding) + normalized MerchantCharge.
 *  3. routing.ts    — selectProvider(), a pure, deterministic, capability-
 *     driven chooser that returns a match or an explicit NO_PROVIDER reason.
 *     No provider is ever assumed globally sufficient.
 *
 * mocks.ts ships two mock providers with INTENTIONALLY DIFFERENT capabilities,
 * proving the same routing + contract code works across non-overlapping
 * feature sets. Adding a real provider = one capability record + one adapter;
 * the core never changes.
 */

export * from "./capability";
export * from "./contract";
export * from "./routing";
export * from "./mocks";

export const PAYMENTS_VERSION = "0.1.0";
