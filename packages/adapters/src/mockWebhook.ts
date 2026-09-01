import { WebhookDeliveryInput, WebhookProvider } from "@lumin/contracts";

export interface MockWebhookProvider extends WebhookProvider {
  /** Make every subsequent delivery report "failed" (or succeed again). */
  setFailing(failing: boolean): void;
  /** Inspection: all delivery attempts, in order. */
  deliveries(): (WebhookDeliveryInput & { deliveryId: string; status: "delivered" | "failed" })[];
}

export function createMockWebhookProvider(): MockWebhookProvider {
  const attempts: (WebhookDeliveryInput & { deliveryId: string; status: "delivered" | "failed" })[] = [];
  let failing = false;
  let counter = 0;

  return {
    providerName: "mock-webhook",

    async deliver(input: WebhookDeliveryInput): Promise<{ deliveryId: string; status: "delivered" | "failed" }> {
      counter += 1;
      const deliveryId = `mwd_${counter}`;
      const status = failing ? "failed" : "delivered";
      attempts.push({ ...input, deliveryId, status });
      return { deliveryId, status };
    },

    setFailing(value: boolean) {
      failing = value;
    },

    deliveries() {
      return attempts.map((a) => ({ ...a }));
    },
  };
}
