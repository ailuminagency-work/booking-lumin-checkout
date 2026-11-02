import {z} from 'zod';
import type {Pool, PoolClient} from 'pg';
import {Uuid} from './contracts';
import {FlowError} from './repository';

/**
 * Owner booking cancellation — the only legal cancel edge, and never a refund.
 *
 * Narrow by design. `lumin.enforce_booking_transition` (0005) is a BEFORE UPDATE
 * trigger that no role is exempt from, and its table permits exactly one cancel
 * edge: `confirmed -> cancelled`. `draft`/`pending_payment` may only go to
 * `failed`, and `completed` only to `refunded`. So this writer accepts a
 * confirmed booking and refuses every other state with a precise code rather
 * than quietly routing an unpaid booking to `failed` — which state an unpaid
 * cancellation should land in is a product decision, not one to infer here.
 *
 * MONEY: this never calls a payment provider and never writes `refunds`. The
 * payment row is left exactly as it was (a paid booking stays `succeeded`), so
 * the detail reader shows paid + cancelled + no refund — i.e. "a refund may be
 * owed" is visible to a human, who decides. The receipt states
 * `refundIssued: false` as an explicit contract.
 *
 * CAPACITY: nothing to release. A confirmed booking's hold is already
 * `consumed`, and a consumed hold counts for nothing; the slot is held by
 * `bookings.state` being in ('pending_payment','confirmed','completed')
 * (0022:156-172). Moving state to `cancelled` frees the slot by itself.
 * `release_hold` would be a no-op here (it only matches `status='active'`).
 *
 * ISOLATION: READ COMMITTED is mandatory. The `zz_group_parent` trigger
 * (0025:218) routes any state change through `lumin.group_rc()`, which raises
 * GROUP_ISOLATION_UNSUPPORTED under any other isolation level. This writer must
 * NOT copy the owner readers' `repeatable read read only` transaction.
 *
 * AUDIT: free. `lumin.log_booking_state` appends the `confirmed -> cancelled`
 * row to `booking_state_history`, which the detail reader surfaces.
 */

export const OwnerBookingCancelReceipt = z.object({
  tenantId: Uuid,
  bookingId: Uuid,
  state: z.literal('cancelled'),
  cancelledAt: z.string(),
  /** Untouched payment state, so an owed refund is visible without being acted on. */
  paymentState: z.string().min(1).max(50).nullable(),
  /** Always false: Booking Lumin never issues a refund automatically. */
  refundIssued: z.literal(false),
  /** True when the booking was already cancelled (double-submit safe). */
  replayed: z.boolean(),
}).strict();
export type OwnerBookingCancelReceipt = z.infer<typeof OwnerBookingCancelReceipt>;
export type OwnerBookingCancelWriter = (actor: string, tenant: string, booking: string, expectedState: string) => Promise<OwnerBookingCancelReceipt>;

const CANCELLABLE = 'confirmed';
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const LOCK_SQL = `select b.state, p.state as payment_state,
 to_char(b.updated_at at time zone 'UTC',${ISO}) as updated_at
 from public.bookings b
 left join public.payments p on p.id = b.payment_id and p.tenant_id = b.tenant_id
 where b.tenant_id = $1::uuid and b.id = $2::uuid
 for update of b`;
const CANCEL_SQL = `update public.bookings set state='cancelled'
 where tenant_id = $1::uuid and id = $2::uuid and state = '${CANCELLABLE}'
 returning to_char(updated_at at time zone 'UTC',${ISO}) as cancelled_at`;

function mapError(error: unknown): FlowError {
  if (error instanceof FlowError) return error;
  const code = (error as {code?: string} | undefined)?.code;
  // P0001 ILLEGAL_TRANSITION, 0A000 group guards (planning-managed / isolation).
  return new FlowError(
    code === '42501' ? 'FORBIDDEN' :
    code === 'P0002' ? 'NOT_AVAILABLE' :
    code === '42883' ? 'UNSUPPORTED_CONFIG' :
    code === 'P0001' || code === '0A000' ? 'UNSUPPORTED_CONFIG' :
    ['40001', '40P01', '55P03', '57014', '23505'].includes(String(code)) ? 'CONFLICT' : 'INTERNAL_ERROR',
  );
}

export function createOwnerBookingCancelWriter(pool: Pool): OwnerBookingCancelWriter {
  return async (actor, tenant, booking, expectedState) => {
    if (![actor, tenant, booking].every((id) => Uuid.safeParse(id).success)) throw new FlowError('INVALID_REQUEST');
    if (typeof expectedState !== 'string' || expectedState.length === 0 || expectedState.length > 40) throw new FlowError('INVALID_REQUEST');
    actor = actor.toLowerCase();
    tenant = tenant.toLowerCase();
    booking = booking.toLowerCase();
    let client: PoolClient | undefined;
    let broken = false;
    try {
      client = await pool.connect();
      // READ COMMITTED (default) is required by lumin.group_rc; stated explicitly.
      await client.query('begin isolation level read committed');
      await client.query("set local statement_timeout='5s'");
      await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      // Owner-only: cancelling is a commitment- and money-affecting action.
      await client.query('select lumin.flow_actor($1::uuid,$2::uuid,true)', [actor, tenant]);
      const locked = await client.query(LOCK_SQL, [tenant, booking]);
      if (locked.rows.length !== 1) throw new FlowError('NOT_AVAILABLE');
      const current = String(locked.rows[0]!.state);
      const paymentState = locked.rows[0]!.payment_state === null || locked.rows[0]!.payment_state === undefined
        ? null : String(locked.rows[0]!.payment_state);
      // Already cancelled: the desired end state holds, so a double submit is a
      // replay, not a conflict — whatever the caller expected.
      if (current === 'cancelled') {
        await client.query('commit');
        const receipt = OwnerBookingCancelReceipt.safeParse({
          tenantId: tenant, bookingId: booking, state: 'cancelled',
          cancelledAt: String(locked.rows[0]!.updated_at), paymentState,
          refundIssued: false, replayed: true,
        });
        if (!receipt.success) throw new FlowError('INTERNAL_ERROR');
        return receipt.data;
      }
      // Stale owner view (the booking moved since it was read) -> refuse.
      if (current !== expectedState) throw new FlowError('CONFLICT');
      // Only confirmed -> cancelled is legal; anything else is refused here
      // rather than left to the trigger, so the caller gets a clear reason.
      if (current !== CANCELLABLE) throw new FlowError('UNSUPPORTED_CONFIG');
      const updated = await client.query(CANCEL_SQL, [tenant, booking]);
      if (updated.rows.length !== 1) throw new FlowError('CONFLICT');
      await client.query('commit');
      const receipt = OwnerBookingCancelReceipt.safeParse({
        tenantId: tenant, bookingId: booking, state: 'cancelled',
        cancelledAt: String(updated.rows[0]!.cancelled_at), paymentState,
        refundIssued: false, replayed: false,
      });
      if (!receipt.success) throw new FlowError('INTERNAL_ERROR');
      return receipt.data;
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
