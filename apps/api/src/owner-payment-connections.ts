import {z} from 'zod';
import type {Pool, PoolClient} from 'pg';
import {
  PaymentConnectionHealth,
  PaymentConnectionReason,
  PaymentConnectionStatus,
  ProviderAccountId,
  derivePaymentConnectionHealth,
} from '@lumin/contracts';
import {Uuid} from './contracts';
import {FlowError} from './repository';

/**
 * Payment connection visibility -- read-only.
 *
 * Step 3 of docs/P1_PAYMENT_CONNECTION_DECISION.md. Migration 0093 made
 * public.payment_connections server-authoritative and gave it the facts a
 * provider reports: whether the account can charge, whether it can pay out,
 * whether onboarding finished, and a closed-vocabulary reason when any of that
 * is off. NOTHING COULD SHOW ANY OF IT. 0089 deliberately kept the table's
 * member SELECT policy so the portal could display a connection's status, and
 * then no reader was ever written -- so an owner whose payments were degraded
 * or blocked had no way to find out, which is the same shape of defect as the
 * parked payments that nothing could read (see owner-payment-reviews.ts).
 *
 * THE HEALTH VERDICT IS DERIVED IN EXACTLY ONE PLACE. This reader calls
 * derivePaymentConnectionHealth from @lumin/contracts, where a 112-combination
 * cross-product test guards it. It does NOT compute a verdict of its own, and
 * 0093's public.payment_connection_facts deliberately returns facts without
 * one, so there is a single authority rather than two that can disagree.
 *
 * READ-ONLY, AND STRUCTURALLY SO. The only statement this issues against the
 * connection is `select public.payment_connection_facts(actor, tenant)`, which
 * is STABLE and whose body is a single SELECT. It cannot begin a handoff, bind
 * an account, record an observation, or change a status: those are the other
 * three RPCs of 0093 and this file does not name them. An owner reading that
 * their payments are blocked is not an owner who can silently fix it by
 * reading -- reconnecting stays an explicit, separate owner action.
 *
 * MEMBER-LEVEL, matching the RPC's own `lumin.flow_actor(actor, tenant, false)`.
 * Staff must be able to see that payments are degraded; a business whose
 * checkout is failing should not need the owner personally to discover it.
 * Reading is not the hazard here, which was 0089's own reasoning for keeping
 * member_or_admin_select.
 *
 * NO CREDENTIAL IS EXPOSED, because none exists. Under the Connect design a
 * connection is identified by an account REFERENCE -- an identifier, not a
 * bearer credential, useless without the platform secret that lives only in
 * the server runtime's secret store. The schema below carries no secret, key,
 * token or password field, and a test asserts that of every field name.
 */

export const OwnerPaymentConnectionItem = z.object({
  provider: z.string().min(1).max(60),
  status: PaymentConnectionStatus,
  /**
   * The operational verdict, derived from the stored facts by the ONE authority
   * in @lumin/contracts. Four values, not a boolean: `degraded` is the state
   * where money still moves and will strand, which a boolean would erase.
   */
  health: PaymentConnectionHealth,
  /**
   * The connected account reference, or null when nothing is bound yet. An
   * identifier, not a credential.
   */
  accountId: ProviderAccountId.nullable(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  onboardingComplete: z.boolean(),
  /** Closed vocabulary. Provider prose never reaches this field. */
  blockedReason: PaymentConnectionReason.nullable(),
  /** When the provider was last asked, ISO-8601, or null if never. */
  lastObservedAt: z.string().nullable(),
}).strict();
export type OwnerPaymentConnectionItem = z.infer<typeof OwnerPaymentConnectionItem>;

export const OwnerPaymentConnections = z.object({
  schemaVersion: z.literal(1),
  tenantId: Uuid,
  /** One row per provider; 0006 holds unique (tenant_id, provider). */
  connections: z.array(OwnerPaymentConnectionItem).max(50),
}).strict();
export type OwnerPaymentConnections = z.infer<typeof OwnerPaymentConnections>;

export type OwnerPaymentConnectionsReader = (
  actor: string,
  tenant: string,
) => Promise<OwnerPaymentConnections>;

function mapError(error: unknown): FlowError {
  if (error instanceof FlowError) return error;
  const code = (error as {code?: string} | undefined)?.code;
  return new FlowError(
    code === '42501' ? 'FORBIDDEN' :
    code === 'P0002' ? 'NOT_AVAILABLE' :
    // 42883 = the RPC is absent, i.e. this deployment's database predates 0093.
    code === '42883' ? 'UNSUPPORTED_CONFIG' :
    ['40001', '40P01', '55P03', '57014'].includes(String(code)) ? 'CONFLICT' : 'INTERNAL_ERROR',
  );
}

/** The RPC's own envelope. Validated before anything is read out of it. */
const Facts = z.object({
  schemaVersion: z.literal(1),
  connections: z.array(z.object({
    provider: z.string(),
    status: z.string(),
    accountId: z.string().nullable(),
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    onboardingComplete: z.boolean(),
    blockedReason: z.string().nullable(),
    lastObservedAt: z.string().nullable(),
  }).strict()),
}).strict();

export function createOwnerPaymentConnectionsReader(pool: Pool): OwnerPaymentConnectionsReader {
  return async (actor, tenant) => {
    if (!Uuid.safeParse(actor).success || !Uuid.safeParse(tenant).success) throw new FlowError('INVALID_REQUEST');
    actor = actor.toLowerCase();
    tenant = tenant.toLowerCase();

    let client: PoolClient | undefined;
    let broken = false;
    try {
      client = await pool.connect();
      // NOT `read only`: lumin.flow_actor takes two FOR SHARE locks and a share
      // lock cannot be acquired in a read-only transaction (25006). This reader
      // still issues only SELECTs; `repeatable read` gives the consistent
      // snapshot. Same reasoning as owner-payment-reviews.ts; see 0091.
      await client.query('begin isolation level repeatable read');
      await client.query("set local statement_timeout='5s'");
      await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      // The RPC authorizes internally with flow_actor(actor, tenant, false) and
      // raises 42501 for a non-member, so there is no separate check to forget.
      const result = await client.query(
        'select public.payment_connection_facts($1::uuid,$2::uuid) as facts',
        [actor, tenant],
      );
      await client.query('commit');

      const facts = Facts.safeParse(result.rows[0]?.facts);
      if (!facts.success) throw new FlowError('INTERNAL_ERROR');

      const connections = facts.data.connections.map((row) => {
        const status = PaymentConnectionStatus.safeParse(row.status);
        const reason = row.blockedReason === null
          ? {success: true as const, data: null}
          : PaymentConnectionReason.safeParse(row.blockedReason);
        // A status or reason outside the vocabulary means the database holds a
        // value this build does not understand. Refusing is the only safe
        // answer: guessing a verdict for an unknown state is how a blocked
        // connection would read as fine.
        if (!status.success || !reason.success) throw new FlowError('INTERNAL_ERROR');
        return {
          provider: row.provider,
          status: status.data,
          health: derivePaymentConnectionHealth({
            status: status.data,
            chargesEnabled: row.chargesEnabled,
            payoutsEnabled: row.payoutsEnabled,
            blockedReason: reason.data,
          }),
          accountId: row.accountId,
          chargesEnabled: row.chargesEnabled,
          payoutsEnabled: row.payoutsEnabled,
          onboardingComplete: row.onboardingComplete,
          blockedReason: reason.data,
          lastObservedAt: row.lastObservedAt,
        };
      });

      const parsed = OwnerPaymentConnections.safeParse({schemaVersion: 1, tenantId: tenant, connections});
      if (!parsed.success || parsed.data.tenantId !== tenant) throw new FlowError('INTERNAL_ERROR');
      return parsed.data;
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
  };
}
