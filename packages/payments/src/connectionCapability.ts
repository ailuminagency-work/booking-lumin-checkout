import { z } from "zod";

/**
 * PaymentConnectionCapability v1
 *
 * What is true about HOW a payment provider is connected to a tenant --
 * separate data from `providerCapabilities` in ./capability.ts, which describes
 * what a provider can CHARGE (countries, currencies, methods).
 *
 * This is its OWN registry on purpose. `providerCapabilities` is read by
 * selectProvider() to choose a provider for a transaction; nothing in this file
 * touches that registry, that schema, or that routing path. Connection shape
 * and charge capability answer different questions, and merging them would make
 * every routing decision depend on onboarding facts.
 *
 * The constraint this file exists to make MACHINE-CHECKED:
 *
 *   `perTenantSecretRequired` is typed `false`. Not "defaults to false" --
 *   literally the only value the schema accepts. A provider integration whose
 *   design needs a tenant to hand us a secret key cannot be expressed as a
 *   capability record at all, so "do not store tenant payment credentials"
 *   stops being a policy someone has to remember and becomes a type error.
 *
 * See docs/P1_PAYMENT_CONNECTION_DECISION.md.
 */

/**
 * How money reaches the tenant.
 *  - direct_charges: the charge is created ON the tenant's connected account,
 *      using the PLATFORM secret plus an account reference header. The tenant
 *      supplies no credential, and funds never pool in a platform balance.
 *  - simulated: no money exists. Recordable only where migration 0088 seeds the
 *      simulated labels, which is disposable databases and a deliberately
 *      bootstrapped staging -- never a production database, which is named
 *      `postgres` and so never matches 0088's `^lumin_` guard.
 */
export const PaymentConnectionModel = z.enum(["direct_charges", "simulated"]);
export type PaymentConnectionModel = z.infer<typeof PaymentConnectionModel>;

export const PaymentConnectionCapability = z
  .object({
    /**
     * Provider label. MUST match both the adapter's `providerName` and the
     * provider column of public.confirmable_payment_providers (migration 0088),
     * which is reused as the connect-time gate rather than inventing a second
     * allowlist.
     */
    provider: z.string().min(1),
    model: PaymentConnectionModel,
    /**
     * Whether a TENANT must supply a provider secret. Only `false` is
     * representable; see the file header. Present as a field rather than
     * omitted so the registry states it explicitly and a reader does not have
     * to infer it from the absence of a credential column.
     */
    perTenantSecretRequired: z.literal(false),
    /**
     * Whether establishing the connection requires a PERSON to complete a
     * handoff at the provider. Every real connection does; the value exists so
     * a future provider that claims otherwise has to say so in reviewable data.
     */
    requiresOwnerHandoff: z.boolean(),
    /** Whether the provider can be re-read for a fresh snapshot (health). */
    supportsAccountInspection: z.boolean(),
    /**
     * Whether this provider represents simulated money. Mirrors migration
     * 0088's disposable-only seed set and SIMULATED_PROVIDERS in
     * apps/api/src/simulated-payment-readiness.ts.
     */
    simulatedMoney: z.boolean(),
  })
  .strict();
export type PaymentConnectionCapability = z.infer<typeof PaymentConnectionCapability>;

/**
 * The registry -- plain data, two entries, no provider assumed.
 *
 * Deliberately NOT recorded here: dispute and chargeback liability. With direct
 * charges on a Standard account, disputes land on the connected account; that is
 * an open business question for the owner (decision record, open question 1) and
 * encoding an answer as data now would pre-empt it.
 */
export const paymentConnectionCapabilities: PaymentConnectionCapability[] = [
  {
    provider: "stripe_connect",
    model: "direct_charges",
    perTenantSecretRequired: false,
    requiresOwnerHandoff: true,
    supportsAccountInspection: true,
    simulatedMoney: false,
  },
  {
    provider: "staging_mock",
    model: "simulated",
    perTenantSecretRequired: false,
    requiresOwnerHandoff: true,
    supportsAccountInspection: true,
    simulatedMoney: true,
  },
];

/** Look up a connection capability by provider label. */
export function connectionCapabilityFor(
  provider: string,
  capabilities: PaymentConnectionCapability[] = paymentConnectionCapabilities,
): PaymentConnectionCapability | undefined {
  return capabilities.find((c) => c.provider === provider);
}

/**
 * Is this provider simulated money? Default-closed on an UNKNOWN provider: an
 * unregistered label is not known to be real, and the caller that asks this
 * question is deciding whether a non-staging deployment may proceed. Answering
 * "not simulated" for something we have never heard of is the dangerous
 * direction, so an unknown provider answers `true`.
 */
export function isSimulatedConnectionProvider(
  provider: string,
  capabilities: PaymentConnectionCapability[] = paymentConnectionCapabilities,
): boolean {
  return connectionCapabilityFor(provider, capabilities)?.simulatedMoney ?? true;
}
