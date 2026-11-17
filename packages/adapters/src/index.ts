/**
 * @lumin/adapters — mock-first integration adapters (SI-12).
 * Every integration starts NOT CONNECTED; these mocks make the entire
 * platform operable with zero external credentials.
 */
export { createMockPaymentProvider, signMockWebhook, mockHash } from "./mockPayment";
export type { MockPaymentProvider, MockPaymentProviderOptions } from "./mockPayment";
export { createMockPaymentConnectionProvider } from "./mockPaymentConnection";
export type {
  MockAccountFacts,
  MockPaymentConnectionProvider,
  MockPaymentConnectionProviderOptions,
} from "./mockPaymentConnection";
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

// Real Stripe CONNECT adapter (P1 step 4). Behind the separate
// PaymentConnectionProvider contract: it resolves WHICH connected account a
// charge is later created on, and moves no money itself.
export { createStripeConnectProvider, mapStripeAccountReason } from "./stripePaymentConnection";
export type { StripeConnectProvider, StripeConnectProviderOptions } from "./stripePaymentConnection";
