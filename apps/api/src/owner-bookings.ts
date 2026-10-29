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

/**
 * Owner booking visibility — read-only detail for one booking.
 *
 * Same authority model as the list reader: a read-only service-role
 * transaction authorizes via `lumin.flow_actor(actor, tenant, false)` (owner OR
 * staff of the active tenant), then reads only tenant-scoped rows. Returns the
 * booking core, the customer the owner already owns, the linked payment state,
 * any recorded refunds (display only — Booking Lumin NEVER issues a refund
 * automatically and this reader writes nothing), and an activity timeline
 * SYNTHESIZED purely from persisted facts (booking created/updated, payment
 * row, per-channel confirmation delivery receipts, refund rows): the
 * `audit_events` table is not yet populated by the booking lifecycle, so no
 * event is invented — every activity entry cites a real stored timestamp.
 */

const CustomerView = z.object({
  id: Uuid,
  name: z.string().min(1).max(400),
  email: z.string().min(3).max(254),
  phone: z.string().min(1).max(32).nullable(),
}).strict();
const PaymentView = z.object({
  provider: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  amount: z.number().int(),
  currency: z.string().min(1).max(8),
  createdAt: z.string(),
}).strict();
const RefundView = z.object({
  amount: z.number().int(),
  currency: z.string().min(1).max(8),
  reason: z.string().max(400).nullable(),
  provider: z.string().max(100).nullable(),
  createdAt: z.string(),
}).strict();
const ActivityItem = z.object({
  kind: z.string().min(1).max(64),
  at: z.string(),
  detail: z.string().max(200).nullable(),
}).strict();

export const OwnerBookingDetail = z.object({
  tenantId: Uuid,
  bookingId: Uuid,
  booking: z.object({
    id: Uuid,
    reference: z.string().min(1).max(200),
    state: BookingState,
    slotStart: z.string(),
    slotEnd: z.string(),
    total: Money.nullable(),
    notes: z.string().max(4000).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).strict(),
  customer: CustomerView.nullable(),
  payment: PaymentView.nullable(),
  refunds: z.array(RefundView).max(50),
  activity: z.array(ActivityItem).max(100),
}).strict();
export type OwnerBookingDetail = z.infer<typeof OwnerBookingDetail>;
export type OwnerBookingDetailReader = (actor: string, tenant: string, booking: string) => Promise<OwnerBookingDetail>;

const DETAIL_SQL = `select jsonb_build_object(
 'booking', jsonb_build_object('id',b.id,'reference',b.reference,'state',b.state,
   'slotStart',to_char(b.slot_start at time zone 'UTC',${ISO}),
   'slotEnd',to_char(b.slot_end at time zone 'UTC',${ISO}),
   'total',b.pricing->'total','notes',b.notes,
   'createdAt',to_char(b.created_at at time zone 'UTC',${ISO}),
   'updatedAt',to_char(b.updated_at at time zone 'UTC',${ISO})),
 'customer', case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'email',c.email,'phone',c.phone) end,
 'payment', case when p.id is null then null else jsonb_build_object('provider',p.provider,'state',p.state,'amount',p.amount,'currency',p.currency,
   'createdAt',to_char(p.created_at at time zone 'UTC',${ISO})) end
 ) as result
 from public.bookings b
 left join public.customers c on c.id = b.customer_id and c.tenant_id = b.tenant_id
 left join public.payments p on p.id = b.payment_id and p.tenant_id = b.tenant_id
 where b.tenant_id = $1::uuid and b.id = $2::uuid`;
const RECEIPTS_SQL = `select channel, to_char(delivered_at at time zone 'UTC',${ISO}) as delivered_at
 from public.confirmation_delivery_receipts where tenant_id = $1::uuid and booking_id = $2::uuid
 order by delivered_at, channel limit 10`;
const REFUNDS_SQL = `select amount, currency, reason, provider, to_char(created_at at time zone 'UTC',${ISO}) as created_at
 from public.refunds where tenant_id = $1::uuid and booking_id = $2::uuid
 order by created_at, id limit 50`;

export function createOwnerBookingDetailReader(pool: Pool): OwnerBookingDetailReader {
  return async (actor, tenant, booking) => {
    if (![actor, tenant, booking].every((id) => Uuid.safeParse(id).success)) throw new FlowError('INVALID_REQUEST');
    actor = actor.toLowerCase();
    tenant = tenant.toLowerCase();
    booking = booking.toLowerCase();
    let client: PoolClient | undefined;
    let broken = false;
    try {
      client = await pool.connect();
      await client.query('begin isolation level repeatable read read only');
      await client.query("set local statement_timeout='5s'");
      await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      await client.query('select lumin.flow_actor($1::uuid,$2::uuid,false)', [actor, tenant]);
      const core = await client.query(DETAIL_SQL, [tenant, booking]);
      if (core.rows.length !== 1) throw new FlowError('NOT_AVAILABLE');
      const receipts = await client.query(RECEIPTS_SQL, [tenant, booking]);
      const refunds = await client.query(REFUNDS_SQL, [tenant, booking]);
      await client.query('commit');
      const value = core.rows[0]!.result as {booking: Record<string, unknown>; customer: Record<string, unknown> | null; payment: Record<string, unknown> | null};
      const b = value.booking;
      const total = b.total && typeof b.total === 'object' && (b.total as {amount?: unknown}).amount !== undefined
        ? {amount: Number((b.total as {amount: unknown}).amount), currency: String((b.total as {currency: unknown}).currency)}
        : null;
      const payment = value.payment === null ? null : {
        provider: String(value.payment.provider),
        state: String(value.payment.state),
        amount: Number(value.payment.amount),
        currency: String(value.payment.currency).trim(),
        createdAt: String(value.payment.createdAt),
      };
      const customer = value.customer === null ? null : {
        id: String(value.customer.id),
        name: String(value.customer.name),
        email: String(value.customer.email),
        phone: value.customer.phone === null || value.customer.phone === undefined ? null : String(value.customer.phone),
      };
      const refundRows = refunds.rows.map((row) => ({
        amount: Number(row.amount),
        currency: String(row.currency).trim(),
        reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
        provider: row.provider === null || row.provider === undefined ? null : String(row.provider),
        createdAt: String(row.created_at),
      }));
      // Activity: every entry is backed by a persisted row/timestamp; nothing invented.
      const activity: Array<{kind: string; at: string; detail: string | null}> = [
        {kind: 'booking.created', at: String(b.createdAt), detail: null},
      ];
      if (payment) activity.push({kind: `payment.${payment.state}`, at: payment.createdAt, detail: `${payment.provider}`});
      for (const row of receipts.rows) activity.push({kind: `confirmation.delivered.${String(row.channel)}`, at: String(row.delivered_at), detail: null});
      for (const refund of refundRows) activity.push({kind: 'refund.recorded', at: refund.createdAt, detail: refund.reason});
      if (b.state !== 'draft') activity.push({kind: `booking.state.${String(b.state)}`, at: String(b.updatedAt), detail: 'as of last update'});
      activity.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
      const parsed = OwnerBookingDetail.safeParse({
        tenantId: tenant,
        bookingId: booking,
        booking: {
          id: String(b.id), reference: String(b.reference), state: String(b.state),
          slotStart: String(b.slotStart), slotEnd: String(b.slotEnd), total,
          notes: b.notes === null || b.notes === undefined ? null : String(b.notes),
          createdAt: String(b.createdAt), updatedAt: String(b.updatedAt),
        },
        customer, payment, refunds: refundRows, activity: activity.slice(0, 100),
      });
      if (!parsed.success || parsed.data.tenantId !== tenant || parsed.data.bookingId !== booking || parsed.data.booking.id !== booking) throw new FlowError('INTERNAL_ERROR');
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
