import { NotificationInput, NotificationProvider } from "@lumin/contracts";

export interface MockNotificationProvider extends NotificationProvider {
  /** Inspection: everything sent, in order. */
  sentMessages(): (NotificationInput & { messageId: string })[];
}

export function createMockNotificationProvider(): MockNotificationProvider {
  const sent: (NotificationInput & { messageId: string })[] = [];
  let counter = 0;

  return {
    providerName: "mock-notification",

    async send(input: NotificationInput): Promise<{ messageId: string }> {
      counter += 1;
      const messageId = `mmsg_${counter}`;
      sent.push({ ...input, messageId });
      return { messageId };
    },

    sentMessages() {
      return sent.map((s) => ({ ...s }));
    },
  };
}
