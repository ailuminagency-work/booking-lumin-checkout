import {z} from 'zod';
import type {Pool, PoolClient} from 'pg';
import {Uuid} from './contracts';
import {FlowError} from './repository';

/**
 * Parked payments — read-only list of money awaiting a HUMAN decision.
 *
 * Migration 0090 created public.payment_reviews and the stripe-webhook writes
 * it: when a captured payment cannot be confirmed (the amount does not match,
 * or the capacity hold expired between capture and webhook delivery), the
 * webhook parks the payment for a person instead of refunding it. That replaced
 * a "deterministic refund-on-oversell" that moved a customer's money with
 * nobody deciding.
 *
 * NOTHING COULD READ THAT TABLE. The webhook inserted, the SQL suite asserted
 * its posture, and no reader existed anywhere in apps/ or packages/ -- so a
 * parked payment was invisible to the owner, to support, and to anyone who
 * might make the decision it is waiting for. Parking money for a human only
 * works if a human can see it.
 *
 * Server-authoritative, same authority model as the owner booking readers: a
 * service-role transaction calls `lumin.flow_actor(actor, tenant, false)`,
 * which raises FORBIDDEN unless the actor is an active member (owner OR staff)
 * of the active tenant, and only then runs a tenant-scoped SELECT. Reading is
 * not the hazard here -- the decision is -- so staff may see the queue; what
 * none of this does is DECIDE anything. This reader issues only SELECTs: it
 * cannot resolve a review, cannot alter a payment, and cannot issue a refund
 * (no refund primitive exists anywhere in the codebase any more).
 */

const ReviewReason = z.enum(['amount_mismatch', 'capacity_oversold']);
const ReviewStatus = z.enum(['open', 'resolved_honoured', 'resolved_refunded', 'resolved_other']);

export const OwnerPaymentReviewItem = z.object({
  paymentId: Uuid,
  bookingId: Uuid,
  /** The human-facing booking reference, so the row can be found without a database. */
  bookingReference: z.string().min(1).max(200).nullable(),
  reason: ReviewReason,
  provider: z.string().min(1).max(60),
  /**
   * The provider's own intent id. Not a credential: it is the handle a person
   * needs to find this charge in the provider's dashboard, which is where the
   * decision actually gets made.
   */
  providerIntentId: z.string().min(1).max(200),
  /** The SERVER-authoritative amount, in minor units. */
  expectedAmount: z.number().int().nonnegative(),
  /** What the provider reported, when that is what differed. Null otherwise. */
  observedAmount: z.number().int().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: ReviewStatus,
  resolutionNote: z.string().min(1).max(2000).nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
}).strict();
export type OwnerPaymentReviewItem = z.infer<typeof OwnerPaymentReviewItem>;

export const OwnerPaymentReviews = z.object({
  tenantId: Uuid,
  reviews: z.array(OwnerPaymentReviewItem).max(100),
  nextBefore: z.string().nullable(),
}).strict();
export type OwnerPaymentReviews = z.infer<typeof OwnerPaymentReviews>;

export interface OwnerPaymentReviewsQuery {
  limit: number;
  before: string | null;
  /** Default true: the operational question is what is parked RIGHT NOW. */
  openOnly: boolean;
}
export type OwnerPaymentReviewsReader = (
  actor: string,
  tenant: string,
  query: OwnerPaymentReviewsQuery,
) => Promise<OwnerPaymentReviews>;

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
// Tenant-scoped on payment_reviews itself, and the booking join is scoped again
// on tenant_id so a mismatched booking row can never widen the result.
// `openOnly` matches 0090's partial index payment_reviews_open_idx.
const LIST_SQL = `select r.payment_id, r.booking_id, b.reference as booking_reference,
 r.reason, r.provider, r.provider_intent_id,
 r.expected_amount::text as expected_amount, r.observed_amount::text as observed_amount,
 r.currency, r.status, r.resolution_note,
 to_char(r.created_at at time zone 'UTC',${ISO}) as created_at,
 to_char(r.resolved_at at time zone 'UTC',${ISO}) as resolved_at
 from public.payment_reviews r
 left join public.bookings b on b.id = r.booking_id and b.tenant_id = r.tenant_id
 where r.tenant_id = $1::uuid
   and ($2::timestamptz is null or r.created_at < $2::timestamptz)
   and (not $4::boolean or r.status = 'open')
 order by r.created_at desc, r.payment_id desc
 limit $3::int`;

function mapError(error: unknown): FlowError {
  if (error instanceof FlowError) return error;
  const code = (error as {code?: string} | undefined)?.code;
  return new FlowError(
    code === '42501' ? 'FORBIDDEN' :
    code === 'P0002' ? 'NOT_AVAILABLE' :
    code === '42883' ? 'UNSUPPORTED_CONFIG' :
    ['40001', '40P01', '55P03', '57014'].includes(String(code)) ? 'CONFLICT' : 'INTERNAL_ERROR',
  );
}

/** bigint arrives as a string; refuse anything that would lose precision. */
function minorUnits(value: unknown): number {
  if (value === null || value === undefined) throw new FlowError('INTERNAL_ERROR');
  const n = Number(String(value));
  if (!Number.isSafeInteger(n)) throw new FlowError('INTERNAL_ERROR');
  return n;
}

export function createOwnerPaymentReviewsReader(pool: Pool): OwnerPaymentReviewsReader {
  return async (actor, tenant, query) => {
    if (!Uuid.safeParse(actor).success || !Uuid.safeParse(tenant).success) throw new FlowError('INVALID_REQUEST');
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new FlowError('INVALID_REQUEST');
    if (query.before !== null && !Number.isFinite(Date.parse(query.before))) throw new FlowError('INVALID_REQUEST');
    if (typeof query.openOnly !== 'boolean') throw new FlowError('INVALID_REQUEST');
    actor = actor.toLowerCase();
    tenant = tenant.toLowerCase();

    let client: PoolClient | undefined;
    let broken = false;
    try {
      client = await pool.connect();
      // NOT `read only`: lumin.flow_actor takes two FOR SHARE locks (on
      // public.tenants and public.tenant_members) and a share lock cannot be
      // acquired in a read-only transaction -- it fails with 25006. This reader
      // still issues only SELECTs; `repeatable read` is what gives it a
      // consistent snapshot. See migration 0091.
      await client.query('begin isolation level repeatable read');
      await client.query("set local statement_timeout='5s'");
      await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      await client.query('select lumin.flow_actor($1::uuid,$2::uuid,false)', [actor, tenant]);
      const result = await client.query(LIST_SQL, [tenant, query.before, query.limit, query.openOnly]);
      await client.query('commit');

      const reviews = result.rows.map((row) => ({
        paymentId: String(row.payment_id),
        bookingId: String(row.booking_id),
        bookingReference: row.booking_reference === null || row.booking_reference === undefined
          ? null : String(row.booking_reference),
        reason: String(row.reason),
        provider: String(row.provider),
        providerIntentId: String(row.provider_intent_id),
        expectedAmount: minorUnits(row.expected_amount),
        observedAmount: row.observed_amount === null || row.observed_amount === undefined
          ? null : minorUnits(row.observed_amount),
        currency: String(row.currency),
        status: String(row.status),
        resolutionNote: row.resolution_note === null || row.resolution_note === undefined
          ? null : String(row.resolution_note),
        createdAt: String(row.created_at),
        resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : String(row.resolved_at),
      }));
      // Keyset cursor on created_at; only advertise one when the page is full.
      const nextBefore = result.rows.length === query.limit && reviews.length > 0
        ? String(reviews[reviews.length - 1]!.createdAt)
        : null;
      const parsed = OwnerPaymentReviews.safeParse({tenantId: tenant, reviews, nextBefore});
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
