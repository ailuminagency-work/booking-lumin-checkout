import { EVENT_NAMES, type AuditEvent } from "@lumin/contracts";

export interface DeliveryResult {
  /** Cumulative successful acknowledgements for this event's original audience. */
  delivered: number;
  /** Original subscribers whose handlers failed and can be retried. */
  pending: number;
}

export interface MockStreamOptions {
  /** Lifetime event limit; full streams reject new IDs instead of losing deduplication. */
  maxEvents?: number;
  maxSubscribers?: number;
}

type Handler = (event: AuditEvent) => void | Promise<void>;
interface StoredEvent {
  event: AuditEvent;
  fingerprint: string;
  pending: Set<number>;
  delivered: number;
  inFlight?: Promise<DeliveryResult>;
}

/** Canonical JSON snapshot: reject unsupported values instead of silently dropping them. */
function snapshot(value: unknown, depth = 0, budget = { left: 10_000 }): unknown {
  if (depth > 20 || --budget.left < 0) throw new Error("EVENT_DATA_LIMIT");
  if (typeof value === "string" && value.length > 65_536) throw new Error("EVENT_DATA_LIMIT");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new Error("INVALID_EVENT_DATA");
  if (Array.isArray(value)) {
    if (value.length > budget.left) throw new Error("EVENT_DATA_LIMIT");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new Error("INVALID_EVENT_DATA");
      result.push(snapshot(descriptor.value, depth + 1, budget));
    }
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("INVALID_EVENT_DATA");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) throw new Error("INVALID_EVENT_DATA");
    result[key] = snapshot(descriptor.value, depth + 1, budget);
  }
  return result;
}

/**
 * Credential-free, process-local delivery harness. Tenant equality is a test
 * boundary, NOT authentication. No transport, persistence, or booking authority.
 */
export function createMockTenantStream(tenantId: string, options: MockStreamOptions = {}) {
  if (!tenantId.trim()) throw new Error("INVALID_TENANT");
  const maxEvents = options.maxEvents ?? 1_000;
  const maxSubscribers = options.maxSubscribers ?? 100;
  for (const limit of [maxEvents, maxSubscribers]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("INVALID_LIMIT");
  }
  const subscribers = new Map<number, Handler>();
  const events = new Map<string, StoredEvent>();
  let nextSubscriber = 0;

  function subscribe(scope: string, handler: Handler): () => void {
    if (scope !== tenantId) throw new Error("TENANT_MISMATCH");
    if (typeof handler !== "function") throw new Error("INVALID_HANDLER");
    if (subscribers.size >= maxSubscribers) throw new Error("SUBSCRIBER_LIMIT");
    const id = ++nextSubscriber;
    subscribers.set(id, handler);
    return () => {
      subscribers.delete(id);
      for (const stored of events.values()) stored.pending.delete(id);
    };
  }

  async function publish(input: AuditEvent): Promise<DeliveryResult> {
    if (input.tenantId !== tenantId) throw new Error("TENANT_MISMATCH");
    if (!input.id?.trim() || !EVENT_NAMES.includes(input.name) || !Number.isFinite(Date.parse(input.at))) {
      throw new Error("INVALID_EVENT");
    }
    if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
      throw new Error("INVALID_EVENT_DATA");
    }
    const event: AuditEvent = {
      id: input.id, tenantId, name: input.name, at: input.at,
      data: snapshot(input.data) as Record<string, unknown>,
    };
    const fingerprint = JSON.stringify(event);
    if (fingerprint.length > 65_536) throw new Error("EVENT_DATA_LIMIT");
    let stored = events.get(event.id);
    if (stored && stored.fingerprint !== fingerprint) throw new Error("EVENT_ID_CONFLICT");
    if (!stored) {
      if (events.size >= maxEvents) throw new Error("EVENT_LIMIT");
      stored = { event, fingerprint, pending: new Set(subscribers.keys()), delivered: 0 };
      events.set(event.id, stored);
    }
    if (stored.inFlight) return stored.inFlight;
    const current = stored;
    // Start on the next microtask so concurrent publishers see the same in-flight attempt.
    current.inFlight = Promise.resolve().then(async () => {
      await Promise.all([...current.pending].map(async (id) => {
        const handler = subscribers.get(id);
        if (!handler) { current.pending.delete(id); return; }
        try {
          // Each subscriber gets its own snapshot; mutation cannot affect other deliveries.
          await handler(JSON.parse(current.fingerprint) as AuditEvent);
          current.pending.delete(id);
          current.delivered++;
        } catch {
          // One failed consumer cannot undo another acknowledgement or affect a booking.
          // Error messages are deliberately not retained: they may contain sensitive data.
        }
      }));
      return { delivered: current.delivered, pending: current.pending.size };
    });
    try { return await current.inFlight; }
    finally { current.inFlight = undefined; }
  }

  return { subscribe, publish };
}
