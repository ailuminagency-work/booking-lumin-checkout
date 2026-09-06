import { Money, PaymentError } from "@lumin/contracts";
import { CountryCode, PaymentMethod, ProviderCapability, capabilityFor } from "./capability";
import {
  AuthorizeInput,
  CreateChargeInput,
  MarketplaceAccountInput,
  MarketplaceAccountRef,
  MerchantCharge,
  MerchantPaymentProvider,
  MerchantPaymentState,
  SaveMethodInput,
  SavedMethodRef,
} from "./contract";

/**
 * Two mock MerchantPaymentProvider implementations with INTENTIONALLY
 * DIFFERENT capabilities. They prove the abstraction: the SAME routing +
 * contract code drives both, even though their feature sets barely overlap.
 *
 * Provider A (mock-merchant-a): card + wallet, auth/capture, saved methods.
 *   NO partial refund, NO marketplace. US + EU, USD/EUR.
 * Provider B (mock-merchant-b): card + bank_transfer + local_scheme, partial
 *   refunds, saved methods, marketplace/connect. NO auth/capture, NO wallet.
 *   MX + BR, MXN/BRL.
 *
 * DEV MOCKS ONLY — in-memory, deterministic, zero external credentials.
 * Inspection getters expose internal state for hand-assertion in tests.
 */

interface ChargeState {
  charge: MerchantCharge;
  tenantId: string;
  reference: string;
}

export interface MockMerchantProvider extends MerchantPaymentProvider {
  /** The provider's declared capability record. */
  readonly capability: ProviderCapability;
  /** Inspection: every charge created, in creation order. */
  listCharges(): MerchantCharge[];
  /** Inspection: every saved method token minted. */
  listSavedMethods(): SavedMethodRef[];
  /** Inspection: every marketplace account onboarded. */
  listMarketplaceAccounts(): MarketplaceAccountRef[];
}

interface MockOptions {
  /** Override the capability record (defaults to the registry entry). */
  capability?: ProviderCapability;
}

function makeProvider(providerName: string, defaultCapability: ProviderCapability): MockMerchantProvider {
  const capability = defaultCapability;
  const charges = new Map<string, ChargeState>();
  const byIdempotencyKey = new Map<string, string>();
  const savedMethods = new Map<string, SavedMethodRef>();
  const marketplaceAccounts: MarketplaceAccountRef[] = [];
  let counter = 0;
  let savedCounter = 0;
  let acctCounter = 0;

  const zero = (like: Money): Money => ({ amount: 0, currency: like.currency });

  function mustGet(chargeId: string): ChargeState {
    const s = charges.get(chargeId);
    if (!s) throw new PaymentError("INVALID_REQUEST", `unknown charge ${chargeId}`);
    return s;
  }

  function assertServes(country: CountryCode, currency: string, method: PaymentMethod): void {
    if (!capability.countries.includes(country)) {
      throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not serve country ${country}`);
    }
    if (!capability.currencies.includes(currency)) {
      throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not settle currency ${currency}`);
    }
    if (!capability.methods.includes(method)) {
      throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not present method ${method}`);
    }
  }

  function newCharge(input: CreateChargeInput, state: MerchantPaymentState): MerchantCharge {
    counter += 1;
    const chargeId = `${providerName}_chg_${counter}`;
    const captured = state === "captured" ? { ...input.amount } : zero(input.amount);
    const charge: MerchantCharge = {
      chargeId,
      provider: providerName,
      state,
      amount: { ...input.amount },
      captured,
      refunded: zero(input.amount),
      method: input.method,
    };
    charges.set(chargeId, { charge, tenantId: input.tenantId, reference: input.reference });
    byIdempotencyKey.set(input.idempotencyKey, chargeId);
    return { ...charge };
  }

  function assertCurrencyMatch(charge: MerchantCharge, amount: Money): void {
    if (amount.currency !== charge.amount.currency) {
      throw new PaymentError("INVALID_REQUEST", "currency mismatch");
    }
  }

  return {
    providerName,
    capability,

    async createCharge(input: CreateChargeInput): Promise<MerchantCharge> {
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return { ...mustGet(existing).charge };
      assertServes(input.country, input.amount.currency, input.method);
      if (input.amount.amount <= 0) throw new PaymentError("INVALID_REQUEST", "amount must be positive");
      // A direct charge captures immediately.
      return newCharge(input, "captured");
    },

    async getCharge(chargeId: string): Promise<MerchantCharge | null> {
      const s = charges.get(chargeId);
      return s ? { ...s.charge } : null;
    },

    async authorize(input: AuthorizeInput): Promise<MerchantCharge> {
      if (!capability.supportsAuthCapture) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not support auth/capture`);
      }
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return { ...mustGet(existing).charge };
      assertServes(input.country, input.amount.currency, input.method);
      if (input.amount.amount <= 0) throw new PaymentError("INVALID_REQUEST", "amount must be positive");
      return newCharge(input, "authorized");
    },

    async capture(chargeId: string, amount?: Money): Promise<MerchantCharge> {
      if (!capability.supportsAuthCapture) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not support auth/capture`);
      }
      const s = mustGet(chargeId);
      if (s.charge.state !== "authorized") {
        throw new PaymentError("ILLEGAL_TRANSITION", `cannot capture charge in state ${s.charge.state}`);
      }
      const captureAmount = amount ?? s.charge.amount;
      assertCurrencyMatch(s.charge, captureAmount);
      if (captureAmount.amount <= 0) throw new PaymentError("INVALID_REQUEST", "capture amount must be positive");
      if (captureAmount.amount > s.charge.amount.amount) {
        throw new PaymentError("INVALID_REQUEST", "capture exceeds authorized amount");
      }
      s.charge.captured = { ...captureAmount };
      s.charge.state = "captured";
      return { ...s.charge };
    },

    async refund(chargeId: string): Promise<MerchantCharge> {
      const s = mustGet(chargeId);
      if (s.charge.state !== "captured") {
        throw new PaymentError("ILLEGAL_TRANSITION", `cannot refund charge in state ${s.charge.state}`);
      }
      s.charge.refunded = { ...s.charge.captured };
      s.charge.state = "refunded";
      return { ...s.charge };
    },

    async partialRefund(chargeId: string, amount: Money): Promise<MerchantCharge> {
      if (!capability.supportsPartialRefund) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not support partial refunds`);
      }
      const s = mustGet(chargeId);
      assertCurrencyMatch(s.charge, amount);
      if (amount.amount <= 0) throw new PaymentError("INVALID_REQUEST", "refund amount must be positive");
      const refundable = s.charge.state === "captured" || s.charge.state === "partially_refunded";
      if (!refundable) {
        throw new PaymentError("ILLEGAL_TRANSITION", `cannot refund charge in state ${s.charge.state}`);
      }
      const newRefunded = s.charge.refunded.amount + amount.amount;
      if (newRefunded > s.charge.captured.amount) {
        throw new PaymentError("INVALID_REQUEST", "refund exceeds captured amount");
      }
      s.charge.refunded = { amount: newRefunded, currency: s.charge.amount.currency };
      s.charge.state = newRefunded === s.charge.captured.amount ? "refunded" : "partially_refunded";
      return { ...s.charge };
    },

    async saveMethod(input: SaveMethodInput): Promise<SavedMethodRef> {
      if (!capability.supportsSavedMethods) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not support saved methods`);
      }
      if (!capability.methods.includes(input.method)) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not present method ${input.method}`);
      }
      savedCounter += 1;
      const ref: SavedMethodRef = {
        savedMethodId: `${providerName}_pm_${savedCounter}`,
        provider: providerName,
        method: input.method,
      };
      savedMethods.set(ref.savedMethodId, ref);
      return { ...ref };
    },

    async chargeSavedMethod(savedMethodId: string, input: CreateChargeInput): Promise<MerchantCharge> {
      if (!capability.supportsSavedMethods) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not support saved methods`);
      }
      const saved = savedMethods.get(savedMethodId);
      if (!saved) throw new PaymentError("INVALID_REQUEST", `unknown saved method ${savedMethodId}`);
      const existing = byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return { ...mustGet(existing).charge };
      assertServes(input.country, input.amount.currency, saved.method);
      if (input.amount.amount <= 0) throw new PaymentError("INVALID_REQUEST", "amount must be positive");
      // Charge the STORED method, not the requested one (merchant-initiated).
      return newCharge({ ...input, method: saved.method }, "captured");
    },

    listSupportedMethods(country: CountryCode, currency: string): PaymentMethod[] {
      if (!capability.countries.includes(country)) return [];
      if (!capability.currencies.includes(currency)) return [];
      return [...capability.methods];
    },

    async onboardMarketplaceAccount(input: MarketplaceAccountInput): Promise<MarketplaceAccountRef> {
      if (!capability.supportsMarketplace) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not support marketplace/connect`);
      }
      if (!capability.countries.includes(input.country)) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `${providerName} does not serve country ${input.country}`);
      }
      acctCounter += 1;
      const ref: MarketplaceAccountRef = {
        accountId: `${providerName}_acct_${acctCounter}`,
        provider: providerName,
        onboardingComplete: true,
      };
      marketplaceAccounts.push(ref);
      return { ...ref };
    },

    listCharges(): MerchantCharge[] {
      return [...charges.values()].map((s) => ({ ...s.charge }));
    },
    listSavedMethods(): SavedMethodRef[] {
      return [...savedMethods.values()].map((r) => ({ ...r }));
    },
    listMarketplaceAccounts(): MarketplaceAccountRef[] {
      return marketplaceAccounts.map((r) => ({ ...r }));
    },
  };
}

function resolveCapability(provider: string, opts?: MockOptions): ProviderCapability {
  if (opts?.capability) return opts.capability;
  const cap = capabilityFor(provider);
  if (!cap) throw new Error(`no capability record for ${provider}`);
  return cap;
}

/**
 * Provider A — card + wallet, auth/capture + saved methods, US/EU, USD/EUR.
 * Rejects partial refunds and marketplace onboarding (unsupported).
 */
export function createMockMerchantProviderA(opts?: MockOptions): MockMerchantProvider {
  return makeProvider("mock-merchant-a", resolveCapability("mock-merchant-a", opts));
}

/**
 * Provider B — card + bank_transfer + local_scheme, partial refunds + saved
 * methods + marketplace, MX/BR, MXN/BRL. Rejects auth/capture and wallet
 * (unsupported).
 */
export function createMockMerchantProviderB(opts?: MockOptions): MockMerchantProvider {
  return makeProvider("mock-merchant-b", resolveCapability("mock-merchant-b", opts));
}
