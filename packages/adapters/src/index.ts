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
