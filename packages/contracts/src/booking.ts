import { z } from "zod";
import { Money } from "./money";
import { PriceBreakdown } from "./pricing";
import { Selection } from "./service";
import { TenantId } from "./tenant";

/**
 * BookingContract v1
 *
 * Booking state is server-authoritative. Legal transitions are encoded here
 * so every layer (engine, database triggers, UI) shares one state model.
 *
 * Invariants (Security Invariants 2 & 3):
 *  - Payment and booking state are server-authoritative.
 *  - One successful payment creates AT MOST one booking
 *    (enforced by a unique constraint on payments.provider_intent_id and
 *    bookings.payment_id, plus idempotent creation keyed on idempotencyKey).
 */

export const BookingState = z.enum([
  "draft", // selection made, nothing committed
  "pending_payment", // availability verified, awaiting payment result
  "confirmed", // payment succeeded, slot committed
  "completed", // service delivered
  "cancelled", // cancelled before completion
  "refunded", // cancelled with money returned
  "failed", // payment failed / availability lost before confirmation
]);
export type BookingState = z.infer<typeof BookingState>;

export const BOOKING_TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  draft: ["pending_payment", "failed"],
  pending_payment: ["confirmed", "failed"],
  confirmed: ["completed", "cancelled", "refunded"],
  completed: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
  failed: [],
};

export const CustomerDetails = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(3).optional(),
});
export type CustomerDetails = z.infer<typeof CustomerDetails>;

export const Address = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  /** Region/state/province — free text for international support. */
  region: z.string().optional(),
  postalCode: z.string().optional(),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2),
});
export type Address = z.infer<typeof Address>;

export const CreateBookingRequest = z.object({
  tenantId: TenantId,
  /** Client-generated stable key: retries of the same checkout MUST reuse it. */
  idempotencyKey: z.string().min(16),
  selection: Selection,
  slotStart: z.string().datetime(),
  customer: CustomerDetails,
  address: Address.optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequest>;

export const BookingRecord = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  /** Human-facing reference, e.g. "LMN-3F8K2Q". Unique per tenant. */
  reference: z.string().min(6),
  state: BookingState,
  selection: Selection,
  pricing: PriceBreakdown,
  slotStart: z.string().datetime(),
  slotEnd: z.string().datetime(),
  customer: CustomerDetails,
  address: Address.optional(),
  paymentId: z.string().uuid().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BookingRecord = z.infer<typeof BookingRecord>;

export const BookingStateChange = z.object({
  bookingId: z.string().uuid(),
  from: BookingState,
  to: BookingState,
  at: z.string().datetime(),
  reason: z.string().optional(),
});
export type BookingStateChange = z.infer<typeof BookingStateChange>;

export interface BookingEngine {
  /**
   * Idempotent booking creation: same (tenantId, idempotencyKey) always
   * returns the same booking; a lost race returns the winner's record.
   * MUST verify availability (fail closed) before entering pending_payment.
   */
  createBooking(req: CreateBookingRequest): Promise<BookingRecord>;
  /** Apply a state transition; throws BookingError("ILLEGAL_TRANSITION") if not allowed. */
  transition(bookingId: string, to: BookingState, reason?: string): Promise<BookingRecord>;
}

export const Refund = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  bookingId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: Money,
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Refund = z.infer<typeof Refund>;
