import { z } from "zod";
import { CurrencyCode } from "@lumin/contracts";

/**
 * MerchantPaymentCapability v1
 *
 * A capability record describes WHAT a merchant payment provider can do —
 * which countries and currencies it settles, which payment methods it
 * presents, and which optional flows (auth/capture, partial refund, saved
 * methods, marketplace/connect) it supports.
 *
 * Capabilities are DATA, not code. The routing layer reads them to choose a
 * provider for a given transaction; no provider is ever assumed to be globally
 * sufficient. Adding a new provider is adding a capability record plus an
 * adapter — the core (routing + contract) never changes.
 *
 * This is deliberately provider-NEUTRAL and additive. It does not replace the
 * minimal `PaymentProvider` contract in @lumin/contracts (charge / refund /
 * webhook, used by the RC-3 Stripe path); it describes the richer
 * merchant-collection domain that `MerchantPaymentProvider` implements.
 */

/** ISO 3166-1 alpha-2 country code (uppercase). */
export const CountryCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 uppercase country code");
export type CountryCode = z.infer<typeof CountryCode>;

/**
 * Provider-neutral payment method families. A "method" is how the customer
 * pays, independent of the provider brand behind it.
 *  - card:         credit / debit card rails.
 *  - bank_transfer: push/pull bank transfer (SEPA, ACH, PIX, SPEI, …).
 *  - wallet:       tokenized wallet (Apple Pay, Google Pay, provider wallet).
 *  - local_scheme: a country-local scheme (OXXO, Boleto, iDEAL, …).
 *  - cash:         cash-on-collection / voucher-settled.
 */
export const PaymentMethod = z.enum(["card", "bank_transfer", "wallet", "local_scheme", "cash"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const ProviderCapability = z.object({
  /** Stable, opaque provider identifier (matches the adapter's providerName). */
  provider: z.string().min(1),
  /** ISO2 countries the provider can settle merchant collections in. */
  countries: z.array(CountryCode).nonempty(),
  /** ISO3 currencies the provider can charge and settle. */
  currencies: z.array(CurrencyCode).nonempty(),
  /** Payment method families the provider can present. */
  methods: z.array(PaymentMethod).nonempty(),
  /** Separate authorize then capture (delayed capture) is supported. */
  supportsAuthCapture: z.boolean(),
  /** Refunding less than the captured amount is supported. */
  supportsPartialRefund: z.boolean(),
  /** Tokenizing a method for later merchant-initiated charges is supported. */
  supportsSavedMethods: z.boolean(),
  /** Marketplace / connect onboarding + split settlement is supported. */
  supportsMarketplace: z.boolean(),
});
export type ProviderCapability = z.infer<typeof ProviderCapability>;

/**
 * The capability registry — plain data. Two mock providers with
 * INTENTIONALLY DIFFERENT capabilities, proving the abstraction: the same
 * routing + contract code works across providers whose feature sets do not
 * overlap.
 *
 * Provider A — "mock-merchant-a": a card/wallet processor for US + EU,
 *   USD/EUR. Supports auth/capture and saved methods. NO marketplace,
 *   NO partial refunds, NO bank transfer / local schemes.
 *
 * Provider B — "mock-merchant-b": a LATAM collector for MX + BR, MXN/BRL.
 *   Supports card + bank_transfer + local_scheme, partial refunds, saved
 *   methods, and marketplace/connect. NO auth/capture, NO wallet.
 */
export const providerCapabilities: ProviderCapability[] = [
  {
    provider: "mock-merchant-a",
    countries: ["US", "DE", "FR", "IE", "NL"],
    currencies: ["USD", "EUR"],
    methods: ["card", "wallet"],
    supportsAuthCapture: true,
    supportsPartialRefund: false,
    supportsSavedMethods: true,
    supportsMarketplace: false,
  },
  {
    provider: "mock-merchant-b",
    countries: ["MX", "BR"],
    currencies: ["MXN", "BRL"],
    methods: ["card", "bank_transfer", "local_scheme"],
    supportsAuthCapture: false,
    supportsPartialRefund: true,
    supportsSavedMethods: true,
    supportsMarketplace: true,
  },
];

/** Look up a capability record by provider id. */
export function capabilityFor(
  provider: string,
  capabilities: ProviderCapability[] = providerCapabilities,
): ProviderCapability | undefined {
  return capabilities.find((c) => c.provider === provider);
}

/** Does a capability serve this country? */
export function servesCountry(cap: ProviderCapability, country: CountryCode): boolean {
  return cap.countries.includes(country);
}

/** Does a capability settle this currency? */
export function servesCurrency(cap: ProviderCapability, currency: CurrencyCode): boolean {
  return cap.currencies.includes(currency);
}

/** Does a capability present this method? */
export function servesMethod(cap: ProviderCapability, method: PaymentMethod): boolean {
  return cap.methods.includes(method);
}
