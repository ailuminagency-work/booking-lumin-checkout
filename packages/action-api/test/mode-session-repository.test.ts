import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Pool as PgPool } from 'pg';
vi.mock('pg', () => ({ Pool: vi.fn() }));
import { createHash } from 'node:crypto';
import { __createModeSessionRepositoryForTests, createLocalModeSessionRepository, type ModeSessionClock, type ModeSessionClient, type ModeSessionPool } from '../server/mode-session-repository';
import { createModeSessionContracts, copySessionValue, SESSION_BOUNDS, sessionMicros, sessionCanonical, sessionResult, sessionIntent } from '../server/mode-session-contracts';
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const profile = { profileVersion: 'local-v1', rendererOrigin: 'https://render.example', apiOrigin: 'https://api.example', portalOrigin: 'https://portal.example', loaderUrl: 'https://render.example/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' };
const request = { installationId: uuid(1), deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: null, expectedVersionId: uuid(2), expectedTargetRevision: 1, expectedPolicyRevision: 1 };
const actor = { mode: 'local_synthetic', userId: uuid(4) }, historyRequest = { tenantId: uuid(3), flowId: null, beforeCreatedAt: null, beforeBookingId: null, limit: 10 };
const render = { versionId: uuid(2), config: { key: 'cleaning', steps: [{ key: 'rooms', questionKey: 'rooms', kind: 'question', required: true }] }, service: { id: uuid(5), name: 'Cleaning', durationMinutes: 60, questions: [{ id: 'rooms', prompt: 'Rooms', kind: 'quantity', required: true, choices: [], minQty: 0, maxQty: 10000 }] } };
const issued = { schemaVersion: 1, sessionId: uuid(6), installationId: uuid(1), mode: 'hosted', deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: null, versionId: uuid(2), targetRevision: 1, policyRevision: 1, issuedAt: '2026-09-10T12:00:00.000000Z', expiresAt: '2026-09-10T12:15:00.000000Z', render };
const accepted = { schemaVersion: 1, reference: 'LMN-' + 'A'.repeat(32), initialState: 'draft', state: 'draft', requestAccepted: true, replayed: false };
const token = Buffer.alloc(32, 7).toString('base64url');
const submitRequest = { token, idempotencyKey: 'request_key_00001', answers: { rooms: { quantity: 2 } }, customer: { name: ' Jane ', email: ' jane@example.test ' }, requestedStart: '2026-09-11T12:00:00.000000Z' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const tick = async () => {
    for (let i = 0; i < 30; i++)
        await Promise.resolve();
};
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
class Clock implements ModeSessionClock {
    now = 0;
    epoch = Date.parse(issued.issuedAt);
    timers = new Map<object, {
        fn: () => void;
        at: number;
    }>();
    monotonic = () => this.now;
    wall = () => this.epoch;
    setTimer = (fn: () => void, ms: number) => { const h = {}; this.timers.set(h, { fn, at: this.now + ms }); return h; };
    clearTimer = (h: unknown) => { this.timers.delete(h as object); };
    advance(ms: number) {
        this.now += ms;
        this.epoch += ms;
        for (const [h, t] of [...this.timers])
            if (t.at <= this.now) {
                this.timers.delete(h);
                t.fn();
            }
    }
}
class Client extends EventEmitter implements ModeSessionClient {
    queries: {
        text: string;
        values?: unknown[];
    }[] = [];
    releases: (Error | undefined)[] = [];
    select: any = issued;
    hook?: (text: string, values?: unknown[]) => any;
    async query(text: string, values?: unknown[]) {
        this.queries.push({ text, values });
        if (this.hook) {
            const result = this.hook(text, values);
            if (result !== undefined)
                return await result;
        }
        return { command: text.startsWith('SELECT') ? 'SELECT' : text.startsWith('SET') ? 'SET' : text.startsWith('BEGIN') ? 'BEGIN' : text, rowCount: text.startsWith('SELECT') ? 1 : null, rows: text.startsWith('SELECT') ? [{ result: this.select }] : [] };
    }
    release(e?: Error) {
        this.releases.push(e);
        if (e)
            this.emit('end');
    }
}
class Pool extends EventEmitter implements ModeSessionPool {
    clients: Client[] = [];
    count = 0;
    connectHook?: () => Promise<Client>;
    async connect() {
        this.count++;
        if (this.connectHook)
            return this.connectHook();
        const c = new Client();
        this.clients.push(c);
        return c;
    }
    end = vi.fn(async () => { });
}
function setup() { const pool = new Pool(), clock = new Clock(); const repo = __createModeSessionRepositoryForTests({ pool, clock, profiles: [profile], entropy: () => Buffer.alloc(32, 7) }); return { pool, clock, repo }; }
async function session(s: ReturnType<typeof setup>) {
    const outcome = await s.repo.issue(request);
    expect(outcome.kind).toBe('committed');
    if (outcome.kind !== 'committed' || outcome.delivery !== 'session')
        throw Error('issue failed');
    return outcome;
}
const contracts = () => createModeSessionContracts([profile]);
describe('strict local session contracts', () => {
    it('accepts known profile and immutable copies', () => { const input = clone(request), c = contracts(), r = c.issue(input); input.expectedTargetRevision = 99; expect(r.expectedTargetRevision).toBe(1); expect(Object.isFrozen(r)).toBe(true); expect(c.issueReceipt(issued, r)).toEqual(issued); });
    it.each([null, undefined, {}, [], new Date(), new Proxy(request, {}), { ...request, extra: 1 }, { ...request, [Symbol()]: 1 }])('rejects malformed issue %s', v => expect(() => contracts().issue(v)).toThrow());
    it('rejects accessors without reading them', () => { let reads = 0; const input = { ...request }; Object.defineProperty(input, 'installationId', { enumerable: true, get() { reads++; return uuid(1); } }); expect(() => contracts().issue(input)).toThrow(); expect(reads).toBe(0); });
    it.each(['https://*.example', 'https://a;.example', 'https://xn--bcher-kva.example', 'https://127.0.0.1', 'https://[::1]', 'https://render.example/'])('rejects unsupported profile origin %s', origin => expect(() => createModeSessionContracts([{ ...profile, rendererOrigin: origin }])).toThrow());
    it('captures registry and rejects request registration', () => { const p = clone(profile), c = createModeSessionContracts([p]); p.profileVersion = 'changed'; expect(c.issue(request)).toEqual(request); expect(() => c.issue({ ...request, deploymentProfileVersion: 'changed' })).toThrow(); });
    it('permits64 profiles and rejects65 before child getters', () => { const profiles = Array.from({ length: 64 }, (_, i) => ({ ...profile, profileVersion: `local-${i}` })); expect(() => createModeSessionContracts(profiles)).not.toThrow(); let called = 0; const excess = Array.from({ length: 65 }, () => ({ get value() { called++; return 1; } })); expect(() => createModeSessionContracts(excess)).toThrow(); expect(called).toBe(0); });
    it.each(['2026-02-30T00:00:00.000000Z', '0000-01-01T00:00:00.000000Z', '2026-09-10T00:00:60.000000Z', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000000+00:00', '2026-09-10T00:00:00.000000Z\n'])('rejects noncanonical timestamp %s', v => expect(() => sessionMicros(v)).toThrow());
    it('retains Gregorian microseconds and low years', () => { expect(sessionMicros('0001-01-01T00:00:00.000001Z') - sessionMicros('0001-01-01T00:00:00.000000Z')).toBe(1n); expect(() => sessionMicros('2000-02-29T00:00:00.000000Z')).not.toThrow(); expect(() => sessionMicros('1900-02-29T00:00:00.000000Z')).toThrow(); });
    it('preserves all maximum astral V1 fields and choice constructor', () => {
        const v = clone(issued), q: any = { id: '😀'.repeat(100), prompt: '😀'.repeat(500), kind: 'single_choice', required: true, choices: [{ id: 'constructor', label: '😀'.repeat(200) }, { id: '😀'.repeat(100), label: 'label' }] };
        v.render.service.name = '😀'.repeat(200);
        v.render.service.questions = [q];
        v.render.config.steps = [{ key: '😀'.repeat(200), questionKey: q.id, kind: 'question', required: true }];
        const iterator = String.prototype[Symbol.iterator];
        let calls = 0;
        String.prototype[Symbol.iterator] = function () { calls++; throw Error('must not call'); };
        try {
            expect(() => contracts().issueReceipt(v, request)).not.toThrow();
            expect(calls).toBe(0);
        }
        finally {
            String.prototype[Symbol.iterator] = iterator;
        }
        v.render.service.name += 'x';
        expect(() => contracts().issueReceipt(v, request)).toThrow();
    });
    it('V2 issue requires no fabricated answers', () => { const v: any = clone(issued); v.render = { ...v.render, renderSchemaVersion: 2, submissionMode: 'unconfirmed_request' }; expect(() => contracts().issueReceipt(v, request)).not.toThrow(); const c = contracts(); expect(() => c.submit({ ...submitRequest, answers: {} }, v)).not.toThrow(); });
    it('uses SQL-owned email syntax and ASCII-only trim', () => { const c = contracts(); const a = c.submit({ ...submitRequest, customer: { name: '  Jane  ', email: ' invalid syntax ' } }, issued as any); expect(a.customer).toEqual({ name: 'Jane', email: 'invalid syntax' }); expect(c.submit({ ...submitRequest, customer: { name: '\tJane\t', email: 'a@b.test' } }, issued as any).customer.name).toBe('\tJane\t'); });
    it('narrow customer and answers limits precede descendant getters', () => { let n = 0; const customer: any = { name: 'x', email: 'a@b.test', extra: { get x() { n++; return 1; } } }; expect(() => contracts().submit({ ...submitRequest, customer }, issued as any)).toThrow(); const choices = Array.from({ length: 51 }, () => ({ get x() { n++; return 1; } })); expect(() => contracts().submit({ ...submitRequest, answers: { rooms: { choiceIds: choices } } }, issued as any)).toThrow(); expect(n).toBe(0); });
    it.each(['token', 'idempotencyKey', 'requestedStart'])('rejects malformed %s', key => expect(() => contracts().submit({ ...submitRequest, [key]: 'x' }, issued as any)).toThrow());
    it('rejects shared references and cycles', () => { const same = { quantity: 1 }; expect(() => copySessionValue({ a: same, b: same }, SESSION_BOUNDS.submit)).toThrow(); const cycle: any = {}; cycle.x = cycle; expect(() => copySessionValue(cycle, SESSION_BOUNDS.submit)).toThrow(); });
    it('checks depth and node boundaries', () => { expect(() => copySessionValue({ a: { b: 1 } }, { depth: 2, nodes: 3, props: 1, array: 0, string: 10, bytes: 100 })).not.toThrow(); expect(() => copySessionValue({ a: { b: 1 } }, { depth: 1, nodes: 3, props: 1, array: 0, string: 10, bytes: 100 })).toThrow(); expect(() => copySessionValue({ a: { b: 1 } }, { depth: 2, nodes: 2, props: 1, array: 0, string: 10, bytes: 100 })).toThrow(); });
    it.each([16384, 131072, 1048576])('checks actual compact UTF8 byte edge %i', cap => { const bounds = { depth: 0, nodes: 1, props: 0, array: 0, string: cap, bytes: cap }; const value = 'é'.repeat((cap - 2) / 2); expect(Buffer.byteLength(JSON.stringify(value))).toBe(cap); expect(copySessionValue(value, bounds)).toBe(value); expect(() => copySessionValue(value + 'x', bounds)).toThrow(); });
    it('rejects scalar surrogates and dense-array tricks', () => { expect(() => copySessionValue('\ud800', SESSION_BOUNDS.issue)).toThrow(); expect(() => copySessionValue([, 1], SESSION_BOUNDS.page)).toThrow(); const arr: any = [1]; arr.extra = 2; expect(() => copySessionValue(arr, SESSION_BOUNDS.page)).toThrow(); });
    it('validates result descriptors without touching getters', () => { let n = 0; expect(() => sessionResult({ get command() { n++; return 'SELECT'; }, rowCount: 1, rows: [{ result: {} }] })).toThrow(); expect(n).toBe(0); expect(() => sessionResult({ command: 'SELECT', rowCount: 1, rows: [{ result: {}, extra: 1 }] })).toThrow(); });
    it('accepts100 history rows and exact descending cursor, denies aliases', () => { const rows = Array.from({ length: 100 }, (_, i) => ({ bookingId: uuid(1000 - i), reference: 'LEGACY', state: 'completed', slotStart: issued.issuedAt, createdAt: issued.issuedAt })); const r = { ...historyRequest, limit: 100 }; const page = { schemaVersion: 1, requests: rows, nextCursor: { createdAt: issued.issuedAt, bookingId: uuid(901) } }; expect(contracts().history(page, r)).toEqual(page); expect(() => contracts().history({ ...page, nextCursor: { ...page.nextCursor, bookingId: uuid(902) } }, r)).toThrow(); expect(() => contracts().history({ ...page, requests: [rows[0], rows[0]] }, r)).toThrow(); });
    it.each([{ ...accepted, replayed: false, state: 'completed' }, { ...accepted, reference: 'LMN-abc' }, { ...accepted, requestAccepted: false }, { ...accepted, extra: 1 }])('rejects invalid submission receipt %s', v => expect(() => contracts().submitReceipt(v)).toThrow());
});
describe('transaction and context ownership', () => {
    it('delivers token only after COMMIT and excludes it from every SQL argument', async () => { const s = setup(), out = await session(s); expect(out.token).toBe(token); const c = s.pool.clients[0]!; expect(c.queries.map(q => q.text)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", "SET LOCAL ROLE service_role", expect.stringContaining('mode_issue_flow_session'), 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT']); expect(JSON.stringify(c.queries)).not.toContain(token); expect(c.queries[5]!.values![1]).toBe(createHash('sha256').update('mode-flow-session:v1:' + token).digest('hex')); expect(Object.keys(out.session)).toEqual([]); expect(Object.getPrototypeOf(out.session)).toBe(null); await s.repo.close(); });
    it('uses SQL email validation and normalized customer parameters', async () => { const s = setup(), issued = await session(s); s.pool.connectHook = async () => { const c = new Client(); c.select = accepted; s.pool.clients.push(c); return c; }; expect((await s.repo.submit(issued.session, { ...submitRequest, customer: { name: ' Jane ', email: ' invalid syntax ' } })).kind).toBe('committed'); const sql = s.pool.clients[1]!.queries.find(q => q.text.startsWith('SELECT'))!; expect(sql.values![5]).toBe('{"email":"invalid syntax","name":"Jane"}'); await s.repo.close(); });
    it('invalid/crossrepo/proxy handles never checkout', async () => {
        const s = setup(), other = setup(), out = await session(s);
        for (const h of [{}, new Proxy(out.session, {}), null])
            expect((await other.repo.submit(h, submitRequest)).kind).toBe('failed');
        expect(other.pool.count).toBe(0);
        await s.repo.close();
        await other.repo.close();
    });
    it('rejects token mismatch and noncanonical trailing bits before checkout', async () => {
        const s = setup(), out = await session(s);
        for (const t of [Buffer.alloc(32, 8).toString('base64url'), token.slice(0, -1) + 'd', token + '='])
            expect(await s.repo.submit(out.session, { ...submitRequest, token: t })).toMatchObject({ kind: 'failed', code: 'INVALID_REQUEST', transaction: 'not_started' });
        expect(s.pool.count).toBe(1);
        await s.repo.close();
    });
    it('keeps unknown issuance speculative identity out of recovery baseline', async () => {
        const s = setup(), gate = deferred<any>();
        let count = 0;
        s.pool.connectHook = async () => {
            const c = new Client();
            c.select = { ...issued, sessionId: uuid(++count + 10) };
            if (count === 1)
                c.hook = t => t === 'COMMIT' ? gate.promise : undefined;
            return c;
        };
        const pending = s.repo.issue(request);
        await tick();
        s.clock.advance(10000);
        const unknown: any = await pending;
        expect(unknown.kind).toBe('unknown_commit');
        const recovered: any = await s.repo.recoverIssue(unknown.attempt);
        expect(recovered.priorIssuance).toBe('unknown');
        expect(recovered.outcome.receipt.sessionId).toBe(uuid(12));
        gate.resolve({ command: 'COMMIT' });
        await tick();
        expect((await s.repo.recoverIssue(unknown.attempt)).outcome).toMatchObject({ kind: 'failed', code: 'INVALID_REQUEST' });
        await s.repo.close();
    });
    it('exact ROLLBACK has known rollback and never delivers a secret', async () => { const s = setup(); s.pool.connectHook = async () => { const c = new Client(); c.hook = t => t === 'COMMIT' ? { command: 'ROLLBACK' } : undefined; return c; }; expect(await s.repo.issue(request)).toEqual({ kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'rolled_back', backendMayStillRun: false }); await s.repo.close(); });
    it('retains unknown submit intent through failed retry and rejects changed intent', async () => { const s = setup(), out = await session(s), gate = deferred<any>(); let n = 0; s.pool.connectHook = async () => { const c = new Client(); c.select = { ...accepted, reference: 'LMN-' + String(++n).repeat(32) }; c.hook = t => t === 'COMMIT' ? (n === 1 ? gate.promise : n === 2 ? { command: 'ROLLBACK' } : undefined) : undefined; return c; }; const first = s.repo.submit(out.session, submitRequest); await tick(); s.clock.advance(10000); expect((await first).kind).toBe('unknown_commit'); expect(await s.repo.submit(out.session, { ...submitRequest, idempotencyKey: 'changed_key_0001' })).toMatchObject({ code: 'CONFLICT', transaction: 'not_started' }); expect(await s.repo.submit(out.session, submitRequest)).toMatchObject({ transaction: 'rolled_back' }); expect(await s.repo.submit(out.session, { ...submitRequest, answers: { rooms: { quantity: 3 } } })).toMatchObject({ code: 'CONFLICT' }); const resolved: any = await s.repo.submit(out.session, submitRequest); expect(resolved.receipt.reference).toBe('LMN-' + '3'.repeat(32)); gate.resolve({ command: 'COMMIT' }); await tick(); const replay: any = await s.repo.submit(out.session, submitRequest); expect(replay).toMatchObject({ kind: 'failed', code: 'INTERNAL_ERROR' }); await s.repo.close(); });
    it('rejects overlapping submit without checkout or queue', async () => { const s = setup(), out = await session(s), gate = deferred<Client>(); s.pool.connectHook = () => gate.promise; const first = s.repo.submit(out.session, submitRequest); await tick(); expect(await s.repo.submit(out.session, submitRequest)).toMatchObject({ code: 'CONTEXT_BUSY', transaction: 'not_started' }); expect(s.pool.count).toBe(2); await s.repo.close(); await first; const c = new Client(); gate.resolve(c); await tick(); expect(c.releases).toHaveLength(1); expect(c.queries).toHaveLength(0); });
    it.each([4000, 10000])('checks rejected checkout after %ims even without timer callback', async (elapsed) => { const s = setup(); s.pool.connectHook = async () => { s.clock.now = elapsed; throw Error('private'); }; expect(await s.repo.issue(request)).toMatchObject({ code: elapsed === 10000 ? 'DEADLINE' : 'ACQUISITION_TIMEOUT', transaction: 'not_started', backendMayStillRun: false }); await s.repo.close(); });
    it('backward wall across calls is globally terminal without new checkout', async () => { const s = setup(); s.pool.connectHook = async () => { throw Error(); }; expect(await s.repo.ownerHistory(actor, historyRequest)).toMatchObject({ code: 'CONNECTION_FAILED' }); s.clock.epoch--; expect(await s.repo.ownerHistory(actor, historyRequest)).toMatchObject({ code: 'CLOCK_UNAVAILABLE' }); s.clock.epoch += 100; expect(await s.repo.issue(request)).toMatchObject({ code: 'CLOCK_UNAVAILABLE' }); expect(s.pool.count).toBe(1); await s.repo.close(); });
    it('post-ACK expiry is known committed withheld, never rollback', async () => {
        const s = setup();
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t === 'COMMIT') {
                    s.clock.epoch = Date.parse(issued.expiresAt);
                    return { command: 'COMMIT' };
                }
            };
            return c;
        };
        expect(await s.repo.issue(request)).toMatchObject({ kind: 'committed', delivery: 'withheld', reason: 'EXPIRED', attempt: null, token: null });
        await s.repo.close();
    });
    it('pre-commit expiry returns no-commit and no token', async () => {
        const s = setup();
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t.startsWith('SELECT'))
                    s.clock.epoch = Date.parse(issued.expiresAt);
            };
            s.pool.clients.push(c);
            return c;
        };
        expect(await s.repo.issue(request)).toMatchObject({ kind: 'failed', code: 'EXPIRED', transaction: 'no_commit_submitted' });
        expect(s.pool.clients[0]!.queries.some(q => q.text === 'COMMIT')).toBe(false);
        await s.repo.close();
    });
    it('owner read has independent completion uncertainty and no context', async () => { const s = setup(), gate = deferred<any>(); s.pool.connectHook = async () => { const c = new Client(); c.select = { schemaVersion: 1, requests: [], nextCursor: null }; c.hook = t => t === 'COMMIT' ? gate.promise : undefined; return c; }; const pending = s.repo.ownerHistory(actor, historyRequest); await tick(); s.clock.advance(10000); expect(await pending).toEqual({ kind: 'completion_uncertain', code: 'READ_COMPLETION_UNCERTAIN', data: null, backendMayStillRun: true }); gate.resolve({ command: 'COMMIT' }); await tick(); await s.repo.close(); });
    it('honors trusted abort without observing reason', async () => { const s = setup(), controller = new AbortController(); Object.defineProperty(controller.signal, 'reason', { get() { throw Error(); } }); controller.abort(); expect(await s.repo.issue(request, { signal: controller.signal })).toMatchObject({ code: 'ABORTED', transaction: 'not_started' }); expect(s.pool.count).toBe(0); await s.repo.close(); });
    it.each([() => Buffer.alloc(31), () => new Uint8Array(32), () => { throw Error('secret'); }])('entropy failures are safe before checkout', async (entropy) => { const pool = new Pool(), clock = new Clock(), repo = __createModeSessionRepositoryForTests({ pool, clock, profiles: [profile], entropy: entropy as any }); expect(await repo.issue(request)).toEqual({ kind: 'failed', code: 'ENTROPY_UNAVAILABLE', transaction: 'not_started', backendMayStillRun: false }); expect(pool.count).toBe(0); await repo.close(); });
    it('capacity reservation prevents reentrant entropy over64', async () => {
        const pool = new Pool(), clock = new Clock();
        let calls = 0;
        const results: Promise<any>[] = [];
        let repo: ReturnType<typeof __createModeSessionRepositoryForTests>;
        repo = __createModeSessionRepositoryForTests({ pool, clock, profiles: [profile], entropy: () => {
                calls++;
                if (calls <= 64)
                    results.push(repo.issue(request));
                return Buffer.alloc(32, 7);
            } });
        results.push(repo.issue(request));
        const all = await Promise.all(results);
        expect(calls).toBe(64);
        expect(all.filter(x => x.code === 'LIMIT_EXCEEDED')).toHaveLength(1);
        expect(all.filter(x => x.kind === 'committed')).toHaveLength(64);
        await repo.close();
    });
    it('one expired context cannot abort unrelated owner read', async () => { const s = setup(), out = await session(s); const expiry = [...s.clock.timers.values()].find(t => t.at === 900000)!; s.clock.now = 100; s.clock.epoch += 100; await session(s); const gate = deferred<any>(); s.pool.connectHook = async () => { const c = new Client(); c.select = { schemaVersion: 1, requests: [], nextCursor: null }; c.hook = t => t === 'COMMIT' ? gate.promise : undefined; return c; }; const owner = s.repo.ownerHistory(actor, historyRequest); await tick(); expiry.fn(); gate.resolve({ command: 'COMMIT' }); expect(await owner).toMatchObject({ kind: 'completed', delivery: 'data' }); expect(await s.repo.submit(out.session, submitRequest)).toMatchObject({ code: 'INVALID_REQUEST' }); await s.repo.close(); });
    it('close is shared and drops contexts without automatic retry', async () => { const s = setup(), out = await session(s); const a = s.repo.close(), b = s.repo.close(); expect(a).toBe(b); await a; expect(await s.repo.submit(out.session, submitRequest)).toMatchObject({ code: 'CLOSED', transaction: 'not_started' }); expect(s.pool.end).toHaveBeenCalledTimes(1); });
});
describe('returned lifecycle defects and boundary controls', () => {
    it('candidate expiry during unknown COMMIT discards attempt without claiming rollback', async () => {
        const s = setup(), gate = deferred<any>(), abort = new AbortController();
        s.pool.connectHook = async () => { const c = new Client(); c.hook = t => t === 'COMMIT' ? gate.promise : undefined; return c; };
        const pending = s.repo.issue(request, { signal: abort.signal });
        await tick();
        s.clock.epoch = Date.parse(issued.expiresAt) + 1;
        abort.abort();
        expect(await pending).toMatchObject({ kind: 'unknown_commit', attempt: null, token: null, receipt: null });
        gate.resolve({ command: 'COMMIT' });
        await tick();
        await s.repo.close();
    });
    it('cleans only the expired busy entry, preserving another session and owner call', async () => {
        const s = setup(), first = await session(s), firstExpiry = [...s.clock.timers.values()].find(t => t.at === 900000)!;
        s.clock.now = 100;
        s.clock.epoch += 100;
        const second = await session(s), submitGate = deferred<any>(), ownerGate = deferred<any>();
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t.includes('mode_submit_flow_request'))
                    return { command: 'SELECT', rowCount: 1, rows: [{ result: accepted }] };
                if (t.includes('mode_owner_request_history'))
                    return { command: 'SELECT', rowCount: 1, rows: [{ result: { schemaVersion: 1, requests: [], nextCursor: null } }] };
                if (t === 'COMMIT')
                    return c.queries.some(q => q.text.includes('mode_owner_request_history')) ? ownerGate.promise : submitGate.promise;
            };
            return c;
        };
        const submitting = s.repo.submit(first.session, submitRequest), owner = s.repo.ownerHistory(actor, historyRequest);
        await tick();
        firstExpiry.fn();
        expect(await submitting).toMatchObject({ kind: 'unknown_commit' });
        ownerGate.resolve({ command: 'COMMIT' });
        expect(await owner).toMatchObject({ kind: 'completed' });
        submitGate.resolve({ command: 'COMMIT' });
        await tick();
        expect(await s.repo.submit(second.session, submitRequest)).toMatchObject({ kind: 'committed' });
        await s.repo.close();
    });
    it('global clock failure disposes two sessions and all active reads irreversibly', async () => {
        const s = setup(), first = await session(s), second = await session(s), gate = deferred<Client>();
        s.pool.connectHook = () => gate.promise;
        const read = s.repo.ownerHistory(actor, historyRequest);
        await tick();
        s.clock.epoch--;
        expect(await s.repo.submit(first.session, submitRequest)).toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
        expect(await read).toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
        s.clock.epoch += 100;
        expect(await s.repo.submit(second.session, submitRequest)).toMatchObject({ code: 'CLOCK_UNAVAILABLE' });
        const c = new Client();
        gate.resolve(c);
        await tick();
        expect(c.releases).toHaveLength(1);
        await s.repo.close();
    });
    it('elapsed validation arms remaining checkout budget, not a new3seconds', async () => {
        const pool = new Pool(), clock = new Clock(), gate = deferred<Client>();
        pool.connectHook = () => gate.promise;
        const repo = __createModeSessionRepositoryForTests({ pool, clock, profiles: [profile], entropy: () => { clock.now = 1000; return Buffer.alloc(32, 7); } });
        const pending = repo.issue(request);
        await tick();
        clock.advance(2000);
        expect(await pending).toMatchObject({ code: 'ACQUISITION_TIMEOUT', transaction: 'not_started' });
        gate.resolve(new Client());
        await tick();
        await repo.close();
    });
    it('pre-BEGIN final guard never claims submitted SQL', async () => {
        const s = setup(), client = new Client();
        let afterConnect = false, count = 0;
        const original = s.clock.monotonic;
        s.clock.monotonic = () => {
            if (afterConnect && ++count === 2)
                s.clock.now = 10000;
            return original();
        };
        s.pool.connectHook = async () => { afterConnect = true; return client; };
        expect(await s.repo.issue(request)).toMatchObject({ code: 'DEADLINE', transaction: 'not_started', backendMayStillRun: false });
        expect(client.queries).toHaveLength(0);
        await s.repo.close();
    });
    it('known committed withheld issuance keeps immutable identity for recovery', async () => {
        const s = setup();
        let count = 0;
        s.pool.connectHook = async () => {
            const c = new Client();
            count++;
            if (count === 1)
                c.hook = t => {
                    if (t === 'COMMIT') {
                        s.clock.now = 10000;
                        return { command: 'COMMIT' };
                    }
                };
            else
                c.select = { ...issued, sessionId: uuid(999) };
            return c;
        };
        const first: any = await s.repo.issue(request);
        expect(first).toMatchObject({ kind: 'committed', delivery: 'withheld', reason: 'DEADLINE' });
        const recovered = await s.repo.recoverIssue(first.attempt);
        expect(recovered.priorIssuance).toBe('known_committed');
        expect(recovered.outcome).toMatchObject({ kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'no_commit_submitted' });
        await s.repo.close();
    });
    it('failed recovery describes only its own rollback and preserves prior unknown label', async () => {
        const s = setup(), gate = deferred<any>();
        let count = 0;
        s.pool.connectHook = async () => { const c = new Client(); const ordinal = ++count; c.hook = t => t === 'COMMIT' ? (ordinal === 1 ? gate.promise : { command: 'ROLLBACK' }) : undefined; return c; };
        const pending = s.repo.issue(request);
        await tick();
        s.clock.advance(10000);
        const first: any = await pending;
        const recovery = await s.repo.recoverIssue(first.attempt);
        expect(recovery).toMatchObject({ priorIssuance: 'unknown', outcome: { kind: 'failed', transaction: 'rolled_back' } });
        gate.resolve({ command: 'COMMIT' });
        await tick();
        expect((await s.repo.recoverIssue(first.attempt)).outcome).toMatchObject({ code: 'INVALID_REQUEST' });
        await s.repo.close();
    });
    it.each([['40P01', 'ignored', 'DEADLOCK'], ['55P03', 'ignored', 'LOCK_TIMEOUT'], ['57014', 'ignored', 'SERVER_TIMEOUT'], ['42501', 'MODE_SESSION_FORBIDDEN', 'FORBIDDEN'], ['22023', 'MODE_SESSION_INVALID', 'INVALID_REQUEST'], ['40001', 'MODE_SESSION_CONFLICT', 'CONFLICT'], ['54000', 'MODE_SESSION_LIMIT', 'LIMIT_EXCEEDED'], ['23505', 'private detail', 'INTERNAL_ERROR']])('classifies safe SQL pair %s/%s', async (code, message, result) => {
        const s = setup();
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t.startsWith('SELECT'))
                    throw { code, message, detail: 'secret' };
            };
            return c;
        };
        const out = await s.repo.issue(request);
        expect(out).toMatchObject({ kind: 'failed', code: result, transaction: 'no_commit_submitted' });
        expect(JSON.stringify(out)).not.toContain('secret');
        await s.repo.close();
    });
    it('SQL error getters are never executed', async () => {
        const s = setup();
        let calls = 0;
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t.startsWith('SELECT'))
                    throw { get code() { calls++; return '42501'; }, get message() { calls++; return 'MODE_SESSION_FORBIDDEN'; } };
            };
            return c;
        };
        expect(await s.repo.issue(request)).toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(calls).toBe(0);
        await s.repo.close();
    });
    it('customer4096 compact byte cap is exercised before normalization', () => { const c = contracts(), base = { name: 'x', email: 'a@b.test' }, space = 4096 - Buffer.byteLength(JSON.stringify(base)); const customer = { ...base, name: ' '.repeat(space) + 'x' }; expect(Buffer.byteLength(JSON.stringify(customer))).toBe(4096); expect(c.submit({ ...submitRequest, customer }, issued as any).customer.name).toBe('x'); expect(() => c.submit({ ...submitRequest, customer: { ...customer, name: ' ' + customer.name } }, issued as any)).toThrow(); });
    it('answers16KiB boundary is enforced independently of wrapper32KiB', () => {
        const answers: any = {};
        for (let i = 0; i < 50; i++)
            answers['q' + i] = { choiceIds: ['a'.repeat(98), 'b'.repeat(98), 'c'.repeat(98)] };
        expect(Buffer.byteLength(JSON.stringify(answers))).toBeLessThan(16384);
        expect(() => contracts().submit({ ...submitRequest, answers }, issued as any)).not.toThrow();
        for (let i = 0; i < 50; i++)
            answers['q' + i].choiceIds.push('d'.repeat(100));
        expect(Buffer.byteLength(JSON.stringify(answers))).toBeGreaterThan(16384);
        expect(Buffer.byteLength(JSON.stringify({ ...submitRequest, answers }))).toBeLessThan(32768);
        expect(() => contracts().submit({ ...submitRequest, answers }, issued as any)).toThrow();
    });
    it('captured canonical serializer is stable during global stringify substitution', () => {
        const original = JSON.stringify;
        JSON.stringify = () => { throw Error('substituted'); };
        try {
            expect(sessionCanonical({ z: [2, 1], a: { b: 1, a: 2 } })).toBe('{"a":{"a":2,"b":1},"z":[2,1]}');
        }
        finally {
            JSON.stringify = original;
        }
    });
    it('explicit local factory rejects real environment overrides before Pool', () => {
        const prior = { ...process.env };
        try {
            Object.assign(process.env, { LOCAL_HARNESS: '1', FLOW_TEST_DISPOSABLE: '1', MODE_SESSIONS_TEST_DISPOSABLE: '1', PGHOST: '127.0.0.1', PGPORT: '55439', PGUSER: 'postgres', PGDATABASE: 'lumin_mode_session_transport_unit', PGPASSWORD: 'real-secret' });
            expect(() => createLocalModeSessionRepository({ profiles: [profile] })).toThrow('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');
        }
        finally {
            for (const key of Object.keys(process.env))
                if (!(key in prior))
                    delete process.env[key];
            Object.assign(process.env, prior);
        }
    });
});
describe('last observed delivery boundary', () => {
    it.each(['issue', 'submit'] as const)('withholds%s when final settlement sample observes expiry', async (method) => {
        const s = setup();
        const prior = method === 'submit' ? await session(s) : null;
        let afterAck = false, samples = 0;
        const original = s.clock.wall;
        s.clock.wall = () => {
            if (afterAck && ++samples === 2)
                s.clock.epoch = Date.parse(issued.expiresAt);
            return original();
        };
        s.pool.connectHook = async () => {
            const c = new Client();
            c.select = method === 'issue' ? issued : accepted;
            c.hook = t => {
                if (t === 'COMMIT') {
                    afterAck = true;
                    return { command: 'COMMIT' };
                }
            };
            return c;
        };
        const out: any = method === 'issue' ? await s.repo.issue(request) : await s.repo.submit(prior!.session, submitRequest);
        expect(samples).toBe(2);
        expect(out).toMatchObject({ kind: 'committed', delivery: 'withheld', reason: 'EXPIRED', receipt: null });
        expect(out.token).not.toBe(token);
        if (method === 'issue')
            expect(out.attempt).toBe(null);
        await s.repo.close();
    });
    it('withholds on final sampled caller deadline', async () => {
        const s = setup();
        let afterAck = false, samples = 0;
        const original = s.clock.monotonic;
        s.clock.monotonic = () => {
            if (afterAck && ++samples === 2)
                s.clock.now = 10000;
            return original();
        };
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t === 'COMMIT') {
                    afterAck = true;
                    return { command: 'COMMIT' };
                }
            };
            return c;
        };
        expect(await s.repo.issue(request)).toMatchObject({ kind: 'committed', delivery: 'withheld', reason: 'DEADLINE', token: null });
        await s.repo.close();
    });
});
describe('mandatory phase and configured-budget matrix', () => {
    const phases = ['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", "SET LOCAL ROLE service_role", 'SELECT', 'SET CONSTRAINTS ALL IMMEDIATE', 'COMMIT'];
    for (const reason of ['ABORTED', 'DEADLINE'] as const)
        it.each(phases)(reason + ' at awaited%s preserves submission certainty', async (phase) => {
            const s = setup(), gate = deferred<any>(), controller = new AbortController();
            const c = new Client();
            c.hook = t => (phase === 'SELECT' ? t.startsWith('SELECT') : t === phase) ? gate.promise : undefined;
            s.pool.connectHook = async () => c;
            const pending = s.repo.issue(request, { signal: controller.signal });
            await tick();
            if (reason === 'ABORTED')
                controller.abort();
            else
                s.clock.advance(10000);
            const out = await pending;
            expect(out).toMatchObject(phase === 'COMMIT' ? { kind: 'unknown_commit', token: null } : { kind: 'failed', code: reason, transaction: 'no_commit_submitted', backendMayStillRun: true });
            const before = c.queries.length;
            gate.resolve({ command: phase === 'SELECT' ? 'SELECT' : phase.startsWith('SET') ? 'SET' : phase.startsWith('BEGIN') ? 'BEGIN' : 'COMMIT', rowCount: 1, rows: [{ result: issued }] });
            await tick();
            expect(c.queries).toHaveLength(before);
            expect(c.releases).toHaveLength(1);
            await s.repo.close();
        });
    it('rejected SQL continuation samples deadline before domain error', async () => {
        const s = setup();
        s.pool.connectHook = async () => {
            const c = new Client();
            c.hook = t => {
                if (t.startsWith('SELECT')) {
                    s.clock.now = 10000;
                    throw { code: '42501', message: 'MODE_SESSION_FORBIDDEN' };
                }
            };
            return c;
        };
        expect(await s.repo.issue(request)).toMatchObject({ code: 'DEADLINE', transaction: 'no_commit_submitted' });
        await s.repo.close();
    });
    it.each(['monotonic', 'wall', 'setTimer', 'clearTimer'] as const)('throwing%s permanently closes global lifecycle', async (method) => { const s = setup(); const old = s.clock[method]; (s.clock as any)[method] = () => { throw Error('private'); }; expect(await s.repo.ownerHistory(actor, historyRequest)).toMatchObject({ code: 'CLOCK_UNAVAILABLE' }); (s.clock as any)[method] = old; expect(await s.repo.issue(request)).toMatchObject({ code: 'CLOCK_UNAVAILABLE', transaction: 'not_started' }); await s.repo.close(); });
    it('owner read final sample observes caller deadline as completed withheld', async () => {
        const s = setup();
        let after = false, count = 0;
        const original = s.clock.monotonic;
        s.clock.monotonic = () => {
            if (after && ++count === 2)
                s.clock.now = 10000;
            return original();
        };
        s.pool.connectHook = async () => {
            const c = new Client();
            c.select = { schemaVersion: 1, requests: [], nextCursor: null };
            c.hook = t => {
                if (t === 'COMMIT') {
                    after = true;
                    return { command: 'COMMIT' };
                }
            };
            return c;
        };
        expect(await s.repo.ownerHistory(actor, historyRequest)).toMatchObject({ kind: 'completed', delivery: 'withheld', reason: 'DEADLINE', data: null });
        await s.repo.close();
    });
    it('configured pending tuple65536 byte boundary has exact positive and negative', () => { const base = ['h', 'r', null, 'k', '', '{}', 't']; const extra = 65536 - Buffer.byteLength(JSON.stringify(base)); const tuple = [...base]; tuple[4] = 'x'.repeat(extra); expect(Buffer.byteLength(JSON.stringify(tuple))).toBe(65536); expect(sessionIntent(tuple).tuple).toEqual(tuple); tuple[4] += 'x'; expect(() => sessionIntent(tuple)).toThrow(); });
    it('node10000 boundary accepts exactly10000 and rejects10001 before further traversal', () => { const input = Array.from({ length: 99 }, () => Array.from({ length: 100 }, () => 0)); const bounds = { depth: 2, nodes: 10000, props: 0, array: 100, string: 0, bytes: 100000 }; expect(copySessionValue(input, bounds)).toEqual(input); const tooMany = [...input, []]; expect(() => copySessionValue(tooMany, bounds)).toThrow(); });
    it('configured depth10 has positive boundary and negative11', () => {
        let v: any = 1;
        for (let i = 0; i < 10; i++)
            v = { a: v };
        expect(() => copySessionValue(v, SESSION_BOUNDS.issueResult)).not.toThrow();
        expect(() => copySessionValue({ a: v }, SESSION_BOUNDS.issueResult)).toThrow();
    });
    it('full issue render budget permits30000 nodes and rejects30001 in malformed controlled trees', () => { const b = { ...SESSION_BOUNDS.issueResult, array: 30000, bytes: 1048576 }; expect(copySessionValue(Array(29999).fill(0), b)).toHaveLength(29999); expect(() => copySessionValue(Array(30000).fill(0), b)).toThrow(); });
    it('close falls back to bounded native10s drain even with unusable injected timer', async () => { const s = setup(); s.pool.end = vi.fn(() => new Promise<void>(() => { })); s.clock.setTimer = () => { throw Error(); }; const started = Date.now(); await s.repo.close(); expect(Date.now() - started).toBeGreaterThanOrEqual(9900); expect(s.pool.end).toHaveBeenCalledTimes(1); }, 15000);
});
describe('fixed synthetic factory password boundary', () => {
    function env() {
        for (const [key, value] of Object.entries({ LOCAL_HARNESS: '1', FLOW_TEST_DISPOSABLE: '1', MODE_SESSIONS_TEST_DISPOSABLE: '1', PGHOST: '127.0.0.1', PGPORT: '55439', PGUSER: 'postgres', PGDATABASE: 'lumin_mode_session_transport_unit', PGPASSWORD: '', DATABASE_URL: '', PGHOSTADDR: '', PGSERVICE: '', PGSERVICEFILE: '', PGPASSFILE: '', PGOPTIONS: '' }))
            vi.stubEnv(key, value);
    }
    it('actual installed pg callback bypasses configured and default pgpass, with positive fallback control', async () => {
        env();
        const real = await vi.importActual<typeof import('pg')>('pg'), require = createRequire(import.meta.url), path = require.resolve('pgpass'), old = require.cache[path];
        let calls = 0;
        require.cache[path] = { id: path, filename: path, loaded: true, exports: (_config: unknown, cb: (v: string) => void) => { calls++; cb('synthetic-stub-only'); } } as any;
        const password = async (client: any) => new Promise<void>((resolve, reject) => { client.once('error', reject); client._getPassword(resolve); });
        try {
            for (const configured of [false, true]) {
                vi.stubEnv('PGPASSWORD', '');
                vi.stubEnv('PGPASSFILE', configured ? 'synthetic-unused-path' : '');
                const control = new real.Client({ host: '127.0.0.1', user: 'postgres', database: 'lumin_mode_session_transport_unit', password: '' }), before = calls;
                await password(control);
                expect(calls).toBe(before + 1);
                for (const value of ['', 'postgres']) {
                    env();
                    vi.stubEnv('PGPASSWORD', value);
                    const fake = new Pool();
                    vi.mocked(PgPool).mockImplementation(function () { return fake as any; });
                    const repo = createLocalModeSessionRepository({ profiles: [profile] }), config = vi.mocked(PgPool).mock.calls.at(-1)![0] as any;
                    expect(typeof config.password).toBe('function');
                    expect(config).toMatchObject({ ssl: false, pipeline: false, max: 2, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, query_timeout: 0, application_name: 'mode-session-local-transport' });
                    vi.stubEnv('PGPASSWORD', 'later-ignored');
                    vi.stubEnv('PGPASSFILE', configured ? 'synthetic-unused-path' : '');
                    const client = new real.Client(config), prior = calls;
                    await password(client);
                    await password(client);
                    expect(calls).toBe(prior);
                    expect((client as any).password).toBe(value);
                    await repo.close();
                }
            }
        }
        finally {
            if (old)
                require.cache[path] = old;
            else
                delete require.cache[path];
            vi.unstubAllEnvs();
        }
    });
    it.each([['PGPASSWORD', 'real-secret'], ['PGPASSFILE', 'file'], ['PGHOST', 'example.com'], ['PGPORT', '05432'], ['PGDATABASE', 'production'], ['PGUSER', 'other'], ['LOCAL_HARNESS', '0'], ['FLOW_TEST_DISPOSABLE', '0'], ['MODE_SESSIONS_TEST_DISPOSABLE', '0'], ['DATABASE_URL', 'postgres://example']])('rejects%s without constructing Pool', (key, value) => {
        env();
        try {
            vi.stubEnv(key, value);
            const before = vi.mocked(PgPool).mock.calls.length;
            expect(() => createLocalModeSessionRepository()).toThrow('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');
            expect(vi.mocked(PgPool).mock.calls.length).toBe(before);
        }
        finally {
            vi.unstubAllEnvs();
        }
    });
});
it('static exported bound records cannot be changed by a server importer', () => { for (const bound of Object.values(SESSION_BOUNDS))
    expect(Object.isFrozen(bound)).toBe(true); const before = SESSION_BOUNDS.issue.string; expect(() => { (SESSION_BOUNDS.issue as any).string = 999999; }).toThrow(); expect(SESSION_BOUNDS.issue.string).toBe(before); expect(() => copySessionValue('x'.repeat(301), SESSION_BOUNDS.issue)).toThrow(); });
