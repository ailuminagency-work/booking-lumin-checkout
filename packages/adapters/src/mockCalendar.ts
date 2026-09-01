import { CalendarEventInput, CalendarProvider } from "@lumin/contracts";

export interface MockCalendarProvider extends CalendarProvider {
  /** Inspection: events currently on the calendar. */
  listEvents(): (CalendarEventInput & { eventId: string })[];
  /** Inspection: ids of deleted events, in deletion order. */
  deletedEventIds(): string[];
}

export function createMockCalendarProvider(): MockCalendarProvider {
  const events = new Map<string, CalendarEventInput & { eventId: string }>();
  const deleted: string[] = [];
  let counter = 0;

  return {
    providerName: "mock-calendar",

    async createEvent(input: CalendarEventInput): Promise<{ eventId: string }> {
      counter += 1;
      const eventId = `mev_${counter}`;
      events.set(eventId, { ...input, eventId });
      return { eventId };
    },

    async deleteEvent(tenantId: string, eventId: string): Promise<void> {
      const event = events.get(eventId);
      if (event && event.tenantId === tenantId) {
        events.delete(eventId);
        deleted.push(eventId);
      }
    },

    listEvents() {
      return [...events.values()].map((e) => ({ ...e }));
    },

    deletedEventIds() {
      return [...deleted];
    },
  };
}
