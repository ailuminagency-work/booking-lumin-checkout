import {createMockPaymentConnectionProvider, createStripeConnectProvider} from '@lumin/adapters';
import type {PaymentConnectionProvider} from '@lumin/contracts';

/**
 * Which payment connection provider the owner write path talks to (P1 step 6).
 *
 * THIS IS READ ONLY WHEN BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE=1. With that flag
 * off the write path is not wired, this function is never called, and none of the
 * variables below is read. The boot refusals described here therefore apply with
 * the write flag on, and nowhere else.
 *
 * UNSET MEANS WHAT IT MEANT BEFORE. An unset or `mock` value selects the mock
 * adapter, so a deployment that does not name a provider behaves exactly as it
 * did at step 5. With the write flag on, `stripe_connect` is a deliberate choice,
 * and a deliberate choice this process cannot honour stops it at boot: a
 * misconfigured deploy must not quietly run on the mock, and must not quietly
 * refuse every connection either.
 *
 * THESE BOOT CHECKS ARE SHAPE CHECKS. Nothing here contacts Stripe. A well-formed
 * key that Stripe rejects (rotated, mistyped, from another platform) boots cleanly,
 * and its first use answers 503 PROVIDER_UNAVAILABLE on begin and resolve.
 *
 * TEST MODE, DECIDED BY THE KEY. The platform secret must be a test-mode key. A
 * live key is refused by name, without echoing it, including one with surrounding
 * whitespace. Live credentials are an approval boundary, and this code must not
 * turn that boundary into a matter of configuration. Mode follows from the key
 * itself rather than from an environment name, which is the principle the
 * capability flags follow too.
 *
 * A TEST CONNECTION IS RECORDED UNDER ITS OWN LABEL. A test-mode connection is
 * written as `stripe_connect_test`, not `stripe_connect`, so a stored row says which
 * mode produced it. Migration 0094 declares that label confirmable on a disposable
 * database only; a hosted database refuses it until a person bootstraps it.
 *
 * THE PLATFORM IS PINNED. `STRIPE_PLATFORM_ACCOUNT_ID` is the platform's own account
 * id, read once from GET /v1/account. Stripe answers 403 for EVERY account when the
 * key belongs to another platform, and only the pin tells that apart from a merchant
 * who has actually left (see the adapter's confirmPlatform).
 *
 * THE HOST IS NOT CONFIGURABLE FROM THE ENVIRONMENT. A variable that could redirect
 * the secret key would turn a configuration mistake into credential disclosure, so
 * `apiBase` and `fetchImpl` are accepted only from code, for tests.
 *
 * NO SECRET IS EVER ECHOED. Every refusal names the variable and never its value.
 */
export const PAYMENT_CONNECTION_PROVIDER_ENV = 'BOOKING_LUMIN_PAYMENT_CONNECTION_PROVIDER';
export const STRIPE_PLATFORM_KEY_ENV = 'STRIPE_PLATFORM_SECRET_KEY';
export const STRIPE_PLATFORM_ACCOUNT_ENV = 'STRIPE_PLATFORM_ACCOUNT_ID';

/**
 * The label a TEST-MODE connection is recorded under. This build accepts test keys
 * only, so it is the only Stripe label this build writes. A live label is a later,
 * separately gated step.
 */
export const STRIPE_TEST_PROVIDER_LABEL = 'stripe_connect_test';

export class PaymentConnectionProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConnectionProviderConfigError';
  }
}

/** A Stripe test-mode SECRET key. Restricted (rk_) and publishable (pk_) keys are not one. */
const TEST_SECRET_KEY = /^sk_test_[A-Za-z0-9]{8,200}$/;
/** A Stripe account id, the shape the adapter itself accepts. */
const PLATFORM_ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,64}$/;

export interface PaymentConnectionProviderTestHooks {
  /** Tests only: the transport. Never read from the environment. */
  fetchImpl?: typeof fetch;
  /** Tests only: the API host. Never read from the environment. */
  apiBase?: string;
}

export function selectPaymentConnectionProvider(
  env: Record<string, string | undefined>,
  hooks: PaymentConnectionProviderTestHooks = {},
): PaymentConnectionProvider {
  const choice = env[PAYMENT_CONNECTION_PROVIDER_ENV];
  if (choice === undefined || choice === '' || choice === 'mock') {
    return createMockPaymentConnectionProvider();
  }
  if (choice !== 'stripe_connect') {
    throw new PaymentConnectionProviderConfigError(
      `${PAYMENT_CONNECTION_PROVIDER_ENV} must be 'mock' or 'stripe_connect'`,
    );
  }
  const key = env[STRIPE_PLATFORM_KEY_ENV];
  if (key === undefined || key === '') {
    throw new PaymentConnectionProviderConfigError(
      `${STRIPE_PLATFORM_KEY_ENV} is required when ${PAYMENT_CONNECTION_PROVIDER_ENV} is 'stripe_connect'`,
    );
  }
  // Checked before the general shape, so a live key is told that it is live, even
  // when it was pasted with a stray space or newline. Neither message contains the value.
  if (key.trim().startsWith('sk_live_')) {
    throw new PaymentConnectionProviderConfigError(
      `${STRIPE_PLATFORM_KEY_ENV} is a live-mode key; this build accepts test-mode keys only`,
    );
  }
  if (!TEST_SECRET_KEY.test(key)) {
    throw new PaymentConnectionProviderConfigError(
      `${STRIPE_PLATFORM_KEY_ENV} must be a Stripe test-mode secret key (sk_test_...), with no surrounding whitespace`,
    );
  }
  const platformAccountId = env[STRIPE_PLATFORM_ACCOUNT_ENV];
  if (platformAccountId === undefined || platformAccountId === '') {
    throw new PaymentConnectionProviderConfigError(
      `${STRIPE_PLATFORM_ACCOUNT_ENV} is required when ${PAYMENT_CONNECTION_PROVIDER_ENV} is 'stripe_connect'`,
    );
  }
  if (!PLATFORM_ACCOUNT_ID.test(platformAccountId)) {
    throw new PaymentConnectionProviderConfigError(
      `${STRIPE_PLATFORM_ACCOUNT_ENV} must be the platform's own Stripe account id (acct_...), with no surrounding whitespace`,
    );
  }
  return createStripeConnectProvider({
    secretKey: key,
    platformAccountId,
    providerLabel: STRIPE_TEST_PROVIDER_LABEL,
    apiBase: hooks.apiBase,
    fetchImpl: hooks.fetchImpl,
  });
}
