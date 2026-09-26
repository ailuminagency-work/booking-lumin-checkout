import { expect, it, vi } from 'vitest';
import { createTemplateAdoptionClient, TEMPLATE_KEYS } from '../src/templateAdoptionClient';

const tenant = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const token = 'verified-session-token';
const key = 'housekeeping';
const operation = 'retained_key_123456789';
const good = () => new Response(JSON.stringify({ ok: true, data: { serviceId, templateKey: key, active: false } }), { status: 200 });
const setup = (response: Response = good()) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  return { client: createTemplateAdoptionClient('https://api.example.test', false, fetcher), fetcher };
};

it('sends the exact owner mutation without service JSON or browser authority fields', async () => {
  const { client, fetcher } = setup();
  expect(await client.adopt(token, tenant, key, operation)).toEqual({ serviceId, templateKey: key, active: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe(`https://api.example.test/api/service-templates/adopt?tenantId=${tenant}`);
  const options = fetcher.mock.calls[0]?.[1];
  expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  expect(JSON.parse(options!.body as string)).toEqual({ key, idempotencyKey: operation });
});

it('rejects unregistered and inherited keys, weak token, malformed tenant/key before request', async () => {
  const { client, fetcher } = setup();
  for (const bad of ['constructor', 'prototype', '__proto__', 'house-cleaning', 'unknown']) await expect(client.adopt(token, tenant, bad as never, operation)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(client.adopt('short', tenant, key, operation)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(client.adopt(token, 'not-uuid', key, operation)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(client.adopt(token, tenant, key, 'weak')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(fetcher).not.toHaveBeenCalled();
  expect(TEMPLATE_KEYS).toHaveLength(8);
});

it('uses the caller-retained key on explicit retry without any automatic replay', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(good());
  const client = createTemplateAdoptionClient('https://api.example.test', false, fetcher);
  await expect(client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(client.adopt(token, tenant, key, operation)).resolves.toMatchObject({ serviceId });
  expect(fetcher.mock.calls.map(c => JSON.parse(c[1]!.body as string).idempotencyKey)).toEqual([operation, operation]);
});

it('preserves server commit uncertainty and rejects a mismatched reconciliation directive', async () => {
  const uncertain = new Response(JSON.stringify({ ok: false, code: 'COMMIT_UNCERTAIN', reconciliation: 'RETRY_WITH_SAME_KEY_ONLY' }), { status: 503 });
  await expect(setup(uncertain).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'COMMIT_UNCERTAIN' });
  const forged = new Response(JSON.stringify({ ok: false, code: 'COMMIT_UNCERTAIN', reconciliation: 'ROTATE_KEY' }), { status: 503 });
  await expect(setup(forged).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
});

it('classifies exact 503 DEADLINE as a known pre-commit failure without auto-replay', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: 'DEADLINE' }), { status: 503 }));
  const client = createTemplateAdoptionClient('https://api.example.test', false, fetcher);
  await expect(client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'DEADLINE' });
  expect(fetcher).toHaveBeenCalledOnce();
  const mismatch = new Response(JSON.stringify({ ok: false, code: 'DEADLINE' }), { status: 500 });
  await expect(setup(mismatch).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
});

it('accepts only matching status, exact failure envelope and exact inactive receipt', async () => {
  const forbidden = new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), { status: 403 });
  await expect(setup(forbidden).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  for (const response of [
    new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, data: { serviceId, templateKey: key, active: true } }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, data: { serviceId, templateKey: 'car-detailing', active: false } }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, data: { serviceId, templateKey: key, active: false, tenantId: tenant } }), { status: 200 }),
  ]) await expect(setup(response).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
});

it('rejects redirects and response bodies beyond the strict byte ceiling', async () => {
  const redirected = good(); Object.defineProperty(redirected, 'redirected', { value: true });
  await expect(setup(redirected).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  const oversized = new Response(JSON.stringify({ ok: true, data: 'x'.repeat(9000) }), { status: 200 });
  await expect(setup(oversized).client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
});

it('invalidation cancels an in-flight request and disposes a late response', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const client = createTemplateAdoptionClient('https://api.example.test', false, fetcher);
  const pending = client.adopt(token, tenant, key, operation);
  client.invalidate();
  await expect(pending).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel })));
  await Promise.resolve(); await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('bounds a stalled request and does not replay it', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const client = createTemplateAdoptionClient('https://api.example.test', false, fetcher);
    const pending = expect(client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await vi.advanceTimersByTimeAsync(15001);
    await pending;
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('bounds a stalled response body without accepting late bytes or replaying', async () => {
  vi.useFakeTimers();
  try {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 200 }));
    const client = createTemplateAdoptionClient('https://api.example.test', false, fetcher);
    const pending = expect(client.adopt(token, tenant, key, operation)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await vi.advanceTimersByTimeAsync(15001);
    await pending;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(() => controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true })))).toThrow();
  } finally { vi.useRealTimers(); }
});
