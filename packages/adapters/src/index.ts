/**
 * @lumin/adapters — mock-first integration adapters (SI-12).
 * Every integration starts NOT CONNECTED; these mocks make the entire
 * platform operable with zero external credentials.
 */
export { createMockPaymentProvider, signMockWebhook, mockHash } from "./mockPayment";
export type { MockPaymentProvider, MockPaymentProviderOptions } from "./mockPayment";
export { createMockCalendarProvider } from "./mockCalendar";
export type { MockCalendarProvider } from "./mockCalendar";
export { createMockNotificationProvider } from "./mockNotification";
export type { MockNotificationProvider } from "./mockNotification";
export { createMockWebhookProvider } from "./mockWebhook";
export type { MockWebhookProvider } from "./mockWebhook";

// Real Stripe TEST-mode adapter (RC-3). Server-side only — the secret key is
// never bundled to the browser; all Stripe calls originate in the edge
// functions / trusted runtime. Behind the same PaymentProvider contract.
export { createStripePaymentProvider, signStripeTestWebhook, interpretRefundEvent } from "./stripePayment";
export type { StripePaymentProviderOptions, RefundOutcome } from "./stripePayment";
