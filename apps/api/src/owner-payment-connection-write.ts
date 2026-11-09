import {z} from 'zod';
import type {Pool, PoolClient} from 'pg';
import {
  ConnectionHandoff,
  ConnectionHandoffId,
  OnboardingUrl,
  PaymentConnectionHealth,
  PaymentConnectionProvider,
  PaymentConnectionReason,
  PaymentConnectionStatus,
  ProviderAccountId,
  derivePaymentConnectionHealth,
} from '@lumin/contracts';
import {Uuid} from './contracts';
import {FlowError} from './repository';

/**
 * Payment connection write path — step 5 of
 * docs/P1_PAYMENT_CONNECTION_DECISION.md.
 *
 * Two owner actions, and nothing else:
 *   begin   -> ask the provider for an onboarding link, ledger the handoff
 *   resolve -> read back what the provider says, record the verified connection
 *
 * NO MONEY MOVES HERE. This path creates no charge, no intent and no refund; it
 * decides WHICH connected account a later charge would be created on. Routing
 * money is step 7 and needs a separate flag.
 *
 * AUTHORITY COMES FIRST, ALWAYS. Both writers establish owner authority through
 * lumin.flow_actor before anything else happens -- before the provider is
 * contacted, not merely before the database is written. The tenant id arrives
 * from the browser, so until flow_actor has run it names a business the caller
 * may have nothing to do with, and handing it to a payment provider is already
 * an action taken on that business's behalf.
 *
 * WHY THE PROVIDER IS CALLED BEFORE THE LEDGER, AND WHAT THAT COSTS. `begin`
 * cannot write the ledger first: the handoff id comes FROM the provider (for
 * Stripe it IS the account reference, minted by Stripe), so there is nothing to
 * ledger until the provider has answered. If the ledger write then fails, a
 * provider-side account exists that this system has no record of -- harmless for
 * the mock, an orphan Stripe account in step 6. The mitigation is the contract's
 * idempotency requirement: beginConnection with the SAME key must return the
 * same account, so the retry ledgers the original rather than creating a second.
 * That is the whole reason `idempotencyKey` is on BeginConnectionInput, and it
 * is why this writer never generates a fresh key on retry.
 *
 * WHY `resolve` READS THE LEDGER BEFORE IT TOUCHES THE PROVIDER. The handoff id
 * arrives from the browser. Passing it straight to the adapter would mean a
 * caller could name any id -- and for Stripe, where the handoff id is the
 * account reference, that is a request to the provider about a STRANGER's
 * account, whose success or failure is itself information. So the id is first
 * looked up in public.payment_connection_handoffs scoped to the acting tenant;
 * only the ledger's own stored id is then handed to the adapter. The database
 * would refuse the bind anyway (record_payment_connection scopes the handoff to
 * p_tenant), but refusing before the provider call is the stronger order.
 *
 * AN INCONCLUSIVE PROVIDER ANSWER NEVER REACHES THE DATABASE. The adapter throws
 * PROVIDER_UNAVAILABLE on a 5xx, a 429, a timeout or a non-JSON body, and this
 * writer calls the recording RPC only after a snapshot comes back. So the stored
 * row keeps its status and a transient provider failure cannot take a tenant's
 * checkout offline. The adapter half is tested in packages/adapters; the
 * ordering half is tested here.
 *
 * NO TRANSACTION IS HELD ACROSS A PROVIDER CALL. Both writers open a database
 * transaction only to run an RPC, and `resolve` deliberately uses two short ones
 * with the provider call BETWEEN them rather than one long one around it. A
 * provider that takes ten seconds would otherwise hold a pooled connection and
 * the connection row's lock for ten seconds, turning one slow provider into a
 * pool exhaustion. The cost of two transactions is that authority is checked
 * twice -- which is not a cost: it means a membership revoked mid-flight is
 * honoured by the recording half.
 *
 * STATUS IS NEVER PASSED. This writer reports the snapshot's facts and the
 * database derives the status (lumin.payment_connection_status). There is no
 * parameter here that sets one, so there is nothing for a caller to assert.
 */

export const OwnerConnectionBeginInput = z.object({
  /** Where the provider returns the owner once the handoff finishes. */
  returnUrl: z.string().min(1).max(2000),
  /** Where the provider returns the owner if the link went stale. */
  refreshUrl: z.string().min(1).max(2000),
  /**
   * Retries with the same key MUST NOT begin a second handoff, at the provider
   * or in the ledger. Bounded to the ledger's own column constraint.
   */
  idempotencyKey: z.string().min(16).max(200),
}).strict();
export type OwnerConnectionBeginInput = z.infer<typeof OwnerConnectionBeginInput>;

export const OwnerConnectionBeginReceipt = z.object({
  schemaVersion: z.literal(1),
  tenantId: Uuid,
  provider: z.string().min(1).max(60),
  /** Same authority as the ledger's own column constraint. */
  handoffId: ConnectionHandoffId,
  /**
   * The URL the OWNER visits. Inert until a person completes it.
   *
   * The contract's https-only check, not a bare `z.string().url()`, which
   * accepts `javascript:`. This receipt is the last gate before the browser.
   */
  onboardingUrl: OnboardingUrl,
  expiresAt: z.string(),
  /** True when the same idempotency key had already begun this handoff. */
  replayed: z.boolean(),
}).strict();
export type OwnerConnectionBeginReceipt = z.infer<typeof OwnerConnectionBeginReceipt>;

export const OwnerConnectionResolveInput = z.object({
  /**
   * Arrives from the browser. Held to the ledger's own character class so a
   * control character is refused HERE, not merely failed to match a row: for
   * Stripe this value is the account reference that travels in a request
   * header, and the edge is the right place to refuse one that cannot.
   */
  handoffId: ConnectionHandoffId,
}).strict();
export type OwnerConnectionResolveInput = z.infer<typeof OwnerConnectionResolveInput>;

export const OwnerConnectionResolveReceipt = z.object({
  schemaVersion: z.literal(1),
  tenantId: Uuid,
  provider: z.string().min(1).max(60),
  accountId: ProviderAccountId,
  /** Derived BY THE DATABASE from the reported facts. Never passed in. */
  status: PaymentConnectionStatus,
  /** Derived by the ONE authority in @lumin/contracts. */
  health: PaymentConnectionHealth,
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  onboardingComplete: z.boolean(),
  blockedReason: PaymentConnectionReason.nullable(),
  /** True when this handoff had already been recorded. */
  replayed: z.boolean(),
}).strict();
export type OwnerConnectionResolveReceipt = z.infer<typeof OwnerConnectionResolveReceipt>;

export type OwnerConnectionBeginWriter = (
  actor: string,
  tenant: string,
  input: OwnerConnectionBeginInput,
) => Promise<OwnerConnectionBeginReceipt>;

export type OwnerConnectionResolveWriter = (
  actor: string,
  tenant: string,
  input: OwnerConnectionResolveInput,
) => Promise<OwnerConnectionResolveReceipt>;

function mapError(error: unknown): FlowError {
  if (error instanceof FlowError) return error;
  const code = (error as {code?: string} | undefined)?.code;
  return new FlowError(
    code === '42501' ? 'FORBIDDEN' :
    code === '22023' ? 'INVALID_REQUEST' :
    code === '23505' ? 'CONFLICT' :
    code === 'P0002' ? 'NOT_AVAILABLE' :
    // 42883 = an RPC is absent, i.e. this database predates 0093.
    code === '42883' ? 'UNSUPPORTED_CONFIG' :
    ['40001', '40P01', '55P03', '57014'].includes(String(code)) ? 'CONFLICT' : 'INTERNAL_ERROR',
  );
}

/** One service_role transaction, READ COMMITTED, with the actor authorized. */
async function inAuthorizedTransaction<T>(
  pool: Pool,
  actor: string,
  tenant: string,
  ownerOnly: boolean,
  body: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient | undefined;
  let broken = false;
  try {
    client = await pool.connect();
    // READ COMMITTED, not repeatable read: these RPCs take row locks and the
    // owner readers' snapshot mode is wrong for a writer.
    await client.query('begin');
    await client.query("set local statement_timeout='8s'");
    await client.query("set local lock_timeout='4s'");
    await client.query('set local role service_role');
    await client.query('select lumin.flow_actor($1::uuid,$2::uuid,$3::boolean)', [actor, tenant, ownerOnly]);
    const out = await body(client);
    await client.query('commit');
    return out;
  } catch (error) {
    try {
      await client?.query('rollback');
    } catch {
      broken = true;
    }
    throw mapError(error);
  } finally {
    client?.release(broken);
  }
}

function guardIds(actor: string, tenant: string): [string, string] {
  if (!Uuid.safeParse(actor).success || !Uuid.safeParse(tenant).success) throw new FlowError('INVALID_REQUEST');
  return [actor.toLowerCase(), tenant.toLowerCase()];
}

export function createOwnerConnectionBeginWriter(
  pool: Pool,
  provider: PaymentConnectionProvider,
): OwnerConnectionBeginWriter {
  return async (actorRaw, tenantRaw, input) => {
    const [actor, tenant] = guardIds(actorRaw, tenantRaw);
    const parsed = OwnerConnectionBeginInput.safeParse(input);
    if (!parsed.success) throw new FlowError('INVALID_REQUEST');

    // AUTHORIZE BEFORE THE PROVIDER IS TOUCHED.
    //
    // Shape checks are not authority. The tenant id arrives from the browser, so
    // without this an authenticated caller -- a staff member, a non-member, the
    // owner of a different business -- could name ANY tenant and have the
    // provider act on it, receiving 403 only afterwards. Against the mock that
    // is a stray object; against the Stripe adapter of step 6 it is a real
    // Connect account created on the platform, with caller-chosen metadata and
    // return URLs, orphaned because the ledger write that follows is refused.
    //
    // So the first thing that happens is lumin.flow_actor with owner authority,
    // in its own short transaction. The ledger write below opens a second one
    // and checks again -- see the header on why two short transactions beat one
    // held across a network call.
    await inAuthorizedTransaction(pool, actor, tenant, true, async () => undefined);

    // Now the provider, because the handoff id comes from it. See the header
    // for what that costs and why the idempotency key is the mitigation.
    let handoff: ConnectionHandoff;
    try {
      handoff = ConnectionHandoff.parse(await provider.beginConnection({
        tenantId: tenant,
        returnUrl: parsed.data.returnUrl,
        refreshUrl: parsed.data.refreshUrl,
        idempotencyKey: parsed.data.idempotencyKey,
      }));
    } catch (error) {
      throw mapError(error);
    }

    const recorded = await inAuthorizedTransaction(pool, actor, tenant, true, async (client) => {
      const result = await client.query(
        'select public.begin_payment_connection($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz) as receipt',
        [actor, tenant, provider.providerName, parsed.data.idempotencyKey, handoff.handoffId, handoff.expiresAt],
      );
      return result.rows[0]?.receipt as {handoffId?: unknown; replayed?: unknown} | undefined;
    });

    // THE LEDGER'S HANDOFF AND THE URL IN HAND MUST BE THE SAME HANDOFF.
    //
    // begin_payment_connection returns the handoff the ledger holds for this
    // idempotency key, which is NOT necessarily the one just minted: an earlier
    // attempt with the same key, or a concurrent call that won the insert, keeps
    // the original. The adapter contract says beginConnection with the same key
    // returns the same handoff, so with a correct adapter these always agree.
    //
    // When they do not, the receipt would pair the LEDGER's id with the
    // ADAPTER's onboarding URL -- two different accounts. The owner follows the
    // link, completes onboarding on account A, and resolve then reads account B
    // and reports not_connected. Onboarding looks successful, checkout stays
    // off, and nothing anywhere raises. Refuse instead: an adapter that breaks
    // its idempotency contract is a server fault, and this is the point where
    // it is still visible.
    const ledgerHandoffId = String(recorded?.handoffId ?? '');
    if (ledgerHandoffId !== handoff.handoffId) throw new FlowError('INTERNAL_ERROR');

    const receipt = OwnerConnectionBeginReceipt.safeParse({
      schemaVersion: 1,
      tenantId: tenant,
      provider: provider.providerName,
      // The LEDGER's handoff id: it is the one a later resolve must be given,
      // and the check above has established it is also the one the URL opens.
      handoffId: ledgerHandoffId,
      onboardingUrl: handoff.onboardingUrl,
      expiresAt: handoff.expiresAt,
      replayed: recorded?.replayed === true,
    });
    if (!receipt.success || receipt.data.tenantId !== tenant) throw new FlowError('INTERNAL_ERROR');
    return receipt.data;
  };
}

export function createOwnerConnectionResolveWriter(
  pool: Pool,
  provider: PaymentConnectionProvider,
): OwnerConnectionResolveWriter {
  return async (actorRaw, tenantRaw, input) => {
    const [actor, tenant] = guardIds(actorRaw, tenantRaw);
    const parsed = OwnerConnectionResolveInput.safeParse(input);
    if (!parsed.success) throw new FlowError('INVALID_REQUEST');

    // PHASE 1 -- the ledger, scoped to this tenant, BEFORE the provider is
    // touched. A handoff id the caller does not own never reaches the adapter.
    const ledger = await inAuthorizedTransaction(pool, actor, tenant, true, async (client) => {
      const result = await client.query(
        `select handoff_id, provider from public.payment_connection_handoffs
          where handoff_id = $1 and tenant_id = $2::uuid`,
        [parsed.data.handoffId, tenant],
      );
      return result.rows[0] as {handoff_id: string; provider: string} | undefined;
    });
    if (!ledger) throw new FlowError('NOT_AVAILABLE');
    if (ledger.provider !== provider.providerName) {
      // The handoff was begun against a different provider than the one wired
      // now. Resolving it with this adapter would read the wrong system.
      throw new FlowError('UNSUPPORTED_CONFIG');
    }

    // PHASE 2 -- the provider. An inconclusive answer throws here and PHASE 3
    // never runs, so the stored row keeps whatever status it had.
    let snapshot;
    try {
      snapshot = await provider.resolveConnection(ledger.handoff_id);
    } catch (error) {
      throw mapError(error);
    }

    // PHASE 3 -- record. The facts go in; the database derives the status.
    const recorded = await inAuthorizedTransaction(pool, actor, tenant, true, async (client) => {
      const result = await client.query(
        `select public.record_payment_connection(
           $1::uuid,$2::uuid,$3,$4,$5::boolean,$6::boolean,$7::boolean,$8,$9::timestamptz) as receipt`,
        [
          actor, tenant, ledger.handoff_id, snapshot.accountId,
          snapshot.chargesEnabled, snapshot.payoutsEnabled, snapshot.onboardingComplete,
          snapshot.blockedReason, snapshot.observedAt,
        ],
      );
      return result.rows[0]?.receipt as {status?: unknown; replayed?: unknown; accountId?: unknown} | undefined;
    });

    const status = PaymentConnectionStatus.safeParse(recorded?.status);
    if (!status.success) throw new FlowError('INTERNAL_ERROR');

    const receipt = OwnerConnectionResolveReceipt.safeParse({
      schemaVersion: 1,
      tenantId: tenant,
      provider: provider.providerName,
      accountId: snapshot.accountId,
      status: status.data,
      // The ONE authority. Derived from the status the DATABASE returned, not
      // from anything this writer decided.
      health: derivePaymentConnectionHealth({
        status: status.data,
        chargesEnabled: snapshot.chargesEnabled,
        payoutsEnabled: snapshot.payoutsEnabled,
        blockedReason: snapshot.blockedReason,
      }),
      chargesEnabled: snapshot.chargesEnabled,
      payoutsEnabled: snapshot.payoutsEnabled,
      onboardingComplete: snapshot.onboardingComplete,
      blockedReason: snapshot.blockedReason,
      replayed: recorded?.replayed === true,
    });
    if (!receipt.success || receipt.data.tenantId !== tenant) throw new FlowError('INTERNAL_ERROR');
    return receipt.data;
  };
}
