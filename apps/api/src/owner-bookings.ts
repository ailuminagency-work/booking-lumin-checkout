import {z} from 'zod';
import type {Pool, PoolClient} from 'pg';
import {Uuid} from './contracts';
import {FlowError} from './repository';

/**
 * Owner booking visibility — read-only list of a tenant's bookings.
 *
 * Server-authoritative: the reader opens a read-only service-role transaction
 * and first calls `lumin.flow_actor(actor, tenant, false)`, which raises
 * FORBIDDEN unless the actor is an active member (owner OR staff) of the active
 * tenant. Only then does it run a tenant-scoped, keyset-paginated SELECT. No
 * caller-supplied tenant/recipient overrides, no cross-tenant rows, and no
 * financial or state mutation. The owner is entitled to their own customers'
 * contact names, so returning `customerName` here is not a PII leak.
 */

const Money = z.object({amount: z.number().int(), currency: z.string().min(1).max(8)}).strict();
const BookingState = z.enum(['draft', 'pending_payment', 'confirmed', 'completed', 'cancelled', 'refunded', 'failed']);

export const OwnerBookingsListItem = z.object({
  id: Uuid,
  reference: z.string().min(1).max(200),
  state: BookingState,
  slotStart: z.string(),
  slotEnd: z.string(),
  customerName: z.string().min(1).max(400).nullable(),
  total: Money.nullable(),
  paymentState: z.string().min(1).max(50).nullable(),
  paymentProvider: z.string().min(1).max(100).nullable(),
  createdAt: z.string(),
}).strict();

export const OwnerBookingsList = z.object({
  tenantId: Uuid,
  bookings: z.array(OwnerBookingsListItem).max(100),
  nextBefore: z.string().nullable(),
}).strict();
export type OwnerBookingsList = z.infer<typeof OwnerBookingsList>;

export interface OwnerBookingsListQuery {
  limit: number;
  before: string | null;
}
export type OwnerBookingsListReader = (actor: string, tenant: string, query: OwnerBookingsListQuery) => Promise<OwnerBookingsList>;

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const LIST_SQL = `select b.id, b.reference, b.state,
 to_char(b.slot_start at time zone 'UTC',${ISO}) as slot_start,
 to_char(b.slot_end at time zone 'UTC',${ISO}) as slot_end,
 c.name as customer_name,
 b.pricing->'total' as total,
 p.state as payment_state, p.provider as payment_provider,
 to_char(b.created_at at time zone 'UTC',${ISO}) as created_at
 from public.bookings b
 left join public.customers c on c.id = b.customer_id and c.tenant_id = b.tenant_id
 left join public.payments p on p.id = b.payment_id and p.tenant_id = b.tenant_id
 where b.tenant_id = $1::uuid and ($2::timestamptz is null or b.created_at < $2::timestamptz)
 order by b.created_at desc, b.id desc
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

export function createOwnerBookingsListReader(pool: Pool): OwnerBookingsListReader {
  return async (actor, tenant, query) => {
    if (!Uuid.safeParse(actor).success || !Uuid.safeParse(tenant).success) throw new FlowError('INVALID_REQUEST');
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new FlowError('INVALID_REQUEST');
    if (query.before !== null && !Number.isFinite(Date.parse(query.before))) throw new FlowError('INVALID_REQUEST');
    actor = actor.toLowerCase();
    tenant = tenant.toLowerCase();
    let client: PoolClient | undefined;
    let broken = false;
    try {
      client = await pool.connect();
      await client.query('begin isolation level repeatable read read only');
      await client.query("set local statement_timeout='5s'");
      await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      // Authorize: owner OR staff membership of the active tenant (raises 42501 otherwise).
      await client.query('select lumin.flow_actor($1::uuid,$2::uuid,false)', [actor, tenant]);
      const result = await client.query(LIST_SQL, [tenant, query.before, query.limit]);
      await client.query('commit');
      const bookings = result.rows.map((row) => {
        const total = row.total && typeof row.total === 'object' && row.total.amount !== undefined && row.total.currency !== undefined
          ? {amount: Number(row.total.amount), currency: String(row.total.currency)}
          : null;
        return {
          id: String(row.id),
          reference: String(row.reference),
          state: String(row.state),
          slotStart: String(row.slot_start),
          slotEnd: String(row.slot_end),
          customerName: row.customer_name === null || row.customer_name === undefined ? null : String(row.customer_name),
          total,
          paymentState: row.payment_state === null || row.payment_state === undefined ? null : String(row.payment_state),
          paymentProvider: row.payment_provider === null || row.payment_provider === undefined ? null : String(row.payment_provider),
          createdAt: String(row.created_at),
        };
      });
      // Keyset cursor on created_at. Only advertise a cursor when the page is full.
      const nextBefore = result.rows.length === query.limit ? String(bookings[bookings.length - 1]!.createdAt) : null;
      const parsed = OwnerBookingsList.safeParse({tenantId: tenant, bookings, nextBefore});
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
