import type {ConfirmationDeliveryProvider} from './confirmation-outbox-worker.js';

/**
 * Staging-only confirmation delivery provider.
 *
 * Acknowledges every send as delivered WITHOUT contacting any external email or
 * SMS provider and WITHOUT retaining any state. It exists so the staging
 * outbox -> durable receipt pipeline can be exercised end to end (the outbox
 * drains to `completed` and `confirmation_delivery_receipts` populate) using NO
 * real provider credentials. The durable, idempotency-fenced per-channel
 * receipt is written by the queue (`recordDelivered`), never here, so this
 * provider is intentionally stateless and side-effect free.
 *
 * It MUST NEVER run in production: a real deployment would silently mark
 * confirmations delivered without sending them. `main.ts` constructs it only
 * under the `BOOKING_LUMIN_ENV==='staging'` gate.
 */
export function createStagingConfirmationDeliveryProvider(): ConfirmationDeliveryProvider {
  return {
    async send(): Promise<{kind: 'sent'}> {
      return {kind: 'sent'};
    },
  };
}
