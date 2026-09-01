/**
 * ErrorContract v1
 *
 * Typed, code-first errors shared platform-wide. API responses serialize as
 * { error: { code, message } } — messages are safe for display and NEVER
 * contain secrets, tokens, or another tenant's data.
 */

export const ERROR_CODES = [
  // validation / configuration
  "INVALID_SELECTION",
  "INVALID_REQUEST",
  "SERVICE_NOT_FOUND",
  "SERVICE_INACTIVE",
  // availability
  "SLOT_UNAVAILABLE",
  "AVAILABILITY_UNVERIFIABLE", // fail-closed marker
  "OUTSIDE_BOOKING_HORIZON",
  "LEAD_TIME_VIOLATION",
  // booking
  "ILLEGAL_TRANSITION",
  "BOOKING_NOT_FOUND",
  "DUPLICATE_BOOKING",
  // payment
  "PAYMENT_FAILED",
  "PAYMENT_AMOUNT_MISMATCH",
  "WEBHOOK_UNVERIFIED",
  "PROVIDER_UNAVAILABLE",
  // auth / tenancy
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "TENANT_MISMATCH",
  // integrations
  "INTEGRATION_NOT_CONNECTED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class LuminError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "LuminError";
  }
}

export class PricingError extends LuminError {}
export class AvailabilityError extends LuminError {}
export class BookingError extends LuminError {}
export class PaymentError extends LuminError {}
export class TenancyError extends LuminError {}
