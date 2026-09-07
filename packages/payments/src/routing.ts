import { CurrencyCode } from "@lumin/contracts";
import {
  CountryCode,
  PaymentMethod,
  ProviderCapability,
  providerCapabilities,
  servesCountry,
  servesCurrency,
  servesMethod,
} from "./capability";

/**
 * ProviderRoutingContract v1
 *
 * A PURE, deterministic function that chooses the best merchant payment
 * provider for a transaction from the capability registry. It is
 * capability-DRIVEN: no provider is ever assumed globally sufficient, and the
 * function returns an explicit NO_PROVIDER result (with a reason) when nothing
 * matches — callers must handle "we cannot collect this" as a first-class
 * outcome, not an exception.
 */

export interface RoutingRequest {
  /** Where the customer is paying from (ISO2). Hard requirement. */
  country: CountryCode;
  /** Currency the charge settles in (ISO3). Hard requirement. */
  currency: CurrencyCode;
  /** Preferred provider id; honored only if it also satisfies the hard reqs. */
  tenantPreference?: string;
  /** Preferred method; a provider that presents it is favored, else relaxed. */
  methodPreference?: PaymentMethod;
  /**
   * Geography the transaction is attributed to when it differs from `country`
   * (e.g. a cross-border settlement). When set, the provider MUST also serve
   * this geography. Purely additive: omit for a domestic transaction.
   */
  transactionGeography?: CountryCode;
}

export interface RoutingMatch {
  outcome: "matched";
  provider: string;
  capability: ProviderCapability;
  /** Whether the chosen provider actually presents the preferred method. */
  methodSatisfied: boolean;
  /** Why this provider won, for observability. */
  reason: string;
}

export type NoProviderReason =
  | "NO_COUNTRY"
  | "NO_CURRENCY"
  | "NO_GEOGRAPHY"
  | "NO_METHOD"
  | "PREFERENCE_UNSATISFIABLE";

export interface RoutingNoProvider {
  outcome: "no_provider";
  reason: NoProviderReason;
  detail: string;
}

export type RoutingResult = RoutingMatch | RoutingNoProvider;

/**
 * Select the best-matching provider, or NO_PROVIDER with a reason.
 *
 * Hard requirements (a candidate must satisfy ALL): country, currency, and
 * transactionGeography when supplied. Among candidates, methodPreference is a
 * soft rank: a provider presenting the preferred method outranks one that does
 * not, but the preferred method alone is never a hard filter unless there is a
 * method-satisfying candidate available.
 *
 * Deterministic tie-break, in order:
 *   1. tenantPreference (if that provider is itself a valid candidate),
 *   2. presents methodPreference (when a preference is given),
 *   3. fewer countries served  (more specialized / local provider first),
 *   4. fewer currencies served (more specialized first),
 *   5. provider id, lexicographic (final stable tie-break).
 *
 * Pure: no I/O, no clock, no mutation of inputs.
 */
export function selectProvider(
  request: RoutingRequest,
  capabilities: ProviderCapability[] = providerCapabilities,
): RoutingResult {
  const { country, currency, tenantPreference, methodPreference, transactionGeography } = request;

  // Hard filter, tracking WHY candidates dropped so NO_PROVIDER can explain.
  let anyCountry = false;
  let anyCountryCurrency = false;
  let anyGeography = false;

  const candidates = capabilities.filter((cap) => {
    if (!servesCountry(cap, country)) return false;
    anyCountry = true;
    if (!servesCurrency(cap, currency)) return false;
    anyCountryCurrency = true;
    if (transactionGeography && !servesCountry(cap, transactionGeography)) return false;
    anyGeography = true;
    return true;
  });

  if (candidates.length === 0) {
    if (!anyCountry) {
      return {
        outcome: "no_provider",
        reason: "NO_COUNTRY",
        detail: `no provider settles in country ${country}`,
      };
    }
    if (!anyCountryCurrency) {
      return {
        outcome: "no_provider",
        reason: "NO_CURRENCY",
        detail: `no provider settles ${currency} in country ${country}`,
      };
    }
    if (transactionGeography && !anyGeography) {
      return {
        outcome: "no_provider",
        reason: "NO_GEOGRAPHY",
        detail: `no provider serves both ${country} and transaction geography ${transactionGeography}`,
      };
    }
    // Defensive: should be unreachable given the flags above.
    return { outcome: "no_provider", reason: "NO_CURRENCY", detail: "no capability match" };
  }

  // tenantPreference is honored ONLY if that provider is a valid candidate.
  if (tenantPreference) {
    const preferred = candidates.find((c) => c.provider === tenantPreference);
    if (preferred) {
      const methodSatisfied = methodPreference ? servesMethod(preferred, methodPreference) : true;
      return {
        outcome: "matched",
        provider: preferred.provider,
        capability: preferred,
        methodSatisfied,
        reason: `tenantPreference ${tenantPreference} satisfies country+currency`,
      };
    }
    // Preference named a provider that cannot serve this transaction. Fall
    // through to capability routing rather than failing — but note it.
  }

  const methodSatisfiers = methodPreference
    ? candidates.filter((c) => servesMethod(c, methodPreference))
    : candidates;

  // If a method preference was given and NO candidate presents it, that is a
  // hard miss worth surfacing explicitly (the transaction cannot be collected
  // via the requested method), rather than silently downgrading.
  if (methodPreference && methodSatisfiers.length === 0) {
    return {
      outcome: "no_provider",
      reason: "NO_METHOD",
      detail: `no provider for ${country}/${currency} presents method ${methodPreference}`,
    };
  }

  const ranked = [...methodSatisfiers].sort((a, b) => rank(a, b, methodPreference));
  const winner = ranked[0]!;
  const methodSatisfied = methodPreference ? servesMethod(winner, methodPreference) : true;

  const reasonBits = [`serves ${country}/${currency}`];
  if (methodPreference) reasonBits.push(`presents ${methodPreference}`);
  if (tenantPreference && tenantPreference !== winner.provider) {
    reasonBits.push(`tenantPreference ${tenantPreference} could not serve this transaction`);
  }

  return {
    outcome: "matched",
    provider: winner.provider,
    capability: winner,
    methodSatisfied,
    reason: reasonBits.join("; "),
  };
}

/** Deterministic capability ranking (lower = better). */
function rank(a: ProviderCapability, b: ProviderCapability, method?: PaymentMethod): number {
  if (method) {
    const am = servesMethod(a, method) ? 0 : 1;
    const bm = servesMethod(b, method) ? 0 : 1;
    if (am !== bm) return am - bm;
  }
  if (a.countries.length !== b.countries.length) return a.countries.length - b.countries.length;
  if (a.currencies.length !== b.currencies.length) return a.currencies.length - b.currencies.length;
  return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0;
}
