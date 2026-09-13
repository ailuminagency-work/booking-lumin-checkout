import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createModeSessionDeliveryCoordinator as create, DELIVERY_BOUNDS, type ModeSessionDeliveryCoordinator } from '../server/mode-session-delivery';
import { createModeSessionContracts } from '../server/mode-session-contracts';
import type { ModeSessionClock } from '../server/mode-session-repository';
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const profile = { profileVersion: 'local-v1', rendererOrigin: 'https://render.example', apiOrigin: 'https://api.example', portalOrigin: 'https://portal.example', loaderUrl: 'https://render.example/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js' };
const request = { installationId: uuid(1), deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: null, expectedVersionId: uuid(2), expectedTargetRevision: 1, expectedPolicyRevision: 1 };
const render = { versionId: uuid(2), config: { key: 'cleaning', steps: [{ key: 'rooms', questionKey: 'rooms', kind: 'question', required: true }] }, service: { id: uuid(5), name: 'Cleaning', durationMinutes: 60, questions: [{ id: 'rooms', prompt: 'Rooms', kind: 'quantity', required: true, choices: [], minQty: 0, maxQty: 10000 }] } };
const receipt = { schemaVersion: 1, sessionId: uuid(6), installationId: uuid(1), mode: 'hosted', deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, parentOrigin: null, versionId: uuid(2), targetRevision: 1, policyRevision: 1, issuedAt: '2026-09-10T12:00:00.000000Z', expiresAt: '2026-09-10T12:15:00.000000Z', render };
const token = Buffer.alloc(32, 200).toString('base64url');
const session = Object.freeze({}), attempt = Object.freeze({});
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const success = (value: unknown = clone(receipt)) => ({ kind: 'committed', delivery: 'session', token, session, receipt: value });
const failure = { kind: 'failed', code: 'FORBIDDEN', transaction: 'no_commit_submitted', backendMayStillRun: true };
const unknown = (value: unknown = attempt) => ({ kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', token: null, receipt: null, attempt: value, reconciliation: 'EXPLICIT_SAME_ATTEMPT' });
const withheld = (value: unknown = attempt) => ({ kind: 'committed', delivery: 'withheld', token: null, receipt: null, reason: 'ABORTED', attempt: value });
const deferred = <T>() => {
    let resolve!: (x: T) => void, reject!: (x: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
const tick = async () => {
    for (let i = 0; i < 30; i++)
        await Promise.resolve();
};
class Clock implements ModeSessionClock {
    now = 0;
    epoch = Date.parse(receipt.issuedAt);
    timers = new Map<object, {
        fn: () => void;
        at: number;
    }>();
    monoHook?: () => void;
    wallHook?: () => void;
    setHook?: () => void;
    clearHook?: () => void;
    monotonic = () => {
        this.monoHook?.();
        return this.now;
    };
    wall = () => {
        this.wallHook?.();
        return this.epoch;
    };
    setTimer = (fn: () => void, ms: number) => {
        const h = {};
        this.timers.set(h, { fn, at: this.now + ms });
        this.setHook?.();
        return h;
    };
    clearTimer = (h: unknown) => {
        this.timers.delete(h as object);
        this.clearHook?.();
    };
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
function setup(configure?: (s: any) => void) {
    const clock = new Clock();
    let sequence = 0;
    const repository = { issue: vi.fn(async () => success()), recoverIssue: vi.fn(async () => ({ priorIssuance: 'unknown', outcome: success() })) };
    const validator = { validateExisting: vi.fn(async () => ({ kind: 'completed', delivery: 'data', data: clone(receipt) })) };
    const entropy = vi.fn(() => Buffer.alloc(32, ++sequence));
    const s = { clock, repository, validator, entropy };
    configure?.(s);
    const coordinator = create({ ...s, profiles: [profile] } as any);
    return { ...s, coordinator, prepare: (raw: unknown = request) => {
            const out = coordinator.prepare(raw);
            expect(out.kind).toBe('prepared');
            return (out as any).capability as string;
        } };
}
const stat = (out: any, code: string) => {
    expect(out.kind).toBe('status');
    expect(out.code).toBe(code);
    expect(Object.keys(out).sort()).toEqual(['code', 'issuance', 'kind', 'state']);
    expect(Object.isFrozen(out)).toBe(true);
    expect(JSON.stringify(out)).not.toContain(token);
};
describe('preparation, identity and reservations', () => {
    it('prepares without repository calls and exposes only a canonical capability', () => {
        const s = setup(), out = s.coordinator.prepare(request);
        expect(Object.keys(out)).toEqual(['kind', 'capability']);
        expect((out as any).capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(s.repository.issue).not.toHaveBeenCalled();
        expect(s.entropy).toHaveBeenCalledTimes(2);
        s.coordinator.close();
    });
    it.each([undefined, null, {}, { ...request, extra: true }, { ...request, expectedPolicyRevision: 0 }, { ...request, parentOrigin: undefined }])('invalid preparation reserves no lasting entry', raw => {
        const s = setup();
        stat(s.coordinator.prepare(raw), 'INVALID_REQUEST');
        expect(s.entropy).not.toHaveBeenCalled();
        for (let i = 0; i < 16; i++)
            s.prepare();
        stat(s.coordinator.prepare(request), 'CAPACITY');
        s.coordinator.close();
    });
    it('does not invoke request accessors or proxy traps', () => {
        const s = setup(), spy = vi.fn(() => {
            throw Error('private');
        });
        stat(s.coordinator.prepare(Object.defineProperty({ ...request }, 'installationId', { get: spy })), 'INVALID_REQUEST');
        stat(s.coordinator.prepare(new Proxy(request, { get: spy, ownKeys: spy })), 'INVALID_REQUEST');
        expect(spy).not.toHaveBeenCalled();
    });
    it.each(['throw', 'short', 'long', 'proxy', 'accessor'] as const)('entropy %s failure does not invoke SQL', kind => {
        const s = setup(({ entropy }: any) => entropy.mockImplementation(() => {
            if (kind === 'throw')
                throw Error('private');
            if (kind === 'proxy')
                return new Proxy(Buffer.alloc(32), {});
            if (kind === 'accessor')
                return Object.defineProperty(Buffer.alloc(32), 'extra', { get: () => 1 });
            return Buffer.alloc(kind === 'short' ? 31 : 33);
        }));
        stat(s.coordinator.prepare(request), 'ENTROPY_UNAVAILABLE');
        expect(s.repository.issue).not.toHaveBeenCalled();
    });
    it.each(['same-pair', 'cap-cap', 'id-id', 'cap-id', 'id-cap'] as const)('rejects %s collision without retry', kind => {
        const s = setup();
        s.prepare();
        const a = Buffer.alloc(32, 1), b = Buffer.alloc(32, 2), c = Buffer.alloc(32, 3);
        s.entropy.mockReset();
        const pair = kind === 'same-pair' ? [c, c] : kind === 'cap-cap' ? [a, c] : kind === 'id-id' ? [c, b] : kind === 'cap-id' ? [b, c] : [c, a];
        s.entropy.mockReturnValueOnce(pair[0]!).mockReturnValueOnce(pair[1]!);
        stat(s.coordinator.prepare(request), 'ENTROPY_UNAVAILABLE');
        expect(s.entropy).toHaveBeenCalledTimes(2);
        expect(s.repository.issue).not.toHaveBeenCalled();
    });
    it('reserves before reentrant entropy and never exceeds sixteen entries', () => {
        let s: ReturnType<typeof setup>, nested = 0, busy = false;
        s = setup(({ entropy }: any) => {
            let n = 0;
            entropy.mockImplementation(() => {
                if (!busy && nested < 20) {
                    busy = true;
                    for (let i = 0; i < 20; i++)
                        if (s.coordinator.prepare(request).kind === 'prepared')
                            nested++;
                    busy = false;
                }
                return Buffer.alloc(32, ++n);
            });
        });
        expect(s.coordinator.prepare(request).kind).toBe('prepared');
        expect(nested).toBe(15);
        stat(s.coordinator.prepare(request), 'CAPACITY');
    });
    it('rejects collision inserted by reentrant entropy before publication', () => {
        const s = setup();
        let nested = false, call = 0;
        s.entropy.mockImplementation(() => {
            call++;
            if (call === 1) {
                nested = true;
                s.coordinator.prepare(request);
                return Buffer.alloc(32, 2);
            }
            return Buffer.alloc(32, call);
        });
        stat(s.coordinator.prepare(request), 'ENTROPY_UNAVAILABLE');
        expect(nested).toBe(true);
    });
    it('retains terminal tombstones until preparation lifetime', async () => {
        const s = setup();
        s.repository.issue.mockResolvedValue(failure as any);
        for (let i = 0; i < 16; i++) {
            const c = s.prepare();
            stat(await s.coordinator.issue(c), 'OPERATION_FAILED');
        }
        stat(s.coordinator.prepare(request), 'CAPACITY');
        s.clock.advance(900000);
        expect(s.coordinator.prepare(request).kind).toBe('prepared');
    });
    it('publishes immutable logical payload bounds rather than a heap guarantee', () => {
        expect(DELIVERY_BOUNDS.totalBytes).toBe(16 * DELIVERY_BOUNDS.entryBytes + 2 * DELIVERY_BOUNDS.ownerBytes);
        expect(Object.isFrozen(DELIVERY_BOUNDS)).toBe(true);
    });
});
describe('issue, explicit recovery and accepted validator-only delivery', () => {
    it.each([false, true])('delivers genuine parsed V2=%s and validator-only exact redelivery', async (v2) => {
        const s = setup(), r: any = clone(receipt), req = { ...request, parentOrigin: v2 ? 'https://merchant.example' : null };
        if (v2) {
            r.render = { ...r.render, renderSchemaVersion: 2, submissionMode: 'unconfirmed_request' };
            r.mode = 'iframe';
            r.parentOrigin = req.parentOrigin;
        }
        expect(() => createModeSessionContracts([profile]).issueReceipt(r, req)).not.toThrow();
        s.repository.issue.mockResolvedValue(success(r) as any);
        s.validator.validateExisting.mockResolvedValue({ kind: 'completed', delivery: 'data', data: r });
        const cap = s.prepare(req);
        const first: any = await s.coordinator.issue(cap);
        expect(first.kind).toBe('delivery');
        const body = JSON.parse(first.body);
        expect(Object.keys(body)).toEqual(['schemaVersion', 'deliveryId', 'token', 'receipt']);
        expect(body.token).toBe(token);
        expect(body.receipt).toEqual(r);
        stat(await s.coordinator.issue(cap), 'REDELIVERY_REQUIRED');
        stat(await s.coordinator.recover(cap), 'REDELIVERY_REQUIRED');
        const again = await s.coordinator.deliver(cap);
        expect(again).toEqual(first);
        expect(s.repository.issue).toHaveBeenCalledTimes(1);
        expect(s.repository.recoverIssue).not.toHaveBeenCalled();
        expect(s.validator.validateExisting).toHaveBeenCalledWith({ tokenHash: createHash('sha256').update('mode-flow-session:v1:' + token).digest('hex'), request: req, baseline: { sessionId: r.sessionId, issuedAt: r.issuedAt, expiresAt: r.expiresAt } }, { signal: expect.any(AbortSignal) });
        expect(s.entropy).toHaveBeenCalledTimes(2);
        s.coordinator.close();
    });
    it('retains committed success after its response waiter aborts', async () => {
        const s = setup(), d = deferred<any>(), a = new AbortController();
        s.repository.issue.mockImplementation(() => d.promise);
        const cap = s.prepare(), out = s.coordinator.issue(cap, { signal: a.signal });
        a.abort();
        stat(await out, 'WAIT_CANCELLED');
        expect((s.repository.issue.mock.calls[0] as any)[1].signal.aborted).toBe(false);
        d.resolve(success());
        await tick();
        stat(await s.coordinator.wait(cap), 'REDELIVERY_REQUIRED');
        expect((await s.coordinator.deliver(cap)).kind).toBe('delivery');
    });
    it.each(['unknown', 'known'] as const)('explicit same-attempt recovery preserves prior %s', async (prior) => {
        const s = setup();
        s.repository.issue.mockResolvedValue((prior === 'unknown' ? unknown() : withheld()) as any);
        s.repository.recoverIssue.mockResolvedValue({ priorIssuance: prior === 'unknown' ? 'unknown' : 'known_committed', outcome: success() } as any);
        const cap = s.prepare();
        stat(await s.coordinator.issue(cap), 'RECOVERY_REQUIRED');
        stat(await s.coordinator.issue(cap), 'RECOVERY_REQUIRED');
        stat(await s.coordinator.deliver(cap), 'RECOVERY_REQUIRED');
        expect((await s.coordinator.recover(cap)).kind).toBe('delivery');
        expect(s.repository.recoverIssue).toHaveBeenCalledWith(attempt, { signal: expect.any(AbortSignal) });
        expect(s.repository.issue).toHaveBeenCalledTimes(1);
    });
    it.each(['unknown', 'known'] as const)('null attempt is truthfully terminal after %s', async (prior) => {
        const s = setup();
        s.repository.issue.mockResolvedValue((prior === 'unknown' ? unknown(null) : withheld(null)) as any);
        const cap = s.prepare(), out: any = await s.coordinator.issue(cap);
        stat(out, prior === 'known' ? 'COMMITTED_UNAVAILABLE' : 'UNAVAILABLE');
        expect(out.issuance).toBe(prior === 'known' ? 'known_committed' : 'unknown');
        stat(await s.coordinator.recover(cap), out.code);
        expect(s.repository.recoverIssue).not.toHaveBeenCalled();
    });
    it.each(['unknown', 'known'] as const)('failed recovery cannot clear earlier %s certainty', async (prior) => {
        const s = setup();
        s.repository.issue.mockResolvedValue((prior === 'unknown' ? unknown() : withheld()) as any);
        s.repository.recoverIssue.mockResolvedValue({ priorIssuance: prior === 'unknown' ? 'unknown' : 'known_committed', outcome: failure } as any);
        const cap = s.prepare();
        await s.coordinator.issue(cap);
        const out: any = await s.coordinator.recover(cap);
        expect(out.issuance).toBe(prior === 'known' ? 'known_committed' : 'unknown');
        expect(out.state).toBe('terminal');
        stat(await s.coordinator.recover(cap), out.code);
        expect(s.repository.recoverIssue).toHaveBeenCalledTimes(1);
    });
    it.each(['wrong-render', 'read-uncertain', 'read-withheld', 'read-failed', 'throw'] as const)('redelivery %s withholds without changing issuance', async (kind) => {
        const s = setup(), cap = s.prepare();
        await s.coordinator.issue(cap);
        if (kind === 'wrong-render') {
            const r = clone(receipt);
            r.render.service.name = 'Changed';
            s.validator.validateExisting.mockResolvedValue({ kind: 'completed', delivery: 'data', data: r });
        }
        else if (kind === 'throw')
            s.validator.validateExisting.mockRejectedValue(Error('private'));
        else
            s.validator.validateExisting.mockResolvedValue((kind === 'read-uncertain' ? { kind: 'completion_uncertain', code: 'READ_COMPLETION_UNCERTAIN', data: null, backendMayStillRun: true } : kind === 'read-withheld' ? { kind: 'completed', delivery: 'withheld', data: null, reason: 'ABORTED' } : { kind: 'failed', code: 'FORBIDDEN', data: null, transaction: 'no_commit_submitted', backendMayStillRun: true }) as any);
        const out: any = await s.coordinator.deliver(cap);
        stat(out, 'VALIDATION_UNAVAILABLE');
        expect(out.issuance).toBe('known_committed');
        expect(out.state).toBe('accepted');
        expect(s.repository.issue).toHaveBeenCalledTimes(1);
        s.validator.validateExisting.mockResolvedValue({ kind: 'completed', delivery: 'data', data: clone(receipt) });
        expect((await s.coordinator.deliver(cap)).kind).toBe('delivery');
    });
    it('canonical comparison accepts reordered valid receipt fields', async () => {
        const s = setup(), cap = s.prepare();
        await s.coordinator.issue(cap);
        const r = Object.fromEntries(Object.entries(clone(receipt)).reverse());
        s.validator.validateExisting.mockResolvedValue({ kind: 'completed', delivery: 'data', data: r } as any);
        expect((await s.coordinator.deliver(cap)).kind).toBe('delivery');
    });
    it.each(['token', 'handle', 'receipt'] as const)('malformed committed %s cannot become predispatch failure', async (what) => {
        const s = setup(), r: any = success();
        if (what === 'token')
            r.token = 'bad';
        if (what === 'handle')
            r.session = { key: 1 };
        if (what === 'receipt')
            r.receipt = { ...receipt, extra: 1 };
        s.repository.issue.mockResolvedValue(r);
        const out: any = await s.coordinator.issue(s.prepare());
        stat(out, 'COMMITTED_UNAVAILABLE');
        expect(out.issuance).toBe('known_committed');
    });
});
describe('waiters, owner bounds, ack and terminal ownership', () => {
    it.each(['issue', 'recover', 'deliver', 'wait'] as const)('invalid/preaborted %s options do not dispatch or attach', async (method) => {
        const s = setup(), cap = s.prepare(), abort = new AbortController();
        abort.abort();
        stat(await s.coordinator[method](cap, { signal: abort.signal }), 'WAIT_CANCELLED');
        stat(await s.coordinator[method](cap, { extra: true } as any), 'INVALID_REQUEST');
        expect(s.repository.issue).not.toHaveBeenCalled();
        expect(s.repository.recoverIssue).not.toHaveBeenCalled();
        expect(s.validator.validateExisting).not.toHaveBeenCalled();
    });
    it('rejects hostile signal options without getters', async () => {
        const s = setup(), spy = vi.fn(), cap = s.prepare();
        stat(await s.coordinator.issue(cap, Object.defineProperty({}, 'signal', { get: spy })), 'INVALID_REQUEST');
        stat(await s.coordinator.issue(cap, { signal: new Proxy(new AbortController().signal, { get: spy }) }), 'INVALID_REQUEST');
        expect(spy).not.toHaveBeenCalled();
    });
    it('only one waiter can attach to an active operation', async () => {
        const s = setup(), d = deferred<any>(), abort = new AbortController();
        s.repository.issue.mockImplementation(() => d.promise);
        const cap = s.prepare(), first = s.coordinator.issue(cap, { signal: abort.signal });
        stat(await s.coordinator.wait(cap), 'BUSY');
        abort.abort();
        await first;
        const second = s.coordinator.wait(cap);
        stat(await s.coordinator.wait(cap), 'BUSY');
        d.resolve(success());
        expect((await second).kind).toBe('delivery');
        expect(s.repository.issue).toHaveBeenCalledTimes(1);
    });
    it('two owner slots remain charged after deadline until lower promises settle', async () => {
        const s = setup(), a = deferred<any>(), b = deferred<any>();
        s.repository.issue.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
        const ca = s.prepare(), cb = s.prepare(), cc = s.prepare(), pa = s.coordinator.issue(ca), pb = s.coordinator.issue(cb);
        stat(await s.coordinator.issue(cc), 'CAPACITY');
        s.clock.advance(10000);
        const oa: any = await pa, ob: any = await pb;
        stat(oa, 'OPERATION_DEADLINE');
        stat(ob, 'OPERATION_DEADLINE');
        expect(oa.issuance).toBe('unknown');
        stat(await s.coordinator.issue(cc), 'CAPACITY');
        a.resolve(success());
        await tick();
        expect(oa.issuance).toBe('unknown');
        const history: any = await s.coordinator.wait(ca);
        expect(history.issuance).toBe('known_committed');
        stat(history, 'OPERATION_DEADLINE');
        expect((await s.coordinator.issue(cc)).kind).toBe('delivery');
        b.reject(Error('private'));
        await tick();
    });
    it('expired live entry reservation cannot be replaced while owner remains pending', async () => {
        const s = setup(), a = deferred<any>();
        s.repository.issue.mockImplementationOnce(() => a.promise);
        const cap = s.prepare(), pending = s.coordinator.issue(cap);
        for (let i = 0; i < 15; i++)
            s.prepare();
        s.clock.advance(900000);
        await pending;
        for (let i = 0; i < 15; i++)
            s.prepare();
        stat(s.coordinator.prepare(request), 'CAPACITY');
        a.resolve(success());
        await tick();
        expect(s.coordinator.prepare(request).kind).toBe('prepared');
    });
    it('ack before offer and wrong IDs do not mutate; duplicate valid ack is idempotent', async () => {
        const s = setup(), cap = s.prepare();
        stat(s.coordinator.acknowledge(cap, Buffer.alloc(32, 2).toString('base64url')), 'INVALID_REQUEST');
        const out: any = await s.coordinator.issue(cap);
        stat(s.coordinator.acknowledge(cap, 'wrong'), 'INVALID_REQUEST');
        stat(s.coordinator.acknowledge(cap, out.deliveryId), 'ACKED');
        stat(s.coordinator.acknowledge(cap, out.deliveryId), 'ACKED');
        stat(await s.coordinator.deliver(cap), 'ACKED');
        expect(s.validator.validateExisting).not.toHaveBeenCalled();
    });
    it('ack wins before pending validation completes and late result cannot redeliver', async () => {
        const s = setup(), cap = s.prepare(), first: any = await s.coordinator.issue(cap), d = deferred<any>();
        s.validator.validateExisting.mockImplementation(() => d.promise);
        const pending = s.coordinator.deliver(cap);
        stat(s.coordinator.acknowledge(cap, first.deliveryId), 'ACKED');
        stat(await pending, 'ACKED');
        d.resolve({ kind: 'completed', delivery: 'data', data: receipt });
        await tick();
        stat(await s.coordinator.deliver(cap), 'ACKED');
    });
    it('close settles both waiters before lower outcomes and preserves frozen snapshots', async () => {
        const s = setup(), a = deferred<any>(), b = deferred<any>();
        s.repository.issue.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
        const ca = s.prepare(), cb = s.prepare(), pa = s.coordinator.issue(ca), pb = s.coordinator.issue(cb);
        expect(s.coordinator.close()).toBeUndefined();
        const first: any = await pa;
        stat(first, 'CLOSED');
        stat(await pb, 'CLOSED');
        a.resolve(success());
        b.reject(Error('private'));
        await tick();
        expect(first.issuance).toBe('unknown');
        stat(s.coordinator.prepare(request), 'CLOSED');
    });
    it.each([null, {}, 'bad', 'A'.repeat(43)])('missing capability has no issuance absence claim', async (cap) => {
        const s = setup(), out: any = await s.coordinator.issue(cap);
        expect(out).toEqual({ kind: 'status', state: 'unavailable', issuance: 'unavailable', code: 'UNAVAILABLE' });
        expect(s.repository.issue).not.toHaveBeenCalled();
    });
});
describe('clock, callback ownership and original lifetime', () => {
    it.each(['entropy', 'monotonic', 'wall', 'timer'] as const)('reentrant close during %s cannot publish prepare', kind => {
        let s: ReturnType<typeof setup>;
        s = setup();
        if (kind === 'entropy')
            s.entropy.mockImplementation(() => {
                s.coordinator.close();
                return Buffer.alloc(32, 1);
            });
        if (kind === 'monotonic')
            s.clock.monoHook = () => s.coordinator.close();
        if (kind === 'wall')
            s.clock.wallHook = () => s.coordinator.close();
        if (kind === 'timer')
            s.clock.setHook = () => s.coordinator.close();
        stat(s.coordinator.prepare(request), 'CLOSED');
        expect(s.repository.issue).not.toHaveBeenCalled();
    });
    it.each(['mono-throw', 'wall-throw', 'negative', 'nan', 'unsafe-wall', 'set-throw', 'clear-throw'] as const)('terminal clock fault %s cannot resurrect', async (kind) => {
        const s = setup();
        if (kind === 'mono-throw')
            s.clock.monoHook = () => {
                throw Error('private');
            };
        if (kind === 'wall-throw')
            s.clock.wallHook = () => {
                throw Error('private');
            };
        if (kind === 'negative')
            s.clock.now = -1;
        if (kind === 'nan')
            s.clock.now = NaN;
        if (kind === 'unsafe-wall')
            s.clock.epoch = Infinity;
        if (kind === 'set-throw')
            s.clock.setHook = () => {
                throw Error('private');
            };
        if (kind === 'clear-throw') {
            const cap = s.prepare();
            s.clock.clearHook = () => {
                throw Error('private');
            };
            const out: any = await s.coordinator.issue(cap);
            expect(out.kind).toBe('status');
        }
        else
            stat(s.coordinator.prepare(request), 'CLOCK_UNAVAILABLE');
        s.clock.monoHook = undefined;
        s.clock.wallHook = undefined;
        s.clock.setHook = undefined;
        s.clock.clearHook = undefined;
        s.clock.now = 1;
        s.clock.epoch = Date.parse(receipt.issuedAt);
        stat(s.coordinator.prepare(request), 'CLOCK_UNAVAILABLE');
    });
    it('cross-call backward clock permanently closes admission', () => {
        const s = setup();
        s.clock.now = 10;
        s.prepare();
        s.clock.now = 9;
        stat(s.coordinator.prepare(request), 'CLOCK_UNAVAILABLE');
        s.clock.now = 20;
        stat(s.coordinator.prepare(request), 'CLOCK_UNAVAILABLE');
    });
    it('safe-integer wall extremes use exact BigInt elapsed', async () => {
        const s = setup();
        s.clock.epoch = Number.MIN_SAFE_INTEGER;
        const cap = s.prepare();
        s.clock.epoch = Number.MAX_SAFE_INTEGER;
        stat(await s.coordinator.issue(cap), 'EXPIRED');
        expect(s.repository.issue).not.toHaveBeenCalled();
    });
    it.each([9999, 10000])('final cleanup sample honors owner boundary %i', async (elapsed) => {
        const s = setup(), cap = s.prepare();
        let once = false;
        s.clock.clearHook = () => {
            if (!once) {
                once = true;
                s.clock.now = elapsed;
            }
        };
        const out: any = await s.coordinator.issue(cap);
        expect(out.kind).toBe(elapsed === 9999 ? 'delivery' : 'status');
        if (elapsed === 10000) {
            stat(out, 'OPERATION_DEADLINE');
            expect(out.issuance).toBe('known_committed');
        }
    });
    it('preparation lifetime cannot be rebased by delayed issue or redelivery', async () => {
        const s = setup(), cap = s.prepare();
        s.clock.advance(800000);
        const out: any = await s.coordinator.issue(cap);
        expect(out.kind).toBe('delivery');
        s.clock.advance(99999);
        expect((await s.coordinator.deliver(cap)).kind).toBe('delivery');
        s.clock.advance(1);
        const result: any = await s.coordinator.deliver(cap);
        expect(result.kind).toBe('status');
        expect(['EXPIRED', 'UNAVAILABLE']).toContain(result.code);
    });
    it('a close after prior deadline still stops other entries without changing first reason', async () => {
        const s = setup(), d = deferred<any>();
        s.repository.issue.mockImplementationOnce(() => d.promise);
        const cap = s.prepare(), pending = s.coordinator.issue(cap);
        s.clock.advance(10000);
        const old: any = await pending;
        const other = s.prepare();
        s.coordinator.close();
        stat(old, 'OPERATION_DEADLINE');
        stat(await s.coordinator.issue(other), 'CLOSED');
        d.resolve(success());
        await tick();
    });
});
describe('additional callback and payload boundaries', () => {
    it('large valid V1 astral catalog is preserved with exact bounded body', async () => {
        const s = setup(), r: any = clone(receipt);
        r.render.service.questions = Array.from({ length: 50 }, (_, i) => ({ id: 'q' + String(i).padStart(2, '0') + 'a'.repeat(97), prompt: '\u{1F642}'.repeat(500), kind: 'quantity', required: true, choices: [], minQty: 0, maxQty: 10000 }));
        r.render.config.steps = r.render.service.questions.map((q: any, i: number) => ({ key: String(i).padStart(2, '0') + '\u{1F642}'.repeat(198), questionKey: q.id, kind: 'question', required: true }));
        expect(() => createModeSessionContracts([profile]).issueReceipt(r, request)).not.toThrow();
        s.repository.issue.mockResolvedValue(success(r) as any);
        const out: any = await s.coordinator.issue(s.prepare());
        expect(out.kind).toBe('delivery');
        expect(Buffer.byteLength(out.body)).toBeGreaterThan(140000);
        expect(Buffer.byteLength(out.body)).toBeLessThanOrEqual(DELIVERY_BOUNDS.bodyBytes);
        expect(JSON.parse(out.body).receipt).toEqual(r);
    });
    it('escaped content round-trips without extra envelope keys or string execution', async () => {
        const s = setup(), r = clone(receipt);
        r.render.service.name = 'quote" slash\\ newline\n tab\t <script>\u{1F642}';
        s.repository.issue.mockResolvedValue(success(r) as any);
        const out: any = await s.coordinator.issue(s.prepare());
        expect(JSON.parse(out.body).receipt).toEqual(r);
        expect(Object.keys(JSON.parse(out.body))).toEqual(['schemaVersion', 'deliveryId', 'token', 'receipt']);
    });
    it('overbounded committed render is withheld and remains known committed', async () => {
        const s = setup(), r = clone(receipt);
        r.render.service.name = 'x'.repeat(1048577);
        s.repository.issue.mockResolvedValue(success(r) as any);
        const out: any = await s.coordinator.issue(s.prepare());
        stat(out, 'COMMITTED_UNAVAILABLE');
        expect(out.issuance).toBe('known_committed');
    });
    it.each([9998, 10000])('large monotonic origin uses elapsed owner boundary %i', async (elapsed) => {
        const s = setup();
        s.clock.now = 2 ** 53;
        const cap = s.prepare();
        let once = false;
        s.clock.clearHook = () => {
            if (!once) {
                once = true;
                s.clock.now = 2 ** 53 + elapsed;
            }
        };
        const out: any = await s.coordinator.issue(cap);
        expect(out.kind).toBe(elapsed === 9998 ? 'delivery' : 'status');
        if (elapsed === 10000)
            stat(out, 'OPERATION_DEADLINE');
    });
    it('abort during waiter timer setup restores prepared state before any issue invocation', async () => {
        const s = setup(), cap = s.prepare(), abort = new AbortController();
        s.clock.setHook = () => {
            s.clock.setHook = undefined;
            abort.abort();
        };
        stat(await s.coordinator.issue(cap, { signal: abort.signal }), 'WAIT_CANCELLED');
        expect(s.repository.issue).not.toHaveBeenCalled();
        expect((await s.coordinator.issue(cap)).kind).toBe('delivery');
    });
    it('synchronous entry timer cannot publish a capability or leak its returned handle', () => {
        const clock = new Clock();
        clock.setTimer = (fn, ms) => {
            const h = {};
            clock.timers.set(h, { fn, at: ms });
            fn();
            return h;
        };
        let n = 0;
        const repository = { issue: vi.fn(), recoverIssue: vi.fn() }, validator = { validateExisting: vi.fn() };
        const c = create({ repository, validator, profiles: [profile], clock, entropy: () => Buffer.alloc(32, ++n) });
        stat(c.prepare(request), 'EXPIRED');
        expect(clock.timers.size).toBe(0);
        expect(repository.issue).not.toHaveBeenCalled();
    });
    it('all cleanup callbacks are attempted when one clearTimer throws on global close', async () => {
        const s = setup(), d = deferred<any>();
        s.repository.issue.mockImplementation(() => d.promise);
        const ca = s.prepare(), cb = s.prepare(), pa = s.coordinator.issue(ca), pb = s.coordinator.issue(cb);
        let clears = 0;
        s.clock.clearHook = () => {
            clears++;
            throw Error('private');
        };
        expect(() => s.coordinator.close()).not.toThrow();
        stat(await pa, 'CLOSED');
        expect((await pb).kind).toBe('status');
        expect(clears).toBeGreaterThanOrEqual(4);
        expect(s.clock.timers.size).toBe(0);
        d.resolve(success());
        await tick();
    });
    it('mutating trusted dependency method properties after construction does not replace captured methods', async () => {
        const s = setup(), cap = s.prepare();
        s.repository.issue = vi.fn(() => {
            throw Error('replacement');
        }) as any;
        s.validator.validateExisting = vi.fn(() => {
            throw Error('replacement');
        }) as any;
        expect((await s.coordinator.issue(cap)).kind).toBe('delivery');
        expect((await s.coordinator.deliver(cap)).kind).toBe('delivery');
        expect(s.repository.issue).not.toHaveBeenCalled();
        expect(s.validator.validateExisting).not.toHaveBeenCalled();
    });
});


it('abort during owner timer setup still prevents the first dependency dispatch', async () => {
    const s = setup(), cap = s.prepare(), abort = new AbortController();
    let timers = 0;
    s.clock.setHook = () => { if (++timers === 2) abort.abort(); };
    stat(await s.coordinator.issue(cap, { signal: abort.signal }), 'WAIT_CANCELLED');
    expect(s.repository.issue).not.toHaveBeenCalled();
    s.clock.setHook = undefined;
    expect((await s.coordinator.issue(cap)).kind).toBe('delivery');
});


describe('reviewed outcome and global-state boundaries', () => {
    it.each([
        { ...failure, code: 'UNRECOGNIZED' },
        { ...failure, transaction: 'committed' },
        { ...failure, backendMayStillRun: 'wrong' },
        { ...failure, backendMayStillRun: false },
        { ...failure, transaction: 'not_started' },
        { kind: 'committed' },
        { ...withheld(), reason: 'UNKNOWN' },
        { ...withheld(), reason: 'CLOSED' },
    ])('malformed lower envelope cannot invent historical certainty', async raw => {
        const s = setup(); s.repository.issue.mockResolvedValue(raw as any);
        const out = await s.coordinator.issue(s.prepare());
        expect(out).toEqual({ kind: 'status', state: 'terminal', issuance: 'unknown', code: 'OPERATION_FAILED' });
        s.coordinator.close();
    });
    it('latches all entries before any shutdown cleanup callback', async () => {
        const pending = deferred<any>();
        const s = setup(); s.repository.issue.mockReturnValue(pending.promise);
        const a = s.prepare(), b = s.prepare();
        const first = s.coordinator.issue(a), second = s.coordinator.issue(b);
        let observed: Promise<any> | undefined;
        s.clock.clearHook = () => { s.clock.clearHook = undefined; observed = s.coordinator.wait(b); };
        s.coordinator.close();
        const expected = { kind: 'status', state: 'terminal', issuance: 'unknown', code: 'CLOSED' };
        expect(await observed).toEqual(expected); expect(await first).toEqual(expected); expect(await second).toEqual(expected);
        pending.resolve(success()); await tick();
    });
    it('checks expiry even for an otherwise disallowed accepted issue call', async () => {
        const s = setup(), cap = s.prepare();
        expect((await s.coordinator.issue(cap)).kind).toBe('delivery');
        s.clock.now = 899999; s.clock.epoch += 899999;
        stat(await s.coordinator.issue(cap), 'REDELIVERY_REQUIRED');
        s.clock.now++; s.clock.epoch++;
        expect(await s.coordinator.issue(cap)).toEqual({kind:'status',state:'terminal',issuance:'known_committed',code:'EXPIRED'});
        expect(s.repository.issue).toHaveBeenCalledTimes(1); s.coordinator.close();
    });
});


describe('earlier credential notification with independent retention cutoff', () => {
    const shortReceipt = () => ({ ...clone(receipt), issuedAt: '2026-09-10T11:46:00.000000Z', expiresAt: '2026-09-10T12:01:00.000000Z' });
    it('expires credentials at the earlier cutoff but retains all sixteen reservations to preparation cutoff', async () => {
        const s = setup(); s.repository.issue.mockResolvedValue(success(shortReceipt()));
        const caps: string[] = [];
        for (let i = 0; i < 16; i++) {
            const cap = s.prepare(); caps.push(cap);
            expect((await s.coordinator.issue(cap)).kind).toBe('delivery');
        }
        expect(s.clock.timers.size).toBe(32);
        s.clock.advance(59999); stat(await s.coordinator.wait(caps[0]), 'REDELIVERY_REQUIRED');
        s.clock.advance(1); stat(await s.coordinator.wait(caps[0]), 'EXPIRED');
        expect(s.clock.timers.size).toBe(16);
        stat(s.coordinator.prepare(request), 'CAPACITY');
        s.clock.advance(840000);
        expect(s.coordinator.prepare(request).kind).toBe('prepared');
        s.coordinator.close();
    });
    it('does not rearm either timer during accepted validation or acknowledgement', async () => {
        const s = setup(), cap = s.prepare(), r = shortReceipt();
        s.repository.issue.mockResolvedValue(success(r)); s.validator.validateExisting.mockResolvedValue({kind:'completed',delivery:'data',data:r});
        const first: any = await s.coordinator.issue(cap);
        const handles = [...s.clock.timers.keys()];
        s.clock.advance(1000);
        expect((await s.coordinator.deliver(cap)).kind).toBe('delivery');
        expect([...s.clock.timers.keys()]).toEqual(handles);
        stat(s.coordinator.acknowledge(cap, first.deliveryId), 'ACKED');
        expect([...s.clock.timers.keys()]).toEqual(handles);
        s.clock.advance(59000); stat(await s.coordinator.wait(cap), 'EXPIRED'); s.coordinator.close();
    });
    it('old earlier and retention callbacks cannot mutate a replacement entry', async () => {
        const s = setup(), cap = s.prepare(); s.repository.issue.mockResolvedValue(success(shortReceipt()));
        await s.coordinator.issue(cap);
        const callbacks = [...s.clock.timers.values()].map(t => t.fn);
        s.clock.advance(900000); const replacement = s.prepare();
        for (const callback of callbacks) callback();
        stat(await s.coordinator.wait(replacement), 'READY');
        expect(s.clock.timers.size).toBe(1); s.coordinator.close();
    });
    it.each([0, 999, 1000])('floors SQL microsecond remaining budget %s conservatively', async us => {
        const s = setup(), cap = s.prepare();
        const r = { ...clone(receipt), issuedAt: `2026-09-10T11:45:00.${String(us).padStart(6,'0')}Z`, expiresAt: `2026-09-10T12:00:00.${String(us).padStart(6,'0')}Z` };
        createModeSessionContracts([profile]).issueReceipt(r, request);
        s.repository.issue.mockResolvedValue(success(r));
        const out = await s.coordinator.issue(cap);
        if (us < 1000) stat(out, 'EXPIRED');
        else { expect(out.kind).toBe('delivery'); s.clock.advance(1); stat(await s.coordinator.wait(cap), 'EXPIRED'); }
        s.coordinator.close();
    });
    it('rejects noncanonical offset receipts under the unchanged session contract', async () => {
        const s = setup(), cap = s.prepare();
        s.repository.issue.mockResolvedValue(success({ ...clone(receipt), issuedAt:'2026-09-10T13:46:00.000000+02:00', expiresAt:'2026-09-10T14:01:00.000000+02:00' }));
        stat(await s.coordinator.issue(cap), 'COMMITTED_UNAVAILABLE');
        expect([...s.clock.timers.values()].map(t=>t.at)).toEqual([900000]);
        s.coordinator.close();
    });
    it('contains synchronous earlier notification and clears its returned handle before delivery', async () => {
        const s = setup(), cap = s.prepare(); s.repository.issue.mockResolvedValue(success(shortReceipt()));
        s.clock.setHook = () => {
            const timers = [...s.clock.timers.values()];
            const latest = timers[timers.length - 1]!;
            if (latest.at === 60000) { s.clock.setHook = undefined; latest.fn(); }
        };
        stat(await s.coordinator.issue(cap), 'EXPIRED');
        expect(s.clock.timers.size).toBe(1); s.coordinator.close();
    });
    it('reentrant clear during synchronous earlier notification cannot publish credentials', async () => {
        const s = setup(), cap = s.prepare(); s.repository.issue.mockResolvedValue(success(shortReceipt()));
        s.clock.setHook = () => {
            const latest = [...s.clock.timers.values()].at(-1)!;
            if (latest.at === 60000) {
                s.clock.setHook = undefined;
                s.clock.clearHook = () => { s.clock.clearHook = undefined; s.coordinator.close(); };
                latest.fn();
            }
        };
        const out = await s.coordinator.issue(cap); stat(out,'EXPIRED');
        expect(JSON.stringify(out)).not.toContain(token); expect(s.clock.timers.size).toBe(0);
    });
    it.each([
        { ...failure },
        { kind:'failed',code:'INVALID_REQUEST',transaction:'not_started',backendMayStillRun:false },
        { kind:'failed',code:'INTERNAL_ERROR',transaction:'rolled_back',backendMayStillRun:false },
    ])('retains genuine lower failure observations', async raw => {
        const s = setup(); s.repository.issue.mockResolvedValue(raw as any);
        expect(await s.coordinator.issue(s.prepare())).toEqual({kind:'status',state:'terminal',issuance:'not_observed',code:'OPERATION_FAILED'});
        s.coordinator.close();
    });
});


it('keeps both owner reservations charged through the final trusted sample', async () => {
    const first = deferred<any>(), second = deferred<any>();
    const s = setup(), a = s.prepare(), b = s.prepare(), c = s.prepare();
    s.repository.issue.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const pa = s.coordinator.issue(a), pb = s.coordinator.issue(b);
    let clears = 0, samples = 0, observed: Promise<any> | undefined;
    s.clock.clearHook = () => {
        if (++clears === 2) s.clock.monoHook = () => {
            if (++samples === 2) { s.clock.monoHook = undefined; observed = s.coordinator.issue(c); }
        };
    };
    first.resolve(success()); expect((await pa).kind).toBe('delivery');
    expect(observed).toBeDefined(); stat(await observed, 'CAPACITY');
    expect(s.repository.issue).toHaveBeenCalledTimes(2);
    s.clock.clearHook = undefined; s.clock.monoHook = undefined;
    expect((await s.coordinator.issue(c)).kind).toBe('delivery');
    second.resolve(success()); await pb; s.coordinator.close();
});
