import {
  BeginConnectionInput,
  ConnectionHandoff,
  PaymentConnectionProvider,
  PaymentConnectionReason,
  PaymentConnectionSnapshot,
  PaymentError,
  assertHeaderSafeAccountId,
} from "@lumin/contracts";

/**
 * StripeConnectProvider -- REAL Stripe Connect (TEST MODE) behind
 * PaymentConnectionProvider (packages/contracts/src/paymentConnection.ts).
 *
 * ┌─ WHY THERE IS NO PER-TENANT SECRET ───────────────────────────────────────┐
 * │ Standard accounts, onboarded through Account Links, charged with DIRECT    │
 * │ CHARGES: the PLATFORM secret key plus a `Stripe-Account: acct_...` header. │
 * │ An account id is an IDENTIFIER, not a bearer credential -- nothing can be  │
 * │ done with it without the platform secret. So no tenant is ever asked to    │
 * │ paste a secret key, nothing per-tenant is stored, and the credential-      │
 * │ encryption subsystem this repository deliberately lacks is never needed.   │
 * │ `secretKey` is SERVER-ONLY (SI-5): this adapter is constructed only inside  │
 * │ the trusted runtime and must never be bundled to a browser.                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * NOTHING HERE CHANGES AN EXISTING CONNECTION. The two outbound writes create an
 * ACCOUNT and an onboarding LINK. A link is inert until a person completes it,
 * neither can alter an account that already exists, and there is deliberately no
 * deauthorize, reject, capability-update or payout-pause call anywhere in this
 * file. Automation must never take a merchant's payments offline, so the ability
 * is absent rather than guarded.
 *
 * AN INCONCLUSIVE ANSWER IS NEVER TURNED INTO DATA. A 5xx, a 429, a transport
 * failure or a non-JSON body throws PROVIDER_UNAVAILABLE, and the caller then
 * never reaches the RPC, so the stored row keeps its status. Only Stripe
 * explicitly disowning the account -- 403 `account_invalid`, or 404 -- becomes a
 * snapshot, as `credentials_invalid`. This asymmetry is the whole reason a
 * transient Stripe blip cannot take a tenant's checkout down.
 *
 * No `stripe` npm SDK: the REST API is called directly with urlencoded bodies
 * through an injected `fetchImpl`, the same choice stripePayment.ts made.
 */

export interface StripeConnectProviderOptions {
  /** PLATFORM Stripe secret key (sk_test_… in test mode). SERVER-ONLY (SI-5). */
  secretKey: string;
  /** API base; defaults to Stripe's host (test mode is key-scoped). */
  apiBase?: string;
  /** Injected fetch (default global fetch). Tests inject the fake Stripe. */
  fetchImpl?: typeof fetch;
  /**
   * Country for accounts this platform creates, ISO 3166-1 alpha-2. Stripe
   * requires it at creation and it cannot be changed afterwards.
   */
  country?: string;
}

/**
 * Stripe's own account references, narrower than the contract's header-safe
 * floor. An adapter may narrow and may never widen.
 */
const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,64}$/;

/** The subset of a Stripe Account this adapter depends on. */
interface StripeAccount {
  id?: unknown;
  charges_enabled?: unknown;
  payouts_enabled?: unknown;
  details_submitted?: unknown;
  requirements?: {
    disabled_reason?: unknown;
    currently_due?: unknown;
    past_due?: unknown;
  };
}

function boolOf(value: unknown): boolean {
  return value === true;
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Map a Stripe account onto the closed PaymentConnectionReason vocabulary.
 *
 * Deterministic and total. Stripe's own `disabled_reason` string is READ but
 * never forwarded: this value is shown to every staff member of the tenant, so
 * provider prose must not reach it.
 *
 * When charges are off a reason is ALWAYS produced, which is what the snapshot
 * schema and the stored row's check constraint both require.
 */
export function mapStripeAccountReason(account: StripeAccount): PaymentConnectionReason | null {
  const charges = boolOf(account.charges_enabled);
  const payouts = boolOf(account.payouts_enabled);
  const submitted = boolOf(account.details_submitted);
  const disabled = typeof account.requirements?.disabled_reason === "string" ? account.requirements.disabled_reason : "";
  const pastDue = listLength(account.requirements?.past_due) > 0;
  const currentlyDue = listLength(account.requirements?.currently_due) > 0;

  if (!charges) {
    // `rejected.fraud`, `rejected.terms_of_service`, `rejected.other`, …
    if (disabled.startsWith("rejected")) return "account_rejected";
    if (pastDue || disabled === "requirements.past_due") return "requirements_past_due";
    if (!submitted) return "onboarding_incomplete";
    return "charges_disabled";
  }
  // Charging, but not cleanly. Payouts first: that is the state where money
  // moves and then strands, which is the more urgent thing to tell someone.
  if (!payouts) return "payouts_disabled";
  if (pastDue) return "requirements_past_due";
  if (!submitted || currentlyDue) return "onboarding_incomplete";
  // A charging account that Stripe nonetheless marks disabled_reason is not
  // clean. Returning null here read a restricted-but-still-charging merchant as
  // having no caveat at all, which is the state the four-value health verdict
  // exists to surface.
  if (disabled) return "charges_disabled";
  return null;
}

export interface StripeConnectProvider extends PaymentConnectionProvider {
  /**
   * Mint a fresh onboarding link for an account that ALREADY exists, instead of
   * creating another one.
   *
   * Account Links are single-use and expire in minutes, so an owner who
   * abandons onboarding and comes back needs a new link, not a new merchant
   * account. Without this, every return visit would create an orphan Stripe
   * account. It is not on the contract because Account Links are a Stripe
   * concept; it has the same safety character as beginConnection -- inert until
   * a person completes it, and unable to alter or disable the account.
   *
   * CALLER OBLIGATION, because this adapter has no tenant context and so cannot
   * check it: the caller MUST have established that `accountId` is the account
   * already bound to the tenant whose owner is acting -- by reading it from that
   * tenant's own public.payment_connections row, never from a request. Called
   * with an arbitrary reference it would mint a real onboarding link for an
   * account this platform does not represent. No caller exists yet; step 5 is
   * where this obligation has to be met.
   */
  linkExistingAccount(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<ConnectionHandoff>;
}

export function createStripeConnectProvider(opts: StripeConnectProviderOptions): StripeConnectProvider {
  const apiBase = (opts.apiBase ?? "https://api.stripe.com").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const country = opts.country ?? "US";

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    // `extra` FIRST and the credential pinned LAST, so a caller-supplied header
    // map can never replace the bearer token. Same ordering as
    // stripePayment.ts; see packages/adapters/test/stripeAuthHeaderOrder.test.ts.
    return {
      ...extra,
      Authorization: `Bearer ${opts.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  }

  /** Narrow an account reference, with ZERO requests made. */
  function stripeAccountId(value: unknown): string {
    // The contract's header-safety floor first (it refuses CR, LF, spaces and
    // NUL), then Stripe's own narrower shape.
    const safe = assertHeaderSafeAccountId(value);
    if (!STRIPE_ACCOUNT_ID.test(safe)) {
      // The value is not echoed: it may be attacker-controlled and this message
      // reaches logs.
      throw new PaymentError("CONNECTION_UNVERIFIED", "not a Stripe account reference");
    }
    return safe;
  }

  /**
   * An idempotency key is sent as a header VALUE, so it is validated with the
   * same care as the account reference and before any request is made. It went
   * into `Idempotency-Key` unchecked: a key carrying CR or LF surfaced as a raw
   * TypeError from the fetch layer rather than a PaymentError, and the derived
   * `${key}:link` carried the same characters to a second endpoint.
   */
  function headerSafeKey(value: string): string {
    if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(value)) {
      throw new PaymentError("INVALID_REQUEST", "idempotencyKey must be 8-200 chars of [A-Za-z0-9_.:-]");
    }
    return value;
  }

  function absoluteUrl(value: string, field: string): string {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new PaymentError("INVALID_REQUEST", `${field} must be an absolute URL`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new PaymentError("INVALID_REQUEST", `${field} must be an http(s) URL`);
    }
    // Userinfo is never legitimate in a redirect target and is a classic way to
    // make a hostile host look like a trusted one in a browser's address bar.
    // Stripe hands these URLs straight to the owner's browser.
    if (parsed.username !== "" || parsed.password !== "") {
      throw new PaymentError("INVALID_REQUEST", `${field} must not carry userinfo`);
    }
    return parsed.toString();
  }

  /** Every request goes through here, so the failure taxonomy lives in one place. */
  async function call(
    path: string,
    init: { method: "GET" | "POST"; body?: string; idempotencyKey?: string },
  ): Promise<{ ok: true; body: any } | { ok: false; status: number; body: any }> {
    let res: Response;
    try {
      res = await doFetch(`${apiBase}${path}`, {
        method: init.method,
        headers: authHeaders(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : undefined),
        ...(init.method === "POST" ? { body: init.body ?? "" } : {}),
      });
    } catch {
      // A transport failure says nothing about the account.
      throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe could not be reached");
    }

    let body: any = {};
    let text: string;
    try {
      // Inside the transport guard: a body that terminates mid-transfer is a
      // transport failure, and escaped as a raw TypeError before this.
      text = await res.text();
    } catch {
      throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe response body could not be read");
    }
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe returned a non-JSON body");
      }
    }
    if (res.ok) return { ok: true, body };
    // 5xx and 429 are inconclusive by definition; anything else that is not one
    // of the two "Stripe disowns this account" answers is treated the same way,
    // because inventing data from an unexpected error is the failure mode this
    // adapter exists to avoid.
    return { ok: false, status: res.status, body };
  }

  function errorCode(body: any): string {
    const code = body?.error?.code;
    return typeof code === "string" ? code : "";
  }

  /**
   * Is this response Stripe saying "I do not recognise this account"? Only then
   * is a failure DATA rather than an outage.
   */
  /**
   * Is this response Stripe ITSELF saying "I do not recognise this account"?
   * Only then is a failure DATA rather than an outage.
   *
   * A BARE 404 is not enough, and treating it as enough was a real defect: a
   * misconfigured apiBase, a proxy, or any intermediary that answers 404 would
   * have been read as "Stripe disowned this account" and recorded as
   * credentials_invalid -- which the database derives to 'revoked'. Combined
   * with the owner-recovery bug fixed in migration 0093, that silently and
   * permanently took every merchant offline.
   *
   * So the answer must carry Stripe's own error shape. Stripe's 404 for an
   * unknown account has type "invalid_request_error" and code
   * "resource_missing" (or "account_invalid"); an intermediary's 404 has no
   * `error` object at all, and is therefore inconclusive.
   */
  function disownsAccount(status: number, body: any): boolean {
    const type = typeof body?.error?.type === "string" ? body.error.type : "";
    if (type !== "invalid_request_error") return false;
    const code = errorCode(body);
    if (status === 403) return code === "account_invalid";
    if (status === 404) return code === "resource_missing" || code === "account_invalid";
    return false;
  }

  function snapshot(accountId: string, account: StripeAccount, observedAt: string): PaymentConnectionSnapshot {
    const chargesEnabled = boolOf(account.charges_enabled);
    return PaymentConnectionSnapshot.parse({
      provider: "stripe_connect",
      accountId,
      chargesEnabled,
      payoutsEnabled: boolOf(account.payouts_enabled),
      onboardingComplete: boolOf(account.details_submitted),
      blockedReason: mapStripeAccountReason(account),
      observedAt,
    });
  }

  /** The snapshot for an account Stripe disowns. */
  function disownedSnapshot(accountId: string, observedAt: string): PaymentConnectionSnapshot {
    return PaymentConnectionSnapshot.parse({
      provider: "stripe_connect",
      accountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      onboardingComplete: false,
      blockedReason: "credentials_invalid",
      observedAt,
    });
  }

  async function accountLink(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
    idempotencyKey?: string,
  ): Promise<ConnectionHandoff> {
    const link = await call("/v1/account_links", {
      method: "POST",
      idempotencyKey,
      body: new URLSearchParams({
        account: accountId,
        refresh_url: absoluteUrl(urls.refreshUrl, "refreshUrl"),
        return_url: absoluteUrl(urls.returnUrl, "returnUrl"),
        type: "account_onboarding",
      }).toString(),
    });
    if (!link.ok) {
      throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe did not issue an onboarding link");
    }
    const url = typeof link.body?.url === "string" ? link.body.url : "";
    const expires = Number(link.body?.expires_at);
    // Bounded, not merely finite: an epoch-0 expiry would make the handoff
    // instantly stale and a huge one throws RangeError inside toISOString.
    // 1e6..1e11 covers every plausible unix-seconds value.
    if (!url || !Number.isFinite(expires) || expires < 1e6 || expires > 1e11) {
      throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe returned an unusable onboarding link");
    }
    if (!/^https:\/\//.test(url)) {
      throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe onboarding link is not https");
    }
    return ConnectionHandoff.parse({
      provider: "stripe_connect",
      // The handoff id IS the account reference. Stripe has no separate handoff
      // object, and using the account id keeps this adapter stateless: nothing
      // has to be remembered between beginConnection and resolveConnection. It
      // satisfies the ledger's own handoff_id shape and stays header-safe
      // because it DOES reach a browser: the begin receipt publishes it and
      // resolve takes it back (see ConnectionHandoffId). It is an identifier,
      // never a credential -- an account reference is useless without the
      // platform secret, and the owner is sent to `url`, which carries
      // Stripe's own token.
      handoffId: accountId,
      onboardingUrl: url,
      expiresAt: new Date(expires * 1000).toISOString(),
    });
  }

  async function read(accountId: string, observedAt: string): Promise<PaymentConnectionSnapshot> {
    const got = await call(`/v1/accounts/${encodeURIComponent(accountId)}`, { method: "GET" });
    if (got.ok) {
      // A 200 is not on its own evidence about this account. Every boolean below
      // is read with `=== true`, so an unexpected body would have produced
      // all-false facts and quietly moved a live connection to not_connected.
      // The body must say it is an account, and the account asked for.
      const body = got.body as StripeAccount & { object?: unknown };
      if (body?.object !== "account" || body?.id !== accountId) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", "stripe returned something other than the requested account");
      }
      return snapshot(accountId, body, observedAt);
    }
    if (disownsAccount(got.status, got.body)) return disownedSnapshot(accountId, observedAt);
    throw new PaymentError("PROVIDER_UNAVAILABLE", `stripe account read failed (${got.status})`);
  }

  return {
    providerName: "stripe_connect",

    async beginConnection(input: BeginConnectionInput): Promise<ConnectionHandoff> {
      const idempotencyKey = headerSafeKey(input.idempotencyKey ?? "");
      // Validated before any request: Stripe hands these to a browser.
      const returnUrl = absoluteUrl(input.returnUrl, "returnUrl");
      const refreshUrl = absoluteUrl(input.refreshUrl, "refreshUrl");

      const created = await call("/v1/accounts", {
        method: "POST",
        // Stripe-native idempotency: the same key returns the ORIGINAL account,
        // so a double-submit cannot create two merchant accounts.
        idempotencyKey,
        body: new URLSearchParams({
          type: "standard",
          country,
          "metadata[tenantId]": input.tenantId,
        }).toString(),
      });
      if (!created.ok) {
        throw new PaymentError("PROVIDER_UNAVAILABLE", `stripe account creation failed (${created.status})`);
      }
      const accountId = stripeAccountId(created.body?.id);

      // A DIFFERENT key, because Stripe scopes idempotency by key alone and
      // reusing one across two endpoints is an error, not a replay.
      return accountLink(accountId, { returnUrl, refreshUrl }, `${idempotencyKey}:link`);
    },

    async linkExistingAccount(
      accountId: string,
      urls: { returnUrl: string; refreshUrl: string },
    ): Promise<ConnectionHandoff> {
      // No idempotency key: a fresh link is the POINT of this call, and
      // replaying an expired one is what it exists to avoid.
      return accountLink(stripeAccountId(accountId), urls);
    },

    async resolveConnection(handoffId: string): Promise<PaymentConnectionSnapshot> {
      // The handoff id is the account reference; see accountLink. A malformed
      // one is unverifiable rather than retryable, and costs zero requests.
      return read(stripeAccountId(handoffId), new Date().toISOString());
    },

    async inspectConnection(accountId: string): Promise<PaymentConnectionSnapshot> {
      return read(stripeAccountId(accountId), new Date().toISOString());
    },
  };
}
