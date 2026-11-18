import { z } from "zod";
import { PaymentError } from "./errors";
import { TenantId } from "./tenant";

/**
 * PaymentConnectionContract v1
 *
 * How a tenant's payment connection is ESTABLISHED and READ. This is a
 * deliberately separate contract from `PaymentProvider` in ./payment.ts, and
 * the separation is the point:
 *
 *  - `PaymentProvider` is constructed per charge, with the connected account
 *    already resolved. It moves money.
 *  - `PaymentConnectionProvider` (this file) is what resolves the account. It
 *    moves no money and has no charge, capture, cancel or refund member.
 *
 * Keeping them apart means the charge path, the mock payment adapter and the
 * deliberate Deno duplicate at supabase/functions/_shared/stripe.ts do not grow
 * a member when connection handling lands. See
 * docs/P1_PAYMENT_CONNECTION_DECISION.md.
 *
 * NO PER-TENANT SECRET CROSSES THIS CONTRACT. A connection is identified by a
 * provider account REFERENCE -- an identifier, not a bearer credential. Nothing
 * can be done with it without the platform secret, which lives only in the
 * server runtime's secret store and never appears in this package. A tenant is
 * never asked to paste a secret key, and none is stored for them.
 *
 * NOTHING HERE MUTATES A CONNECTION AT THE PROVIDER. The only outbound write in
 * this contract is `beginConnection`, which asks the provider for an onboarding
 * link. That link is inert until a PERSON completes it, it cannot alter an
 * account that already exists, and it cannot repoint or disable an existing
 * connection. There is no `disconnect`, no `revoke`, no `disable` and no
 * `recordHealth`: automation must never take a merchant's payments offline
 * without owner action, so the capability to do so is absent rather than
 * guarded.
 *
 * AUTHORITY SPLIT, stated once so it cannot drift: the stored `status` of a
 * connection is DERIVED IN THE DATABASE from what a provider said (migration
 * 0093's `lumin.payment_connection_status`). This package deliberately contains
 * no status derivation -- a caller reports a snapshot and the database decides.
 * What this package derives is the operational HEALTH VERDICT read off a stored
 * row, which is a presentation concern and has no authority over the row.
 */

/**
 * Stored connection status. Exactly the four values migration 0006's check
 * constraint on public.payment_connections permits, in its order. Derived by
 * the database, never by a caller.
 */
export const PaymentConnectionStatus = z.enum(["not_connected", "connected", "error", "revoked"]);
export type PaymentConnectionStatus = z.infer<typeof PaymentConnectionStatus>;

/**
 * Why a connection cannot charge, or charges with a caveat. A CLOSED
 * vocabulary, because this value is published to every BUSINESS_STAFF member of
 * the tenant and is the likeliest place a raw provider error body would land. A
 * provider's own message is never forwarded; it is mapped onto one of these or
 * the answer is treated as inconclusive.
 *
 *  - onboarding_incomplete: the owner has not finished the provider's handoff.
 *      Legitimate ALONGSIDE charges_enabled: more information is due later.
 *  - charges_disabled:      the provider says this account may not charge.
 *  - payouts_disabled:      it may charge, but the money will strand. Charging
 *      into an account that cannot pay out is worse than not charging, yet it
 *      is NOT a hard block -- see derivePaymentConnectionHealth.
 *  - requirements_past_due: a restricted merchant; information is overdue.
 *  - credentials_invalid:   the provider rejected our reference to the account
 *      (e.g. Stripe's 403 account_invalid). This is DATA, not an outage.
 *  - account_rejected:      the provider rejected the account outright.
 */
export const PaymentConnectionReason = z.enum([
  "onboarding_incomplete",
  "charges_disabled",
  "payouts_disabled",
  "requirements_past_due",
  "credentials_invalid",
  "account_rejected",
]);
export type PaymentConnectionReason = z.infer<typeof PaymentConnectionReason>;

/**
 * The operational verdict an operator and the portal read. FOUR values, not a
 * boolean: a boolean erases the restricted-merchant state, where a connection
 * is connected and looks fine and cannot take money.
 *
 *  - chargeable:    connected, charges enabled, payouts enabled, no caveat.
 *  - degraded:      charges, but something is wrong (payouts off, information
 *                   due). Money still moves; someone should look.
 *  - blocked:       connected (or errored/revoked) and CANNOT charge.
 *  - not_connected: there is nothing here yet.
 */
export const PaymentConnectionHealth = z.enum(["chargeable", "degraded", "blocked", "not_connected"]);
export type PaymentConnectionHealth = z.infer<typeof PaymentConnectionHealth>;

/**
 * A provider account reference, constrained so it can NEVER splice a header.
 *
 * The resolved account id is sent to the provider in a request header on every
 * charge. A value containing CR, LF, a colon-space or a NUL is a request
 * smuggling primitive, so the shape is validated the moment it is resolved --
 * with zero network calls -- rather than at the point of use.
 *
 * Provider-NEUTRAL on purpose: this is the floor every provider's reference must
 * clear. A concrete adapter narrows it further (the Stripe adapter requires
 * `^acct_[A-Za-z0-9]{8,64}$`); none may widen it.
 */
export const PROVIDER_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{7,127}$/;

export const ProviderAccountId = z
  .string()
  .regex(PROVIDER_ACCOUNT_ID_PATTERN, "provider account reference is not header-safe");
export type ProviderAccountId = z.infer<typeof ProviderAccountId>;

/**
 * Narrow an untrusted value to a header-safe account reference, or refuse.
 *
 * Throws PaymentError("CONNECTION_UNVERIFIED") -- not a validation code --
 * because the consequence is the same as a failed provider check: this is not
 * something the system may treat as a connection. Fails closed and makes no
 * request.
 */
export function assertHeaderSafeAccountId(value: unknown): ProviderAccountId {
  const parsed = ProviderAccountId.safeParse(value);
  if (!parsed.success) {
    // The rejected value is NOT echoed: it is attacker-controlled and this
    // message reaches logs.
    throw new PaymentError("CONNECTION_UNVERIFIED", "provider account reference is not header-safe");
  }
  return parsed.data;
}

/**
 * What a provider said about an account at one moment. The INPUT to the
 * database's status derivation; it is not itself a status.
 *
 * `chargesEnabled || blockedReason !== null` is enforced here and by the same
 * check constraint on the stored row: if an account cannot charge, the record
 * must say why. The converse is deliberately allowed -- a reason WITH charges
 * enabled is how partial onboarding and a payouts problem are expressed.
 */
export const PaymentConnectionSnapshot = z
  .object({
    provider: z.string().min(1),
    accountId: ProviderAccountId,
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    onboardingComplete: z.boolean(),
    blockedReason: PaymentConnectionReason.nullable(),
    /** When the provider was asked, ISO-8601. Not when the row was written. */
    observedAt: z.string().datetime(),
  })
  .strict()
  .refine((s) => s.chargesEnabled || s.blockedReason !== null, {
    message: "a snapshot that cannot charge must carry a reason",
    path: ["blockedReason"],
  });
export type PaymentConnectionSnapshot = z.infer<typeof PaymentConnectionSnapshot>;

/**
 * The fields of a STORED connection that the health verdict is read from.
 * Structural, so both the API reader and a test can pass a literal.
 */
export interface PaymentConnectionFacts {
  status: PaymentConnectionStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  blockedReason: PaymentConnectionReason | null;
}

/**
 * The operational verdict, TOTAL over every status x chargesEnabled x
 * payoutsEnabled x reason combination. Pure: no clock, no IO, no throw.
 *
 * Order matters and is asserted by paymentConnection.test.ts:
 *  1. `not_connected` is exactly the absence of a connection, nothing else.
 *  2. `error` and `revoked` are blocked REGARDLESS of the flags, because the
 *     flags on such a row are stale by definition -- a revoked connection that
 *     still carries chargesEnabled must never read as chargeable.
 *  3. Cannot charge => blocked. Never degraded: degraded means money moves.
 *  4. Charges but cannot pay out => degraded, never blocked. It still charges,
 *     and the money will strand, which is what someone must be told.
 */
export function derivePaymentConnectionHealth(facts: PaymentConnectionFacts): PaymentConnectionHealth {
  if (facts.status === "not_connected") return "not_connected";
  if (facts.status !== "connected") return "blocked";
  if (!facts.chargesEnabled) return "blocked";
  if (!facts.payoutsEnabled) return "degraded";
  if (facts.blockedReason !== null) return "degraded";
  return "chargeable";
}

/** Does this verdict permit creating a charge? Only one of the four does. */
export function isChargeableHealth(health: PaymentConnectionHealth): boolean {
  return health === "chargeable";
}

export interface BeginConnectionInput {
  tenantId: TenantId;
  /** Where the provider returns the owner once the handoff finishes. */
  returnUrl: string;
  /** Where the provider returns the owner if the link went stale. */
  refreshUrl: string;
  /** Retries with the same key MUST NOT begin a second handoff. */
  idempotencyKey: string;
}

/**
 * A handoff the OWNER completes. Holding one grants nothing: until a person
 * finishes it at the provider, resolveConnection reports an account that cannot
 * charge.
 */
/**
 * The URL an owner is sent to in order to finish a handoff.
 *
 * HTTPS ONLY. `z.string().url()` alone accepts `javascript:` and `data:`, and
 * this value is handed to a browser, so the scheme is constrained here rather
 * than trusted to each adapter -- or to each layer that forwards it. Exported
 * so the adapter boundary and the API receipt use the SAME check: the receipt
 * is the last gate before the browser, and a weaker one there would undo this.
 */
export const OnboardingUrl = z
  .string()
  .url()
  .refine((u) => /^https:\/\//i.test(u), "onboardingUrl must be https");
export type OnboardingUrl = z.infer<typeof OnboardingUrl>;

/**
 * A handoff reference.
 *
 * The same character class the ledger enforces
 * (`payment_connection_handoffs.handoff_id` in 0093), so an API that accepts
 * one can always store it and the two cannot drift. Deliberately header-safe:
 * for Stripe the handoff reference IS the connected account id, which travels
 * in a `Stripe-Account` request header, and this id arrives from a browser.
 *
 * Wider than ProviderAccountId on purpose -- a provider may mint an opaque
 * handoff token that is not an account reference -- but never wider than what a
 * header will carry.
 */
export const HANDOFF_ID_PATTERN = /^[A-Za-z0-9_.-]{8,200}$/;

export const ConnectionHandoffId = z
  .string()
  .regex(HANDOFF_ID_PATTERN, "handoff reference is not header-safe");
export type ConnectionHandoffId = z.infer<typeof ConnectionHandoffId>;

export const ConnectionHandoff = z
  .object({
    provider: z.string().min(1),
    /** Opaque; the server stores it to resolve the handoff later. */
    handoffId: ConnectionHandoffId,
    /** The URL the owner visits. Single-purpose, short-lived, https only. */
    onboardingUrl: OnboardingUrl,
    expiresAt: z.string().datetime(),
  })
  .strict();
export type ConnectionHandoff = z.infer<typeof ConnectionHandoff>;

/**
 * PaymentConnectionProvider -- read-mostly by construction.
 *
 * An inconclusive answer MUST throw PaymentError("PROVIDER_UNAVAILABLE"): a
 * 5xx, a timeout, a non-JSON body. An inconclusive answer must never be turned
 * into a snapshot, because the caller would then record it and a transient
 * provider failure would take a tenant's checkout offline. A provider saying
 * "this account is invalid" is the opposite -- that is data, and belongs in a
 * snapshot as `credentials_invalid`.
 *
 * An implementation MUST NOT add a member that disables, disconnects, repoints
 * or otherwise changes an existing connection. mockPaymentConnection's shape
 * test fails on one.
 */
export interface PaymentConnectionProvider {
  /** Matches the provider label in public.confirmable_payment_providers. */
  readonly providerName: string;

  /** Ask the provider for an onboarding link for a person to complete. */
  beginConnection(input: BeginConnectionInput): Promise<ConnectionHandoff>;

  /**
   * Read back what the provider says after a handoff. Reports an un-finished
   * handoff honestly (onboardingComplete false, a reason) rather than throwing;
   * throws CONNECTION_UNVERIFIED for a handoff this provider never issued.
   */
  resolveConnection(handoffId: string): Promise<PaymentConnectionSnapshot>;

  /** Re-read a known account. This is the health check. */
  inspectConnection(accountId: string): Promise<PaymentConnectionSnapshot>;
}
