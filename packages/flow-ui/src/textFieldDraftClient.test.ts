import { describe, expect, it, vi } from 'vitest';
import { createTextFieldDraftClient } from './textFieldDraftClient';

const id = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const token = 'private.token.valid';
const definition = { schemaVersion: 1, fields: [{ key: 'notes', kind: 'text', required: false, minLength: 0, maxLength: 100 }] };
const save = { textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: 0, expectedFlowRevision: 1, definition };
const receipt = { textDraftVersion: 1, parentAuthoringVersion: 2, draftRevision: 1, savedParentRevision: 1, currentParentRevision: 2, definition, runtimePublishable: false };
const missing = { status: 'missing', textDraftVersion: 1, parentAuthoringVersion: 2, currentParentRevision: 1, runtimePublishable: false };
function setup(value: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status }));
  return { fetcher, client: createTextFieldDraftClient('https://api.example', false, fetcher) };
}
describe('owner text field draft transport', () => {
  it('reads missing with an untrusted tenant selector and private transport settings', async () => {
    const { client, fetcher } = setup({ ok: true, data: missing });
    expect(await client.read(token, tenantId, id)).toEqual(missing);
    expect(fetcher).toHaveBeenCalledWith('https://api.example/api/text-field-drafts/' + id + '?tenantId=' + tenantId, {
      signal: expect.any(AbortSignal), method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    });
  });
  it('derives present stale state from raw server revision tokens', async () => {
    const { client } = setup({ ok: true, data: { status: 'present', receipt } });
    expect(await client.read(token, tenantId, id)).toEqual({ status: 'present', receipt: { ...receipt, stale: true } });
    const fresh = setup({ ok: true, data: { status: 'present', receipt: { ...receipt, currentParentRevision: 1 } } });
    expect(await fresh.client.read(token, tenantId, id)).toMatchObject({ receipt: { stale: false } });
  });
  it('posts validated save and parses receipt', async () => {
    const { client, fetcher } = setup({ ok: true, data: receipt });
    expect(await client.save(token, tenantId, id, save)).toEqual({ ...receipt, stale: true });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(save) });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.example/api/text-field-drafts/' + id + '?tenantId=' + tenantId);
  });
  it.each([[401, 'UNAUTHENTICATED'], [409, 'CONFLICT'], [403, 'FORBIDDEN']])('maps %s failures without exposing server data', async (status, code) => {
    const { client } = setup({ ok: false, code }, status as number);
    await expect(client.read(token, tenantId, id)).rejects.toMatchObject({ code });
  });
  it('rejects unknown, extra and client-derived fields on responses', async () => {
    for (const data of [{ ...missing, tenantId: id }, { status: 'present', receipt: { ...receipt, stale: false } }, { ...missing, runtimePublishable: true }]) {
      await expect(setup({ ok: true, data }).client.read(token, tenantId, id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    }
    await expect(setup({ ok: false, code: 'UNKNOWN', detail: token }, 400).client.read(token, tenantId, id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(setup({ ok: true, data: missing }, 500).client.read(token, tenantId, id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
  it('rejects unknown save authority and invalid inputs before fetching', async () => {
    const { client, fetcher } = setup({ ok: true, data: receipt });
    for (const input of [undefined, { ...save, tenantId: id }, { ...save, expectedRevision: -1 }]) await expect(client.save(token, tenantId, id, input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.read(token, tenantId, '../other')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    for (const invalid of ['', 'secret\r\nHeader: injected', token + '\n']) await expect(client.read(invalid, tenantId, id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects unsafe base URLs and permits explicitly local harness only', () => {
    for (const base of ['https://api.example/', 'https://user:secret@api.example', 'https://api.example/path', 'http://api.example', 'http://localhost:1234']) expect(() => createTextFieldDraftClient(base)).toThrow();
    expect(() => createTextFieldDraftClient('http://localhost:1234', true)).not.toThrow();
  });
  it('rejects invalid tenant selectors on read and save before fetching', async () => {
    const { client, fetcher } = setup({ ok: true, data: receipt });
    for (const invalid of ['', '../other', tenantId + '&actorId=' + id, tenantId + '\n']) {
      await expect(client.read(token, invalid, id)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(client.save(token, invalid, id, save)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects oversized input without serializing or sending it', async () => {
    const { client, fetcher } = setup({ ok: true, data: receipt });
    const input = { ...save, definition: { schemaVersion: 1, fields: [{ ...definition.fields[0], key: 'x'.repeat(32769) }] } };
    await expect(client.save(token, tenantId, id, input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('caps streamed success and error bodies even without content length, cancelling overflow', async () => {
    for (const status of [200, 400]) {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(32768)); controller.enqueue(new Uint8Array(1)); }, cancel });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status }));
      await expect(createTextFieldDraftClient('https://api.example', false, fetcher).read(token, tenantId, id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(cancel).toHaveBeenCalledOnce();
    }
  });
  it('accepts exactly 32768 response bytes and rejects missing streams, invalid UTF8 and bad JSON', async () => {
    const json = JSON.stringify({ ok: true, data: missing });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(json.padEnd(32768, ' ')));
    expect(await createTextFieldDraftClient('https://api.example', false, fetcher).read(token, tenantId, id)).toEqual(missing);
    for (const response of [new Response(null), new Response(new Uint8Array([255])), new Response(token)]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createTextFieldDraftClient('https://api.example', false, fetcher).read(token, tenantId, id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    }
  });
  it('never includes fetch exception or raw response secrets in errors', async () => {
    for (const fetcher of [vi.fn<typeof fetch>().mockRejectedValue(new Error(token)), vi.fn<typeof fetch>().mockResolvedValue(new Response(token, { status: 500 }))]) {
      const error = await createTextFieldDraftClient('https://api.example', false, fetcher).read(token, tenantId, id).catch(error => error);
      expect(error.message).not.toContain(token); expect(error.stack).not.toContain(token);
      expect(error.code).toBe('INTERNAL_ERROR');
    }
  });
  it('invalidates an in-flight response on account change', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; }));
    const client = createTextFieldDraftClient('https://api.example', false, fetcher);
    const pending = client.read(token, tenantId, id); client.invalidate(); resolve(new Response(JSON.stringify({ ok: true, data: missing })));
    await expect(pending).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('matches server bearer grammar and length boundaries', async () => {
    for (const invalid of ['x'.repeat(15), 'x'.repeat(4097), token + '/', token + '+', token + '=']) {
      const { client, fetcher } = setup({ ok: true, data: missing });
      await expect(client.read(invalid, tenantId, id)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(fetcher).not.toHaveBeenCalled();
    }
    for (const valid of ['a._~-'.padEnd(16, 'x'), 'x'.repeat(4096)]) {
      expect(await setup({ ok: true, data: missing }).client.read(valid, tenantId, id)).toEqual(missing);
    }
  });
  it.each(['invalidate', 'timeout'])('settles stalled fetch on %s, aborts and disposes late response', async mode => {
    vi.useFakeTimers();
    try {
      let resolve!: (response: Response) => void;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; }));
      const client = createTextFieldDraftClient('https://api.example', false, fetcher);
      const result = client.read(token, tenantId, id).catch(error => error);
      if (mode === 'invalidate') client.invalidate(); else await vi.advanceTimersByTimeAsync(15000);
      expect((await result).code).toBe(mode === 'invalidate' ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR');
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      resolve(new Response(new ReadableStream({ cancel })));
      await Promise.resolve(); await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it.each(['invalidate', 'timeout'])('settles stalled stream on %s even if cancellation never settles', async mode => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const client = createTextFieldDraftClient('https://api.example', false, fetcher);
      const result = client.read(token, tenantId, id).catch(error => error);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(response.body?.locked).toBe(true);
      if (mode === 'invalidate') client.invalidate(); else await vi.advanceTimersByTimeAsync(15000);
      expect((await result).code).toBe(mode === 'invalidate' ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR');
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('stops a continuously empty stream by deadline without waiting for timer macrotasks', async () => {
    const clock = vi.spyOn(Date, 'now');
    let reads = 0;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) { reads++; clock.mockReturnValue(reads >= 3 ? 15000 : 0); controller.enqueue(new Uint8Array()); }, cancel }));
    clock.mockReturnValue(0);
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createTextFieldDraftClient('https://api.example', false, fetcher).read(token, tenantId, id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(reads).toBeLessThanOrEqual(4); expect(cancel).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  });
  it('uses one deadline across fetch and stream rather than resetting per stage', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (response: Response) => void;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; }));
      const result = createTextFieldDraftClient('https://api.example', false, fetcher).read(token, tenantId, id).catch(error => error);
      await vi.advanceTimersByTimeAsync(14000);
      const cancel = vi.fn(); resolve(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(1000);
      expect((await result).code).toBe('INTERNAL_ERROR'); expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('rejects promptly when an injected reader ignores cancellation and handles its late rejection', async () => {
    let rejectRead!: (error: Error) => void;
    const reader = { read: vi.fn(() => new Promise((_, reject) => { rejectRead = reject; })), cancel: vi.fn(() => Promise.reject(new Error(token))), releaseLock: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ body: { getReader: () => reader }, ok: true } as unknown as Response);
    const client = createTextFieldDraftClient('https://api.example', false, fetcher);
    const result = client.read(token, tenantId, id).catch(error => error);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(reader.read).toHaveBeenCalledOnce(); client.invalidate();
    expect((await result).code).toBe('UNAUTHENTICATED'); expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    rejectRead(new Error(token)); await Promise.resolve(); await Promise.resolve();
  });
  it('observes late fetch rejection and removes completed requests from invalidation ownership', async () => {
    let reject!: (reason: Error) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((_, failed) => { reject = failed; }));
    const client = createTextFieldDraftClient('https://api.example', false, fetcher);
    const result = client.read(token, tenantId, id).catch(error => error);
    client.invalidate(); expect((await result).code).toBe('UNAUTHENTICATED');
    reject(new Error(token)); await Promise.resolve(); await Promise.resolve();
    const complete = setup({ ok: true, data: missing });
    await complete.client.read(token, tenantId, id); complete.client.invalidate();
    expect(complete.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });
});
