import {
  BeginConnectionInput,
  ConnectionHandoff,
  PaymentConnectionProvider,
  PaymentConnectionReason,
  PaymentConnectionSnapshot,
  PaymentError,
  assertHeaderSafeAccountId,
} from "@lumin/contracts";
import { randomHex } from "./webhookCrypto";

/**
 * MockPaymentConnectionProvider -- SI-12 for the CONNECTION path: the whole
 * onboarding and health flow with zero external credentials.
 *
 * Its provider label is `staging_mock` on purpose. Migration 0088 seeds that
 * label into public.confirmable_payment_providers only where
 * `current_database() ~ '^lumin_'`, and every hosted Supabase database --
 * staging and production alike -- is named `postgres`. Reusing 0088 as the
 * connect-time gate therefore makes a mock connection PHYSICALLY UNRECORDABLE
 * on a production database, rather than merely disallowed by a flag.
 *
 * DEV MOCK ONLY. It mirrors the SHAPE of a real connection provider -- an owner
 * handoff that grants nothing until a person completes it, an account reference
 * instead of a credential, an inconclusive answer that changes nothing -- but
 * verifies nothing. No network call is ever made.
 */

/** What this fake provider will say about an account. */
export interface MockAccountFacts {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingComplete: boolean;
  blockedReason: PaymentConnectionReason | null;
}

export interface MockPaymentConnectionProviderOptions {
  now?: () => string;
  /**
   * Origin the fake onboarding link is built on. Never visited; it exists so
   * the link is a real absolute URL, as ConnectionHandoff requires.
   */
  onboardingBaseUrl?: string;
  /** Link lifetime, mirroring a real Account Link's few minutes. */
  handoffTtlSeconds?: number;
}

export interface MockPaymentConnectionProvider extends PaymentConnectionProvider {
  /**
   * Test affordance: a PERSON finishing the provider's onboarding. There is no
   * production equivalent and deliberately so -- nothing in this system can
   * complete a handoff on an owner's behalf.
   */
  completeHandoff(handoffId: string, facts?: Partial<MockAccountFacts>): PaymentConnectionSnapshot;
  /**
   * Test affordance: the canned answer this fake provider gives about an
   * account from now on. This is the OUTSIDE WORLD changing, not this system
   * writing: it is how a merchant becoming restricted, or losing payouts, is
   * staged in a test.
   */
  providerWillReport(accountId: string, facts: Partial<MockAccountFacts>): PaymentConnectionSnapshot;
  /**
   * Arm ONE inconclusive answer: the next read throws PROVIDER_UNAVAILABLE and
   * the arm is consumed. Models a 5xx or a timeout, which must leave every
   * recorded status exactly as it was.
   */
  armUnavailable(): void;
  /** Inspection: handoffs begun, in order. */
  listHandoffs(): ConnectionHandoff[];
}

const UNFINISHED: MockAccountFacts = {
  chargesEnabled: false,
  payoutsEnabled: false,
  onboardingComplete: false,
  blockedReason: "onboarding_incomplete",
};

const FINISHED: MockAccountFacts = {
  chargesEnabled: true,
  payoutsEnabled: true,
  onboardingComplete: true,
  blockedReason: null,
};

/**
 * The provider saying "I do not recognise this account" -- data, not an outage.
 *
 * This mock's accounts live in process memory, so a restart or a second instance
 * answers this for accounts that were real a moment ago. That is deliberate and
 * faithful: it is exactly what Stripe answers for an account it does not know,
 * and softening it would make the mock less like the thing it stands in for.
 * What made it dangerous was that 'revoked' used to be terminal for the owner as
 * well as for automation; migration 0093 now lets an owner reconnect.
 */
const UNRECOGNISED: MockAccountFacts = {
  chargesEnabled: false,
  payoutsEnabled: false,
  onboardingComplete: false,
  blockedReason: "credentials_invalid",
};

interface HandoffState {
  handoff: ConnectionHandoff;
  tenantId: string;
  accountId: string;
  completed: boolean;
}

export function createMockPaymentConnectionProvider(
  opts: MockPaymentConnectionProviderOptions = {},
): MockPaymentConnectionProvider {
  const now = opts.now ?? (() => new Date().toISOString());
  const base = opts.onboardingBaseUrl ?? "https://connect.mock.invalid/onboarding";
  const ttlSeconds = opts.handoffTtlSeconds ?? 300;

  const handoffs = new Map<string, HandoffState>(); // handoffId → state
  // Keyed on TENANT and key, not the key alone. Keyed on the key alone, one
  // tenant presenting another tenant's idempotency key was handed that tenant's
  // handoff -- and so its minted account. The database ledger is correctly
  // scoped (unique (tenant_id, provider, idempotency_key)), so a bind would have
  // been refused there, but an adapter must not depend on something downstream
  // to keep tenants apart. NUL cannot occur in a uuid or in a key, so the
  // composite cannot be forged by a key that embeds a separator.
  const byIdempotencyKey = new Map<string, string>(); // tenant\0key → handoffId

  function idempotencyScope(tenantId: string, key: string): string {
    return `${tenantId}\u0000${key}`;
  }
  const accounts = new Map<string, MockAccountFacts>(); // accountId → canned answer
  let unavailableArmed = false;

  /** Consume an armed inconclusive answer. Called only after validation. */
  function failIfArmed(): void {
    if (!unavailableArmed) return;
    unavailableArmed = false;
    throw new PaymentError("PROVIDER_UNAVAILABLE", "mock connection provider unavailable (armed)");
  }

  function normalize(partial: Partial<MockAccountFacts>, from: MockAccountFacts): MockAccountFacts {
    const facts: MockAccountFacts = { ...from, ...partial };
    // The same invariant the snapshot schema and the stored row's check
    // constraint enforce. Fail loudly rather than inventing a reason: a test
    // that asks for "cannot charge, no reason" is asking for a state the
    // database cannot hold, and silently fixing it would hide that.
    if (!facts.chargesEnabled && facts.blockedReason === null) {
      throw new PaymentError("INVALID_REQUEST", "an account that cannot charge must carry a reason");
    }
    return facts;
  }

  function snapshot(accountId: string, facts: MockAccountFacts): PaymentConnectionSnapshot {
    return PaymentConnectionSnapshot.parse({
      provider: "staging_mock",
      accountId,
      chargesEnabled: facts.chargesEnabled,
      payoutsEnabled: facts.payoutsEnabled,
      onboardingComplete: facts.onboardingComplete,
      blockedReason: facts.blockedReason,
      observedAt: now(),
    });
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
    return parsed.toString();
  }

  return {
    providerName: "staging_mock",

    async beginConnection(input: BeginConnectionInput): Promise<ConnectionHandoff> {
      if (input.idempotencyKey.length < 1) {
        throw new PaymentError("INVALID_REQUEST", "idempotencyKey is required");
      }
      // Validated even though the mock never redirects: a real adapter hands
      // these to the provider, which hands them to a browser.
      absoluteUrl(input.returnUrl, "returnUrl");
      absoluteUrl(input.refreshUrl, "refreshUrl");

      // Idempotent: the same key NEVER begins a second handoff, and so never
      // mints a second account for one owner's single attempt.
      const scope = idempotencyScope(input.tenantId, input.idempotencyKey);
      const existing = byIdempotencyKey.get(scope);
      if (existing) return { ...handoffs.get(existing)!.handoff };

      const handoffId = `mch_${randomHex(12)}`;
      const accountId = assertHeaderSafeAccountId(`acct_mock_${randomHex(12)}`);
      const handoff = ConnectionHandoff.parse({
        provider: "staging_mock",
        handoffId,
        onboardingUrl: `${base}/${handoffId}`,
        expiresAt: new Date(Date.parse(now()) + ttlSeconds * 1000).toISOString(),
      });
      handoffs.set(handoffId, { handoff, tenantId: input.tenantId, accountId, completed: false });
      byIdempotencyKey.set(scope, handoffId);
      // The account exists at the provider but can do nothing: beginning a
      // handoff grants no payment capability whatsoever.
      accounts.set(accountId, { ...UNFINISHED });
      return { ...handoff };
    },

    async resolveConnection(handoffId: string): Promise<PaymentConnectionSnapshot> {
      const state = handoffs.get(handoffId);
      // A handoff this provider never issued is not something to retry or
      // record -- it is unverifiable, full stop.
      if (!state) throw new PaymentError("CONNECTION_UNVERIFIED", "unknown handoff");
      failIfArmed();
      // An UNFINISHED handoff resolves honestly rather than throwing: "the
      // owner has not finished" is an answer, and the recorded status stays
      // not_connected because of what the snapshot says, not because of an error.
      return snapshot(state.accountId, accounts.get(state.accountId) ?? { ...UNFINISHED });
    },

    async inspectConnection(accountId: string): Promise<PaymentConnectionSnapshot> {
      // FIRST, before anything that could reach a provider: a reference that
      // could splice a header is refused with zero requests made, and does NOT
      // consume an armed failure -- which is how a test proves the ordering.
      const safe = assertHeaderSafeAccountId(accountId);
      failIfArmed();
      const facts = accounts.get(safe);
      // Unknown account: the provider's own answer would be a 403
      // account_invalid, which is DATA. Recorded as credentials_invalid, not
      // raised as an outage, so a genuinely revoked account converges instead
      // of retrying forever.
      return snapshot(safe, facts ?? { ...UNRECOGNISED });
    },

    completeHandoff(handoffId: string, facts: Partial<MockAccountFacts> = {}): PaymentConnectionSnapshot {
      const state = handoffs.get(handoffId);
      if (!state) throw new PaymentError("CONNECTION_UNVERIFIED", "unknown handoff");
      const resolved = normalize(facts, FINISHED);
      state.completed = true;
      accounts.set(state.accountId, resolved);
      return snapshot(state.accountId, resolved);
    },

    providerWillReport(accountId: string, facts: Partial<MockAccountFacts>): PaymentConnectionSnapshot {
      const safe = assertHeaderSafeAccountId(accountId);
      const resolved = normalize(facts, accounts.get(safe) ?? { ...UNFINISHED });
      accounts.set(safe, resolved);
      return snapshot(safe, resolved);
    },

    armUnavailable(): void {
      unavailableArmed = true;
    },

    listHandoffs(): ConnectionHandoff[] {
      return [...handoffs.values()].map((s) => ({ ...s.handoff }));
    },
  };
}
