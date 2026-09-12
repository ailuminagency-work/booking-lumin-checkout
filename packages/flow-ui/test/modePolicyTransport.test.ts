import { afterEach, describe, it, expect, vi } from 'vitest';
import { createModePolicyTransport, type ModePolicyClock, type ModePolicyOutcome } from '../src/modePolicyTransport';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profile = {
    profileVersion: 'transport-v1', rendererOrigin: 'https://renderer.test', apiOrigin: 'https://api.test', portalOrigin: 'https://portal.test', loaderUrl: 'https://renderer.test/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js'
};
function policy() {
    return {
        schemaVersion: 1, installationId: id, mode: 'hosted', deploymentProfileVersion: profile.profileVersion, rendererOrigin: profile.rendererOrigin, apiOrigin: profile.apiOrigin, loaderUrl: profile.loaderUrl, currentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', targetRevision: 1, policyRevision: 1, allowedParentOrigins: [], enabled: true
    };
}
const route = {
    installationId: id, mode: 'hosted' as const
};
function json(value: unknown = policy()) {
    return new Response(JSON.stringify(value), {
        headers: {
            'content-type': 'application/json'
        }
    });
}
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => {
        resolve = r;
    });
    return {
        promise, resolve
    };
}
async function flush() {
    for (let i = 0; i < 24; i++)
        await Promise.resolve();
}
function clock() {
    let now = 0, id = 0;
    const timers = new Map<number, () => void>();
    const api: ModePolicyClock = {
        now: () => now, setTimer(fn) {
            timers.set(++id, fn);
            return id;
        }, clearTimer(h) {
            timers.delete(h as number);
        }
    };
    return {
        api, timers, set: (v: number) => {
            now = v;
        }, fire: () => {
            for (const fn of [...timers.values()])
                fn();
        }
    };
}
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    await Promise.all(closers.splice(0).map(c => c()));
    vi.restoreAllMocks();
});
function setup(fetcher: typeof fetch = vi.fn(async () => json()), maxActive: 1 | 16 = 1, c = clock()) {
    const t = createModePolicyTransport<ModePolicyOutcome, undefined>({
        profiles: [profile], fetch: fetcher, clock: c.api, maxActive, project: x => Object.freeze(x)
    });
    closers.push(() => t.close());
    return {
        t, c, fetcher, read: (entryTime = 0) => t.read(route, {
            entryTime, context: undefined
        })
    };
}
describe('shared internal policy transport', () => {
    it('uses exactly the trusted A policy path and immutable strict outcome', async () => {
        const x = setup();
        const result = await x.read();
        expect(result.status).toBe(200);
        expect(Object.isFrozen(result)).toBe(true);
        expect(x.fetcher).toHaveBeenCalledWith(profile.apiOrigin + '/api/public/installation-policies/' + id, expect.objectContaining({
            method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'
        }));
    });
    it.each([1, 16] as const)('retains %d unresolved fetch slots beyond outward timeout', async (cap) => {
        const waits = Array.from({
            length: cap
        }, () => deferred<Response>());
        let index = 0;
        const x = setup(vi.fn(() => waits[index++]!.promise), cap);
        const outputs = Array.from({
            length: cap
        }, () => x.read());
        x.c.set(2000);
        x.c.fire();
        expect((await Promise.all(outputs)).every(r => r.status === 503)).toBe(true);
        expect((await x.read(2000)).status).toBe(503);
        expect(x.fetcher).toHaveBeenCalledTimes(cap);
        waits.forEach(w => w.resolve(json()));
        await flush();
        // The document reader can reuse actually settled slots; a child owner closes after its failure.
        const next = deferred<Response>();
        waits.push(next);
        const retry = x.read(2000);
        expect(x.fetcher).toHaveBeenCalledTimes(cap + 1);
        next.resolve(json());
        expect((await retry).status).toBe(200);
    });
    it('retains stream cancellation ownership until the actual cancel promise settles', async () => {
        const cancel = deferred<void>();
        const x = setup(vi.fn(async () => new Response(new ReadableStream({
            cancel: () => cancel.promise
        }), {
            status: 404
        })));
        const first = x.read();
        let settled = false;
        void first.then(() => {
            settled = true;
        });
        await flush();
        expect(settled).toBe(false);
        expect((await x.read()).status).toBe(503);
        expect(x.fetcher).toHaveBeenCalledTimes(1);
        x.c.set(2000);
        x.c.fire();
        expect((await first).status).toBe(503);
        cancel.resolve();
        await flush();
    });
    it('cancel rejection makes future admission terminal', async () => {
        const x = setup(vi.fn(async () => new Response(new ReadableStream({
            cancel: () => Promise.reject(Error('controlled cancel fault'))
        }), {
            status: 404
        })));
        expect((await x.read()).status).toBe(503);
        await flush();
        expect(x.t.isClosed).toBe(true);
        expect((await x.read()).status).toBe(503);
        expect(x.fetcher).toHaveBeenCalledTimes(1);
    });
    it.each([1999, 2000])('pure projection at%d shares the original call-entry budget', async (end) => {
        const c = clock();
        const project = vi.fn((value: ModePolicyOutcome, head: boolean) => {
            if (value.status === 200)
                c.set(end);
            return {
                status: value.status, head
            };
        });
        const t = createModePolicyTransport({
            profiles: [profile], clock: c.api, fetch: async () => json(), maxActive: 16, project
        });
        closers.push(() => t.close());
        const output = await t.read(route, {
            entryTime: 0, context: true
        });
        expect(output).toEqual({
            status: end === 1999 ? 200 : 503, head: true
        });
    });
    it('separate simultaneous HEAD context cannot bleed between projections', async () => {
        const waits = [deferred<Response>(), deferred<Response>()];
        let i = 0;
        const c = clock();
        const t = createModePolicyTransport({
            profiles: [profile], clock: c.api, fetch: () => waits[i++]!.promise, maxActive: 16, project: (x: ModePolicyOutcome, head: boolean) => ({
                status: x.status, head
            })
        });
        closers.push(() => t.close());
        const a = t.read(route, {
            entryTime: 0, context: true
        }), b = t.read(route, {
            entryTime: 0, context: false
        });
        waits[1]!.resolve(json());
        expect(await b).toEqual({
            status: 200, head: false
        });
        waits[0]!.resolve(json());
        expect(await a).toEqual({
            status: 200, head: true
        });
    });
    it('elapsed work before read is not replaced by a fresh window', async () => {
        const x = setup();
        x.c.set(2000);
        expect((await x.read(0)).status).toBe(503);
        expect(x.fetcher).not.toHaveBeenCalled();
    });
    it('future/nonfinite entry cannot manufacture caller time', async () => {
        const x = setup();
        for (const entry of [1, NaN, Infinity, -1])
            expect((await x.read(entry)).status).toBe(503);
        expect(x.fetcher).not.toHaveBeenCalled();
    });
    it('rejects malformed route descriptors without executing their accessors', async () => {
        const x = setup();
        const getter = vi.fn();
        const bad = Object.defineProperty({
            installationId: id
        }, 'mode', {
            enumerable: true, get: getter
        });
        expect((await x.t.read(bad as never, {
            entryTime: 0, context: undefined
        })).status).toBe(503);
        expect(getter).not.toHaveBeenCalled();
        expect(x.fetcher).not.toHaveBeenCalled();
    });
    it('caller abort is no earlier success and owns late body disposal', async () => {
        const late = deferred<Response>();
        const x = setup(() => late.promise);
        const abort = new AbortController();
        const p = x.t.read(route, {
            entryTime: 0, context: undefined, signal: abort.signal
        });
        abort.abort();
        expect((await p).status).toBe(503);
        late.resolve(json());
        await flush();
    });
    it('a terminal failed timer clear prevents further callbacks/fetch growth', async () => {
        const c = clock();
        c.api.clearTimer = () => {
            throw Error('controlled clear failure');
        };
        const x = setup(vi.fn(async () => json()), 1, c);
        for (let i = 0; i < 20; i++)
            expect((await x.read()).status).toBe(503);
        expect(x.fetcher).toHaveBeenCalledTimes(1);
        expect(c.timers.size).toBe(1);
        c.fire();
    });
    it('failed internal projection rejects rather than leaving caller pending', async () => {
        const c = clock();
        const t = createModePolicyTransport({
            profiles: [profile], clock: c.api, maxActive: 1, fetch: async () => json(), project: () => {
                throw Error('controlled internal projector');
            }
        });
        closers.push(() => t.close());
        await expect(t.read(route, {
            entryTime: 0, context: undefined
        })).rejects.toThrow('INVALID_POLICY_PROJECTION');
        expect(t.isClosed).toBe(true);
    });
    it.each([new Response(null, {
            status: 404
        }), json({
            ...policy(), enabled: false
        }), json({
            ...policy(), mode: 'iframe', allowedParentOrigins: ['https://merchant.test']
        })])('valid unavailability is distinguished from malformed policy', async (wire) => {
        const x = setup(async () => wire);
        expect((await x.read()).status).toBe(404);
    });
    it.each([json({
            ...policy(), installationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        }), json({
            ...policy(), extra: true
        }), json({
            ...policy(), enabled: null
        })])('invalid whole policy never projects success', async (wire) => {
        const x = setup(async () => wire);
        expect((await x.read()).status).toBe(503);
    });
});
describe('pre-delivery stream cleanup regression', () => {
    it.each([false, true])('completed reader release failure=%s is observed before success', async (fail) => {
        const bytes = new TextEncoder().encode(JSON.stringify(policy()));
        let done = false;
        const released = vi.fn(() => {
            if (fail)
                throw Error('controlled release fault');
        });
        const fetcher = vi.fn(async () => ({
            status: 200, redirected: false, type: 'basic', headers: new Headers({
                'content-type': 'application/json'
            }), body: {
                getReader: () => ({
                    read: async () => done ? {
                        done: true, value: undefined
                    } : (done = true, {
                        done: false, value: bytes
                    }), releaseLock: released, cancel: async () => {
                    }
                })
            }
        } as unknown as Response));
        const x = setup(fetcher);
        expect((await x.read()).status).toBe(fail ? 503 : 200);
        expect(released).toHaveBeenCalledTimes(1);
        expect(x.t.isClosed).toBe(fail);
        if (fail) {
            expect((await x.read()).status).toBe(503);
            expect(fetcher).toHaveBeenCalledTimes(1);
        }
    });
    it('404 waits for successful cancellation within the same deadline', async () => {
        const cancellation = deferred<void>();
        const x = setup(async () => new Response(new ReadableStream({
            cancel: () => cancellation.promise
        }), {
            status: 404
        }));
        const pending = x.read();
        let done = false;
        void pending.then(() => {
            done = true;
        });
        await flush();
        expect(done).toBe(false);
        x.c.set(1999);
        cancellation.resolve();
        expect((await pending).status).toBe(404);
    });
    it('EOF release consuming the deadline withholds success', async () => {
        const c = clock();
        const bytes = new TextEncoder().encode(JSON.stringify(policy()));
        let done = false;
        const fetcher = async () => ({
            status: 200, redirected: false, type: 'basic', headers: new Headers({
                'content-type': 'application/json'
            }), body: {
                getReader: () => ({
                    read: async () => done ? {
                        done: true, value: undefined
                    } : (done = true, {
                        done: false, value: bytes
                    }), releaseLock: () => c.set(2000), cancel: async () => {
                    }
                })
            }
        } as unknown as Response);
        const x = setup(fetcher, 1, c);
        expect((await x.read()).status).toBe(503);
    });
});
