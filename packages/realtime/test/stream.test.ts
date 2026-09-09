import { describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "@lumin/contracts";
import { createMockTenantStream } from "../src/index";

const event = (patch: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "event-1", tenantId: "tenant-a", name: "booking.confirmed",
  at: "2026-09-08T12:00:00.000Z", data: { bookingRef: "test-booking" }, ...patch,
});

describe("mock tenant stream", () => {
  it("rejects cross-tenant subscription and publication before a handler sees data", async () => {
    const stream = createMockTenantStream("tenant-a");
    const handler = vi.fn();
    stream.subscribe("tenant-a", handler);
    expect(() => stream.subscribe("tenant-b", handler)).toThrow("TENANT_MISMATCH");
    await expect(stream.publish(event({ tenantId: "tenant-b" }))).rejects.toThrow("TENANT_MISMATCH");
    await expect(stream.publish(event({ tenantId: null }))).rejects.toThrow("TENANT_MISMATCH");
    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates failure and retries only unacknowledged consumers", async () => {
    const stream = createMockTenantStream("tenant-a");
    const healthy = vi.fn();
    const flaky = vi.fn().mockRejectedValueOnce(new Error("private detail")).mockResolvedValue(undefined);
    stream.subscribe("tenant-a", healthy);
    stream.subscribe("tenant-a", flaky);
    expect(await stream.publish(event())).toEqual({ delivered: 1, pending: 1 });
    expect(await stream.publish(event())).toEqual({ delivered: 2, pending: 0 });
    expect(await stream.publish(event())).toEqual({ delivered: 2, pending: 0 });
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent publication while a consumer is running", async () => {
    const stream = createMockTenantStream("tenant-a");
    let finish!: () => void;
    const pause = new Promise<void>((resolve) => { finish = resolve; });
    const handler = vi.fn(() => pause);
    stream.subscribe("tenant-a", handler);
    const first = stream.publish(event());
    const second = stream.publish(event());
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    finish();
    expect(await Promise.all([first, second])).toEqual([
      { delivered: 1, pending: 0 }, { delivered: 1, pending: 0 },
    ]);
  });

  it("uses an immutable original audience and idempotent unsubscribe", async () => {
    const stream = createMockTenantStream("tenant-a");
    const failed = vi.fn(() => { throw new Error("offline"); });
    const unsubscribe = stream.subscribe("tenant-a", failed);
    await stream.publish(event());
    unsubscribe(); unsubscribe();
    const late = vi.fn();
    stream.subscribe("tenant-a", late);
    expect(await stream.publish(event())).toEqual({ delivered: 0, pending: 0 });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    await stream.publish(event({ id: "event-2" }));
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("takes independent snapshots and detects mutated content under the same ID", async () => {
    const stream = createMockTenantStream("tenant-a");
    const seen: unknown[] = [];
    stream.subscribe("tenant-a", (received) => { received.data.bookingRef = "mutated"; });
    stream.subscribe("tenant-a", (received) => { seen.push(received.data.bookingRef); });
    const original = event();
    const pending = stream.publish(original);
    original.data.bookingRef = "caller mutation";
    await pending;
    expect(seen).toEqual(["test-booking"]);
    await expect(stream.publish(original)).rejects.toThrow("EVENT_ID_CONFLICT");
  });

  it("treats differently ordered JSON keys as the same event", async () => {
    const stream = createMockTenantStream("tenant-a");
    const handler = vi.fn();
    stream.subscribe("tenant-a", handler);
    await stream.publish(event({ data: { a: 1, b: 2 } }));
    await stream.publish(event({ data: { b: 2, a: 1 } }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed, excessive and cyclic data without consuming the event ID", async () => {
    const stream = createMockTenantStream("tenant-a");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const invalid of [event({ at: "invalid" }), event({ data: { n: NaN } }),
      event({ data: cycle }), event({ data: { text: "x".repeat(65_536) } })]) {
      await expect(stream.publish(invalid)).rejects.toThrow();
    }
    expect(await stream.publish(event())).toEqual({ delivered: 0, pending: 0 });
  });

  it("enforces capacity without evicting successful deduplication history", async () => {
    const stream = createMockTenantStream("tenant-a", { maxEvents: 1, maxSubscribers: 1 });
    const handler = vi.fn();
    stream.subscribe("tenant-a", handler);
    expect(() => stream.subscribe("tenant-a", handler)).toThrow("SUBSCRIBER_LIMIT");
    await stream.publish(event());
    await expect(stream.publish(event({ id: "event-2" }))).rejects.toThrow("EVENT_LIMIT");
    await stream.publish(event());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never evaluates payload accessors and rejects sparse or oversized arrays", async () => {
    const stream = createMockTenantStream("tenant-a");
    const getter = vi.fn(() => "sensitive");
    const object = Object.defineProperty({}, "secret", { enumerable: true, get: getter });
    const array = Object.defineProperty(["placeholder"], "0", { enumerable: true, get: getter });
    for (const data of [object, { array }, { array: new Array(2) }, { array: new Array(10_001) }]) {
      await expect(stream.publish(event({ data }))).rejects.toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
