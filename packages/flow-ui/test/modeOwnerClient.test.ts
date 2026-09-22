import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModeOwnerClient } from '../src/modeOwnerClient';
const tenant = '11111111-1111-4111-8111-111111111111', flow = '22222222-2222-4222-8222-222222222222';
const body = { tenantId: tenant, flowId: flow, expectedDraftRevision: 1, idempotencyKey: '33333333-3333-4333-8333-333333333333' };
const token = 'synthetic-owner-credential';
const success = { schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'committed', delivery: 'receipt', receipt: { schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'publish', versionId: tenant, sourceRevision: 1, renderSchemaVersion: 1 } } };
afterEach(() => vi.useRealTimers());
it('uses only fixed loopback endpoints and nonambient credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(success)));
    const c = createModeOwnerClient('http://127.0.0.1:8787', fetcher);
    expect((await c.call('publish', token, body)).phase).toBe('repository_result');
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/api/local/mode-owner/publish', expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' }));
    for (const url of ['https://remote.example', 'http://localhost:8787', 'http://127.0.0.1:80', 'http://127.0.0.1:8787/path'])
        expect(() => createModeOwnerClient(url, fetcher)).toThrow();
});
it.each([500, 504, 413])('does not infer rollback from HTTP %i', async (status) => { const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response('truncated', { status })); expect(await c.call('publish', token, body)).toEqual({ phase: 'delivery_uncertain', operationKind: 'mutation', code: 'OUTCOME_UNAVAILABLE' }); });
it('preserves exact typed known rollback and authenticated not-dispatched shapes', async () => {
    const values = [{ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'failed', transaction: 'rolled_back', code: 'CONFLICT', backendMayStillRun: false } }, { schemaVersion: 1, phase: 'not_dispatched', error: { code: 'FORBIDDEN' } }];
    for (const value of values) {
        const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify(value)));
        expect(await c.call('publish', token, body)).toMatchObject(value);
    }
});
it.each(['fetch', 'read', 'cancel'])('bounds nonsettling %s at the original deadline', async (kind) => {
    vi.useFakeTimers();
    let cancelled = 0;
    const never = new Promise<never>(() => { });
    const fetcher = vi.fn(async () => {
        if (kind === 'fetch')
            return never;
        return new Response(new ReadableStream<Uint8Array>({ start(controller) {
                if (kind === 'cancel')
                    controller.enqueue(new Uint8Array(1048577));
            }, cancel() { cancelled++; return never; } }));
    });
    const c = createModeOwnerClient('http://127.0.0.1:8787', fetcher);
    const promise = c.call('publish', token, body);
    await vi.advanceTimersByTimeAsync(16000);
    expect((await promise).phase).toBe('delivery_uncertain');
    if (kind === 'cancel')
        expect(cancelled).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
});
it('invalidation bounds stalled operations and late success cannot deliver data', async () => { let resolve!: (r: Response) => void; const c = createModeOwnerClient('http://127.0.0.1:8787', () => new Promise(r => resolve = r)); const pending = c.call('publish', token, body); c.invalidate(); expect((await pending).phase).toBe('delivery_uncertain'); resolve(new Response(JSON.stringify(success))); await Promise.resolve(); });
it('rejects unexpected fields, wrong union, malformed UTF8 and complete envelope overflow', async () => {
    for (const value of [{ ...success, extra: true }, { ...success, outcome: { kind: 'completed', delivery: 'data', data: {} } }, new Uint8Array([255]), 'x'.repeat(1048577)]) {
        const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(value instanceof Uint8Array ? value : typeof value === 'string' ? value : JSON.stringify(value)));
        expect((await c.call('publish', token, body)).phase).toBe('delivery_uncertain');
    }
});
it('read loss remains read uncertainty, never a fabricated empty page', async () => { const c = createModeOwnerClient('http://127.0.0.1:8787', async () => { throw Error('private driver detail'); }); expect(await c.call('request-history', token, { tenantId: tenant, flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 })).toEqual({ phase: 'delivery_uncertain', operationKind: 'read', code: 'OUTCOME_UNAVAILABLE' }); });
it('rejects a valid-shaped receipt for another flow or stale source revision', async () => {
    for (const change of [{ flowId: tenant }, { sourceRevision: 2 }, { operation: 'install' }]) {
        const value = { ...success, outcome: { ...success.outcome, receipt: { ...success.outcome.receipt, ...change } } };
        const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify(value)));
        expect((await c.call('publish', token, body)).phase).toBe('delivery_uncertain');
    }
});
it('rejects a duplicated/out-of-order owner page and mismatched next cursor', async () => {
    const row = { installationId: tenant, flowId: flow, mode: 'hosted', deploymentProfileVersion: 'local-owner', currentVersionId: tenant, targetRevision: 1, policyRevision: 1, enabled: true, allowedParentOrigins: [] };
    for (const data of [{ installations: [row, row], nextCursor: null }, { installations: [row], nextCursor: flow }]) {
        const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'completed', delivery: 'data', data } })));
        expect((await c.call('installations', token, { tenantId: tenant, flowId: flow, afterId: null, limit: 1 })).phase).toBe('delivery_uncertain');
    }
});
it('serialization exhausting total budget cannot start fetch before timer delivery', async () => { const now = vi.spyOn(performance, 'now').mockReturnValue(0); const fetcher = vi.fn(async () => new Response(JSON.stringify(success))); const c = createModeOwnerClient('http://127.0.0.1:8787', fetcher); const request = { ...body, toJSON() { now.mockReturnValue(16000); return body; } }; expect((await c.call('publish', token, request)).phase).toBe('delivery_uncertain'); expect(fetcher).not.toHaveBeenCalled(); now.mockRestore(); });
it('tiny and empty chunks use the bounded byte path and preserve exact receipt', async () => { const encoded = new TextEncoder().encode(JSON.stringify(success)); let index = 0, empty = true; const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (empty) {
        controller.enqueue(new Uint8Array(0));
        empty = false;
        return;
    } if (index === encoded.length) {
        controller.close();
        return;
    } controller.enqueue(encoded.slice(index, index + 1)); index++; empty = true; } }); const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(stream)); expect((await c.call('publish', token, body)).phase).toBe('repository_result'); });
it.each(['not_started', 'rolled_back', 'no_commit_submitted'])('contradictory backend flag for %s is uncertain', async (transaction) => { const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'failed', code: 'CONFLICT', transaction, backendMayStillRun: transaction !== 'no_commit_submitted' } }))); expect((await c.call('publish', token, body)).phase).toBe('delivery_uncertain'); });
it('method-incompatible failure codes are uncertain, neighboring valid sets retain failure', async () => { for (const [method, code, valid] of [['publish', 'NOT_FOUND', false], ['publish', 'UNAVAILABLE', true], ['request-history', 'UNSUPPORTED', false], ['request-history', 'UNAVAILABLE', false], ['request-history', 'NOT_FOUND', true]] as const) {
    const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'failed', code, transaction: 'rolled_back', backendMayStillRun: false } })));
    const r = method === 'publish' ? await c.call(method, token, body) : await c.call(method, token, { tenantId: tenant, flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 });
    expect(r.phase).toBe(valid ? 'repository_result' : 'delivery_uncertain');
} });
it('strict profile projection rejects malformed topology without contacting profile URLs', async () => { const valid = { profileVersion: 'local-owner', rendererOrigin: 'https://renderer.example', apiOrigin: 'https://api.example', portalOrigin: 'https://portal.example', loaderUrl: 'https://renderer.example/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' }; for (const profile of [valid, { ...valid, rendererOrigin: 'http://renderer.example' }, { ...valid, portalOrigin: valid.apiOrigin }, { ...valid, loaderUrl: 'https://renderer.example/loader.js' }, { ...valid, apiOrigin: 'https://xn--a.example' }]) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, profile, deliveryEnabled: false })));
    const c = createModeOwnerClient('http://127.0.0.1:8787', fetcher);
    if (profile === valid)
        expect((await c.profile(token)).profile).toEqual(valid);
    else
        await expect(c.profile(token)).rejects.toThrow('Read outcome unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.length).toBe(1);
} });
it('strict history rejects impossible calendars and retains exact valid microseconds', async () => { for (const [time, valid] of [['0000-01-01T00:00:00.000001Z', false], ['2026-02-30T00:00:00.000001Z', false], ['2026-01-01T24:00:00.000001Z', false], ['2024-02-29T23:59:59.123456Z', true], ['0001-01-01T00:00:00.000001Z', true]] as const) {
    const data = { schemaVersion: 1, requests: [{ bookingId: tenant, reference: 'LEGACY', state: 'completed', slotStart: time, createdAt: time }], nextCursor: null };
    const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'completed', delivery: 'data', data } })));
    expect((await c.call('request-history', token, { tenantId: tenant, flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 })).phase).toBe(valid ? 'repository_result' : 'delivery_uncertain');
} });
it('recovered apply and initial history must satisfy intrinsic state equations', async () => { for (const [changed, previous, current, valid] of [[true, tenant, tenant, false], [false, tenant, flow, false], [false, tenant, tenant, true]] as const) {
    const data = { schemaVersion: 1, actorId: tenant, flowId: flow, operation: 'apply', installationId: tenant, previousVersionId: previous, currentVersionId: current, targetRevision: 1, policyRevision: 1, changed };
    const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'completed', delivery: 'data', data } })));
    expect((await c.call('operation', token, { tenantId: tenant, flowId: flow, operation: 'apply', idempotencyKey: body.idempotencyKey })).phase).toBe(valid ? 'repository_result' : 'delivery_uncertain');
} for (const enabled of [true, false]) {
    const data = { history: [{ sequence: 1, operation: 'install', currentVersionId: tenant, targetRevision: 1, policyRevision: 1, enabled, allowedParentOrigins: [] }], nextCursor: null };
    const c = createModeOwnerClient('http://127.0.0.1:8787', async () => new Response(JSON.stringify({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'completed', delivery: 'data', data } })));
    expect((await c.call('installation-history', token, { tenantId: tenant, flowId: flow, installationId: tenant, beforeSequence: null, limit: 100 })).phase).toBe(enabled ? 'repository_result' : 'delivery_uncertain');
} });
