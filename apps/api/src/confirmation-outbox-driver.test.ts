import {it, expect, vi} from 'vitest';
import {createConfirmationOutboxDriver, type DeliverableTenant} from './confirmation-outbox-driver';

const CONN = '99999999-9999-4999-8999-999999999999';
const UA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const T = (tenantId: string): DeliverableTenant => ({tenantId, connectionId: CONN, provider: 'staging-mock'});

it('single-flights overlapping drains', async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {open = resolve;});
  const discoverTenants = vi.fn(async () => {await gate; return [T(UA)];});
  const drainTenant = vi.fn(async () => {});
  const driver = createConfirmationOutboxDriver({discoverTenants, drainTenant, intervalMs: 10_000});

  const first = driver.drainOnce();
  const second = driver.drainOnce();
  open();
  const [a, b] = await Promise.all([first, second]);

  expect(discoverTenants).toHaveBeenCalledTimes(1);
  expect(a).toBe(1);
  expect(b).toBe(1);
});

it('isolates per-tenant failures and still drains the rest', async () => {
  const discoverTenants = vi.fn(async () => [T(UA), T(UB), T(UC)]);
  const drainTenant = vi.fn(async (tenant: DeliverableTenant) => {
    if (tenant.tenantId === UB) throw new Error('boom');
  });
  const driver = createConfirmationOutboxDriver({discoverTenants, drainTenant, intervalMs: 10_000});

  expect(await driver.drainOnce()).toBe(2);
  expect(drainTenant).toHaveBeenCalledTimes(3);
});

it('skips rows with an invalid identity', async () => {
  const bad: DeliverableTenant = {tenantId: 'not-a-uuid', connectionId: CONN, provider: 'staging-mock'};
  const blankProvider: DeliverableTenant = {tenantId: UB, connectionId: CONN, provider: '   '};
  const good = T(UA);
  const discoverTenants = vi.fn(async () => [bad, blankProvider, good]);
  const drainTenant = vi.fn(async () => {});
  const driver = createConfirmationOutboxDriver({discoverTenants, drainTenant, intervalMs: 10_000});

  expect(await driver.drainOnce()).toBe(1);
  expect(drainTenant).toHaveBeenCalledTimes(1);
  expect(drainTenant).toHaveBeenCalledWith(good);
});

it('returns 0 and drains nothing when discovery fails', async () => {
  const discoverTenants = vi.fn(async () => {throw new Error('db down');});
  const drainTenant = vi.fn(async () => {});
  const driver = createConfirmationOutboxDriver({discoverTenants, drainTenant, intervalMs: 10_000});

  expect(await driver.drainOnce()).toBe(0);
  expect(drainTenant).not.toHaveBeenCalled();
});

it('start schedules periodic ticks and stop halts them', async () => {
  vi.useFakeTimers();
  try {
    const discoverTenants = vi.fn(async () => []);
    const driver = createConfirmationOutboxDriver({discoverTenants, drainTenant: async () => {}, intervalMs: 1000});
    driver.start();
    driver.start(); // idempotent

    await vi.advanceTimersByTimeAsync(3500);
    const ticks = discoverTenants.mock.calls.length;
    expect(ticks).toBeGreaterThanOrEqual(3);

    await driver.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(discoverTenants.mock.calls.length).toBe(ticks);
  } finally {
    vi.useRealTimers();
  }
});
