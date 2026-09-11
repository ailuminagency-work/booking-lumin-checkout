import { describe, it, expect, vi, afterEach } from 'vitest';
import { request as httpRequest } from 'node:http';
import { __createModeOwnerHttpServerForTests, type ModeOwnerHttpTestOptions } from '../server/mode-owner-http';
import type { ModeOwnerComposition } from '../server/mode-owner-composition';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, token = 'synthetic-owner-token', origin = 'http://127.0.0.1:5174', prefix = '/api/local/mode-owner/';
const publish = { tenantId: id(2), flowId: id(3), expectedDraftRevision: 1, idempotencyKey: 'idempotency-key-001' };
const receipt = { schemaVersion: 1, actorId: id(1), flowId: id(3), operation: 'publish', versionId: id(4), sourceRevision: 1, renderSchemaVersion: 1 };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0))
    await close(); });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
async function setup(hooks: Partial<ModeOwnerHttpTestOptions> = {}) {
    let now = 0;
    const owner: any = { publish: vi.fn(async () => ({ kind: 'committed', delivery: 'receipt', receipt })), install: vi.fn(), applyVersion: vi.fn(), updatePolicy: vi.fn(), ownerInstallations: vi.fn(async () => ({ kind: 'completed', delivery: 'data', data: { installations: [], nextCursor: null } })), ownerHistory: vi.fn(async () => ({ kind: 'completed', delivery: 'data', data: { history: [], nextCursor: null } })), ownerOperation: vi.fn(async () => ({ kind: 'completed', delivery: 'data', data: receipt })), requestHistory: vi.fn(async () => ({ kind: 'completed', delivery: 'data', data: { schemaVersion: 1, requests: [], nextCursor: null } })) };
    const composition: any = { owner, profiles: [], profile: null, localOwnerApi: 'http://127.0.0.1:8788', localDraftApi: 'http://127.0.0.1:8789', localPortalOrigin: origin, authenticateOwner: vi.fn(async (t: string) => t === token ? id(1) : null), draftRepository: { call: vi.fn() }, close: vi.fn(async () => { }) };
    const control = __createModeOwnerHttpServerForTests({ composition, now: () => now, ...hooks });
    await new Promise<void>(r => control.server.listen(0, '127.0.0.1', r));
    const port = (control.server.address() as any).port;
    baseSetter();
    function baseSetter() { composition.localOwnerApi = 'http://127.0.0.1:' + port; }
    const close = async () => { control.stopAdmission(); control.server.closeAllConnections(); await new Promise<void>(r => control.server.close(() => r())); };
    cleanups.push(close);
    const call = async (path = 'publish', body: unknown = publish, options: {
        method?: string;
        headers?: Record<string, string>;
        raw?: string;
    } = {}) => { const method = options.method ?? 'POST', raw = options.raw ?? JSON.stringify(body); const response = await fetch(composition.localOwnerApi + prefix + path, { method, headers: { Origin: origin, Authorization: 'Bearer ' + token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, ...(method === 'POST' ? { body: raw } : {}) }); return { status: response.status, headers: response.headers, body: await response.json() }; };
    return { owner, composition, control, call, setNow: (n: number) => { now = n; }, port };
}
function raw(port: number, headers: string[], path = prefix + 'publish', payload = JSON.stringify(publish), method = 'POST'): Promise<{
    status: number;
    body: any;
}> { return new Promise(resolve => { const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, res => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => { let body: any; try {
    body = JSON.parse(Buffer.concat(chunks).toString());
}
catch { } resolve({ status: res.statusCode ?? 0, body }); }); }); req.on('error', () => resolve({ status: 0, body: null })); req.end(payload); }); }
describe('exact owner HTTP boundary', () => {
    it('dispatches bound actor and returns only validated phase result', async () => { const s = await setup(), r = await s.call(); expect(r.status).toBe(200); expect(r.body).toEqual({ schemaVersion: 1, phase: 'repository_result', outcome: { kind: 'committed', delivery: 'receipt', receipt } }); expect(s.owner.publish).toHaveBeenCalledWith({ mode: 'local_synthetic', userId: id(1) }, publish, { signal: expect.any(AbortSignal) }); expect(r.headers.get('cache-control')).toBe('no-store'); expect(r.headers.get('access-control-allow-origin')).toBe(origin); });
    it('profile is fixed nonoperational projection, no repository lookup', async () => { const s = await setup(), r = await s.call('profile', {}, { method: 'GET' }); expect(r.body).toEqual({ schemaVersion: 1, profile: null, deliveryEnabled: false }); expect(s.owner.publish).not.toHaveBeenCalled(); expect(s.owner.requestHistory).not.toHaveBeenCalled(); });
    it.each(['publish/', 'publish?tenantId=x', 'publ%69sh', '/publish', 'publicPolicy', 'public-policy'])('rejects target%s without dispatch', async (path) => { const s = await setup(), r = await s.call(path); expect(r.status).toBeGreaterThanOrEqual(400); expect(r.body.phase).toBe('not_dispatched'); expect(s.owner.publish).not.toHaveBeenCalled(); });
    it.each([{ Origin: 'null' }, { Origin: 'https://foreign.example' }, { Authorization: 'Bearer short' }, { Authorization: 'Basic x' }, { 'Content-Type': 'text/plain' }, { Cookie: 'x=y' }, { 'Content-Encoding': 'gzip' }])('rejects hostile header%s without dispatch', async (headers) => { const s = await setup(), r = await s.call('publish', publish, { headers: Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }); expect(r.status).toBeGreaterThanOrEqual(400); expect(r.body.phase).toBe('not_dispatched'); expect(s.owner.publish).not.toHaveBeenCalled(); });
    it('rejects missing Origin/auth and duplicate raw headers', async () => { const s = await setup(), payload = JSON.stringify(publish), base = ['Host', '127.0.0.1:' + s.port, 'Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(payload))]; for (const h of [[...base, 'Authorization', 'Bearer ' + token], [...base, 'Origin', origin], [...base, 'Origin', origin, 'Origin', origin, 'Authorization', 'Bearer ' + token], [...base, 'Origin', origin, 'Authorization', 'Bearer ' + token, 'Authorization', 'Bearer ' + token]]) {
        const r = await raw(s.port, h);
        expect(r.status === 0 || r.status >= 400).toBe(true);
    } expect(s.owner.publish).not.toHaveBeenCalled(); });
    it('preflight has exact method/headers, no credential value and no repository call', async () => { const s = await setup(); const r = await fetch(s.composition.localOwnerApi + prefix + 'publish', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type, Authorization' } }); expect(r.status).toBe(204); expect(r.headers.get('cache-control')).toBe('no-store'); expect(s.composition.authenticateOwner).not.toHaveBeenCalled(); expect(s.owner.publish).not.toHaveBeenCalled(); const bad = await fetch(s.composition.localOwnerApi + prefix + 'publish', { method: 'OPTIONS', headers: { Origin: origin, Authorization: 'Bearer ' + token, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type, Authorization' } }); expect(bad.status).toBe(400); });
    it('GET cannot mutate and profile cannot POST', async () => { const s = await setup(); expect((await s.call('publish', {}, { method: 'GET' })).status).toBe(405); expect((await s.call('profile')).status).toBe(405); expect(s.owner.publish).not.toHaveBeenCalled(); });
    it('rejects duplicate JSON keys, extra actor and oversized bytes', async () => { const s = await setup(); for (const raw of ['{"tenantId":"' + id(2) + '","tenantId":"' + id(9) + '"}', JSON.stringify({ ...publish, actorId: id(9) }), ' '.repeat(16385)]) {
        const r = await s.call('publish', publish, { raw });
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.body.phase).toBe('not_dispatched');
    } expect(s.owner.publish).not.toHaveBeenCalled(); });
    it('serializes a genuine typed failure without changing transaction semantics', async () => { const s = await setup(); s.owner.publish.mockResolvedValue({ kind: 'failed', code: 'CONFLICT', transaction: 'no_commit_submitted', backendMayStillRun: true }); const r = await s.call(); expect(r.status).toBe(409); expect(r.body.phase).toBe('repository_result'); expect(r.body.outcome.code).toBe('CONFLICT'); });
    it.each(['throw', 'overflow', 'invalidreceipt', 'syncdispatch'])('postdispatch%s can never emit not_dispatched', async (mode) => { const s = await setup({ serialize: mode === 'throw' ? () => { throw Error('secret'); } : mode === 'overflow' ? () => 'x'.repeat(1048577) : JSON.stringify }); if (mode === 'invalidreceipt')
        s.owner.publish.mockResolvedValue({ kind: 'committed', delivery: 'receipt', receipt: { ...receipt, actorId: id(9) } }); if (mode === 'syncdispatch')
        s.owner.publish.mockImplementation(() => { throw Error('private'); }); const r = await s.call(); expect(r.status).toBe(202); expect(r.body).toEqual({ schemaVersion: 1, phase: 'delivery_uncertain', operationKind: 'mutation', code: 'OUTCOME_UNAVAILABLE' }); expect(JSON.stringify(r.body)).not.toMatch(/secret|private/); });
    it('postdispatch read serialization error never becomes an empty page', async () => { const s = await setup({ serialize: () => { throw Error(); } }), r = await s.call('request-history', { tenantId: id(2), flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 }); expect(r.body).toEqual({ schemaVersion: 1, phase: 'delivery_uncertain', operationKind: 'read', code: 'OUTCOME_UNAVAILABLE' }); });
    it('header status alone cannot imply rollback; unknown union stays unknown', async () => { const s = await setup(); s.owner.publish.mockResolvedValue({ kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', receipt: null, reconciliation: 'EXPLICIT_OWNER_OPERATION' }); const r = await s.call(); expect(r.status).toBe(202); expect(r.body.outcome.kind).toBe('unknown_commit'); });
    it('response loss shutdown after real invocation retains dispatch phase', async () => { const gate = deferred<void>(), entered = deferred<void>(), s = await setup({ afterRepository: () => { entered.resolve(); return gate.promise; } }); const pending = s.call(); await entered.promise; s.control.stopAdmission(); const r = await pending; expect(r.body.phase).toBe('delivery_uncertain'); gate.resolve(); });
    it('clock backward permanently closes admission before next dispatch', async () => { const s = await setup(); s.setNow(100); await s.call('profile', {}, { method: 'GET' }); s.setNow(99); const fail = await s.call(); expect(fail.status).toBe(503); s.setNow(101); expect((await s.call()).status).toBe(503); expect(s.owner.publish).not.toHaveBeenCalled(); });
    it('newly sampled final wire deadline yields uncertainty after dispatch', async () => { let now = 0; const s = await setup({ now: () => now, afterRepository: () => { now = 15000; } }); const r = await s.call(); expect(r.body.phase).toBe('delivery_uncertain'); });
    it('mutation rate30 never evicts active window, resets only after60seconds', async () => { const s = await setup(); for (let i = 0; i < 30; i++)
        expect((await s.call()).status).toBe(200); const denied = await s.call(); expect(denied.status).toBe(429); expect(denied.headers.get('retry-after')).toBe('60'); expect(s.owner.publish).toHaveBeenCalledTimes(30); s.setNow(60000); expect((await s.call()).status).toBe(200); });
    it('ingress120 counts unauthenticated attempts and returns bounded retry', async () => { const s = await setup(); for (let i = 0; i < 120; i++)
        expect((await s.call('profile', {}, { method: 'GET', headers: { Authorization: 'Bearer bad' } })).status).toBe(401); expect((await s.call('profile', {}, { method: 'GET' })).status).toBe(429); });
    it('duplicate mutation and rejected scope admission do not release another request count', async () => { const gate = deferred<any>(), entered = deferred<void>(), s = await setup(); s.owner.publish.mockImplementation(() => { entered.resolve(); return gate.promise; }); const first = s.call(); await entered.promise; expect((await s.call()).status).toBe(429); expect((await s.call()).status).toBe(429); expect(s.owner.publish).toHaveBeenCalledTimes(1); gate.resolve({ kind: 'committed', delivery: 'receipt', receipt }); expect((await first).status).toBe(200); });
    it('request history uses actual states and exact cursor without legacy draft-only validator', async () => { const s = await setup(); s.owner.requestHistory.mockResolvedValue({ kind: 'completed', delivery: 'data', data: { schemaVersion: 1, requests: [{ bookingId: id(5), reference: 'LEGACY', state: 'completed', slotStart: '2026-09-10T12:00:00.000001Z', createdAt: '2026-09-10T12:00:00.000002Z' }], nextCursor: null } }); const r = await s.call('request-history', { tenantId: id(2), flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 100 }); expect(r.status).toBe(200); expect(r.body.outcome.data.requests[0].state).toBe('completed'); });
});

describe('admission and transport resource boundaries',()=>{
 it('global16 active requests reject17 without dispatch and release after settlement',async()=>{const gate=deferred<void>(),entered=deferred<void>();let count=0;const s=await setup({afterRepository:()=>{if(++count===16)entered.resolve();return gate.promise;}});const body=(n:number)=>({tenantId:id(100+n),flowId:null,beforeCreatedAt:null,beforeBookingId:null,limit:100});const calls=Array.from({length:16},(_,i)=>s.call('request-history',body(i)));await entered.promise;expect((await s.call('request-history',body(20))).status).toBe(429);expect(s.owner.requestHistory).toHaveBeenCalledTimes(16);gate.resolve();expect((await Promise.all(calls)).every(r=>r.status===200)).toBe(true);expect((await s.call('request-history',body(21))).status).toBe(200);});
 it('per-scope2 active reads reject excess without decrementing existing counts',async()=>{const gate=deferred<void>(),entered=deferred<void>();let count=0;const s=await setup({afterRepository:()=>{if(++count===2)entered.resolve();return gate.promise;}});const body={tenantId:id(2),flowId:null,beforeCreatedAt:null,beforeBookingId:null,limit:100};const calls=[s.call('request-history',body),s.call('request-history',body)];await entered.promise;expect((await s.call('request-history',body)).status).toBe(429);expect((await s.call('request-history',body)).status).toBe(429);expect(s.owner.requestHistory).toHaveBeenCalledTimes(2);gate.resolve();await Promise.all(calls);});
 it('body timeout is bounded and occurs before repository dispatch',async()=>{const s=await setup(),start=Date.now();const result=await new Promise<number>(resolve=>{const req=httpRequest({host:'127.0.0.1',port:s.port,method:'POST',path:prefix+'publish',headers:{Host:'127.0.0.1:'+s.port,Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':'1000'}},res=>{res.resume();res.on('end',()=>{resolve(res.statusCode??0);req.destroy();});});req.on('error',()=>resolve(0));req.write('{');});expect(result).toBe(504);expect(Date.now()-start).toBeLessThan(4000);expect(s.owner.publish).not.toHaveBeenCalled();},5000);
 it('authentication timeout consumes late result without dispatch or second response',async()=>{const gate=deferred<string|null>(),s=await setup();s.composition.authenticateOwner=()=>gate.promise;const r=await s.call();expect(r.status).toBe(401);expect(r.body.phase).toBe('not_dispatched');gate.resolve(id(1));await Promise.resolve();expect(s.owner.publish).not.toHaveBeenCalled();});
 it('post-dispatch bad result getters are never executed',async()=>{let reads=0;const s=await setup();s.owner.publish.mockResolvedValue({get kind(){reads++;return'committed';}});const r=await s.call();expect(r.body.phase).toBe('delivery_uncertain');expect(reads).toBe(0);});
 it('unsafe wrong-method failure code becomes uncertainty, not invented failure',async()=>{const s=await setup();s.owner.publish.mockResolvedValue({kind:'failed',code:'NOT_FOUND',transaction:'not_started',backendMayStillRun:false});expect((await s.call()).body.phase).toBe('delivery_uncertain');});
 it('request body exact16KiB is parsed;16KiB+1 denied before parsing',async()=>{const s=await setup(),valid=JSON.stringify(publish),padded=valid+' '.repeat(16384-Buffer.byteLength(valid));expect((await s.call('publish',publish,{raw:padded})).status).toBe(200);const oversized=await s.call('publish',publish,{raw:padded+' '});expect(oversized.status).toBe(413);expect(s.owner.publish).toHaveBeenCalledTimes(1);});
});

it('terminal clock failure settles another admitted authentication wait without dispatch', async () => {
    const entered = deferred<void>(), auth = deferred<string | null>();
    const s = await setup();
    s.setNow(10);
    s.composition.authenticateOwner.mockImplementationOnce(() => { entered.resolve(); return auth.promise; });
    const first = s.call();
    await entered.promise;
    s.setNow(9);
    const second = await s.call();
    expect(second.status).toBe(503);
    s.setNow(11);
    auth.resolve(id(1));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([first, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 500); })]);
    clearTimeout(timer);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(503);
    expect(result?.body.phase).toBe('not_dispatched');
    expect(s.owner.publish).not.toHaveBeenCalled();
    void first.catch(() => {});
});

it('classifies a trailing-slash target as malformed while an unknown canonical target is not found', async () => {
 const s=await setup();
 const malformed=await s.call('publish/');
 expect(malformed.status).toBe(400);
 expect(malformed.body.error.code).toBe('INVALID_HTTP');
 const unknown=await s.call('unknown');
 expect(unknown.status).toBe(404);
 expect(unknown.body.error.code).toBe('NOT_FOUND');
 expect(s.owner.publish).not.toHaveBeenCalled();
 const valid=await s.call();expect(valid.status).toBe(200);
});
