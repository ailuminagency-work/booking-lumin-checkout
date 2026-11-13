import {describe, it, expect, vi} from 'vitest';
import {
  PAYMENT_CONNECTION_PROVIDER_ENV,
  PaymentConnectionProviderConfigError,
  STRIPE_PLATFORM_ACCOUNT_ENV,
  STRIPE_PLATFORM_KEY_ENV,
  STRIPE_TEST_PROVIDER_LABEL,
  selectPaymentConnectionProvider,
} from './payment-connection-provider';

// Built at runtime, so the repository never holds a literal a secret scanner
// would read as a live or real-looking Stripe credential.
const LIVE_KEY = ['sk', 'live', 'fixtureNotARealKey0000'].join('_');
const TEST_KEY = ['sk', 'test', 'fixtureNotARealKey0000'].join('_');
const RESTRICTED_KEY = ['rk', 'test', 'fixtureNotARealKey0000'].join('_');
const PUBLISHABLE_KEY = ['pk', 'test', 'fixtureNotARealKey0000'].join('_');
const PLATFORM = 'acct_platform000001';

describe('the provider is named explicitly, and unset means step 5', () => {
  it('uses the mock when nothing is named', () => {
    expect(selectPaymentConnectionProvider({}).providerName).toBe('staging_mock');
  });

  it('uses the mock when the mock is named, or the value is blank', () => {
    for (const value of ['mock', '']) {
      expect(selectPaymentConnectionProvider({[PAYMENT_CONNECTION_PROVIDER_ENV]: value}).providerName, value)
        .toBe('staging_mock');
    }
  });

  it('refuses a misspelled provider rather than guessing one', () => {
    expect(() => selectPaymentConnectionProvider({
      [PAYMENT_CONNECTION_PROVIDER_ENV]: 'stripe-connect',
      [STRIPE_PLATFORM_KEY_ENV]: TEST_KEY,
      [STRIPE_PLATFORM_ACCOUNT_ENV]: PLATFORM,
    })).toThrow(PaymentConnectionProviderConfigError);
  });
});

describe('stripe_connect needs a test-mode key and a pinned platform, and says so without echoing either', () => {
  // `null` means "not set". An `undefined` argument would take the default and
  // silently pin the platform, which is how this helper first hid a missing value.
  const stripe = (key: string | undefined, platform: string | null = PLATFORM) => ({
    [PAYMENT_CONNECTION_PROVIDER_ENV]: 'stripe_connect',
    ...(key === undefined ? {} : {[STRIPE_PLATFORM_KEY_ENV]: key}),
    ...(platform === null ? {} : {[STRIPE_PLATFORM_ACCOUNT_ENV]: platform}),
  });

  it('refuses to start without a key', () => {
    expect(() => selectPaymentConnectionProvider(stripe(undefined)))
      .toThrow(/STRIPE_PLATFORM_SECRET_KEY is required/);
  });

  it('refuses a live key, and says it is live, even when it was pasted with stray whitespace', () => {
    for (const key of [LIVE_KEY, ` ${LIVE_KEY}`, `${LIVE_KEY}\n`]) {
      expect(() => selectPaymentConnectionProvider(stripe(key)), JSON.stringify(key))
        .toThrow(/live-mode key/);
    }
  });

  it('refuses restricted, publishable, malformed and whitespace-padded keys', () => {
    for (const key of [RESTRICTED_KEY, PUBLISHABLE_KEY, `${TEST_KEY} `, ` ${TEST_KEY}`, 'sk_test_short']) {
      expect(() => selectPaymentConnectionProvider(stripe(key)), JSON.stringify(key))
        .toThrow(/test-mode secret key/);
    }
  });

  it('never echoes the value it refused', () => {
    for (const key of [LIVE_KEY, ` ${LIVE_KEY}`, `${LIVE_KEY}\n`, RESTRICTED_KEY, PUBLISHABLE_KEY, `${TEST_KEY} `, 'sk_test_short']) {
      let message = '';
      try {
        selectPaymentConnectionProvider(stripe(key));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message.length, JSON.stringify(key)).toBeGreaterThan(0);
      expect(message, JSON.stringify(key)).not.toContain(key.trim());
    }
  });

  it('requires the platform account id, and refuses one that is not an account id without echoing it', () => {
    expect(() => selectPaymentConnectionProvider(stripe(TEST_KEY, null)))
      .toThrow(/STRIPE_PLATFORM_ACCOUNT_ID is required/);
    expect(() => selectPaymentConnectionProvider(stripe(TEST_KEY, '')))
      .toThrow(/STRIPE_PLATFORM_ACCOUNT_ID is required/);
    for (const bad of ['acct_short', 'pk_test_notaplatform', ` ${PLATFORM}`, 'mch_platform000001']) {
      let message = '';
      try {
        selectPaymentConnectionProvider(stripe(TEST_KEY, bad));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, JSON.stringify(bad)).toMatch(/must be the platform's own Stripe account id/);
      expect(message, JSON.stringify(bad)).not.toContain(bad.trim());
    }
  });

  it('accepts a test-mode key and a pinned platform, and records under the test label', () => {
    expect(STRIPE_TEST_PROVIDER_LABEL).toBe('stripe_connect_test');
    expect(selectPaymentConnectionProvider(stripe(TEST_KEY)).providerName).toBe(STRIPE_TEST_PROVIDER_LABEL);
  });
});

describe('the pinned platform is the one a disown is judged against', () => {
  // The env value must reach the adapter, not merely pass the shape check. Stripe
  // answers 403 account_invalid for any account it is asked about with a foreign key.
  const disowningWith = (platformAnswer: string) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/account')) {
        return new Response(JSON.stringify({object: 'account', id: platformAnswer}), {status: 200});
      }
      return new Response(
        JSON.stringify({error: {type: 'invalid_request_error', code: 'account_invalid'}}),
        {status: 403},
      );
    }) as unknown as typeof fetch;
    return selectPaymentConnectionProvider(
      {
        [PAYMENT_CONNECTION_PROVIDER_ENV]: 'stripe_connect',
        [STRIPE_PLATFORM_KEY_ENV]: TEST_KEY,
        [STRIPE_PLATFORM_ACCOUNT_ENV]: PLATFORM,
      },
      {fetchImpl},
    );
  };

  it('a disown is a verdict when the key is the pinned platform', async () => {
    await expect(disowningWith(PLATFORM).resolveConnection('acct_merchant00001'))
      .resolves.toMatchObject({blockedReason: 'credentials_invalid'});
  });

  it('a disown from a different platform is an outage, and nothing is recorded', async () => {
    await expect(disowningWith('acct_someoneelse01').resolveConnection('acct_merchant00001'))
      .rejects.toMatchObject({code: 'PROVIDER_UNAVAILABLE'});
  });
});

describe('the environment cannot redirect the secret key', () => {
  it('sends every request to Stripe, whatever API base the environment names', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response('{"error":{"type":"api_error"}}', {status: 500});
    }) as unknown as typeof fetch;
    const provider = selectPaymentConnectionProvider(
      {
        [PAYMENT_CONNECTION_PROVIDER_ENV]: 'stripe_connect',
        [STRIPE_PLATFORM_KEY_ENV]: TEST_KEY,
        [STRIPE_PLATFORM_ACCOUNT_ENV]: PLATFORM,
        STRIPE_API_BASE: 'https://attacker.example',
        STRIPE_API_BASE_URL: 'https://attacker.example',
      },
      {fetchImpl},
    );
    await expect(provider.beginConnection({
      tenantId: '8c000000-0000-4000-8000-000000000010',
      returnUrl: 'https://portal.example.test/r',
      refreshUrl: 'https://portal.example.test/f',
      idempotencyKey: 'env-redirect-probe-0001',
    })).rejects.toMatchObject({code: 'PROVIDER_UNAVAILABLE'});
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('https://api.stripe.com/'), url).toBe(true);
    }
  });
});
