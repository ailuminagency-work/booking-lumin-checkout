import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createModeController, type ModeController } from '../src/modeController';
import type { ModePolicyClock } from '../src/modePolicyTransport';
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
    JSDOM: new (html: string, options: object) => {
        window: Window & {
            close(): void;
        };
    };
};
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const version = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const R = 'https://renderer.test', M = 'https://merchant.test';
const profile = {
    profileVersion: 'runtime-v1', rendererOrigin: R, apiOrigin: 'https://api.test', portalOrigin: 'https://portal.test', loaderUrl: R + '/assets/booking-lumin-loader.' + 'a'.repeat(64) + '.js'
};
function policy(extra: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1, installationId: id, mode: 'iframe', deploymentProfileVersion: profile.profileVersion, rendererOrigin: R, apiOrigin: profile.apiOrigin, loaderUrl: profile.loaderUrl, currentVersionId: version, targetRevision: 1, policyRevision: 1, allowedParentOrigins: [M], enabled: true, ...extra
    };
}
function response(value: unknown = policy()) {
    return new Response(JSON.stringify(value), {
        headers: {
            'content-type': 'application/json'
        }
    });
}
function deferred<T>() {
    let resolve!: (x: T) => void;
    let reject!: (x: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return {
        promise, resolve, reject
    };
}
async function flush() {
    for (let i = 0; i < 32; i++)
        await Promise.resolve();
}
function clock() {
    let now = 0, sequence = 0;
    const timers = new Map<number, {
        at: number;
        callback: () => void;
    }>();
    const api: ModePolicyClock = {
        now: () => now, setTimer(callback, delay) {
            const id = ++sequence;
            timers.set(id, {
                at: now + delay, callback
            });
            return id;
        }, clearTimer(id) {
            timers.delete(id as number);
        }
    };
    return {
        api, timers, set(value: number) {
            now = value;
        }, advance(value: number) {
            now = value;
            for (const [id, t] of [...timers])
                if (t.at <= value) {
                    timers.delete(id);
                    t.callback();
                }
        }
    };
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    await Promise.all(cleanup.splice(0).map(fn => fn()));
    vi.restoreAllMocks();
});
function setup(options: {
    mode?: 'hosted' | 'iframe';
    fetcher?: typeof fetch;
    initial?: Record<string, unknown>;
    noParent?: boolean;
    failDiagnostic?: boolean;
} = {}) {
    const mode = options.mode ?? 'iframe';
    const c = clock();
    const outer = new JSDOM('<!doctype html><body></body>', {
        url: mode === 'hosted' ? R + '/checkout/flow/' + id : M, pretendToBeVisual: true
    });
    let win = outer.window;
    if (mode === 'iframe' && !options.noParent) {
        const frame = win.document.createElement('iframe');
        frame.src = R + '/embed/flow/' + id;
        win.document.body.append(frame);
        win = frame.contentWindow!;
    }
    else if (mode === 'iframe') {
        outer.window.history.replaceState(null, '', '/embed/flow/' + id);
    }
    if (!win.document.body) {
        win.document.open();
        win.document.write('<!doctype html><html><body></body></html>');
        win.document.close();
    }
    let hidden = false;
    Object.defineProperty(win.document, 'hidden', {
        configurable: true, get: () => hidden
    });
    const data = policy({
        mode, allowedParentOrigins: mode === 'hosted' ? [] : [M], ...options.initial
    });
    win.document.body.innerHTML = '<template id="lumin-mode-bootstrap"></template><p>Booking experience is not available yet.</p>';
    (win.document.querySelector('template') as HTMLTemplateElement).content.textContent = JSON.stringify({
        schemaVersion: 1, kind: 'installation_document', operational: false, policy: data
    });
    let measure = () => {
    };
    const disconnect = vi.fn();
    Object.defineProperty(win, 'ResizeObserver', {
        configurable: true, value: class {
            constructor(fn: () => void) {
                measure = fn;
            }
            observe() {
            }
            disconnect = disconnect;
        }
    });
    const post = vi.spyOn(win.parent, 'postMessage').mockImplementation(() => {
    });
    const fetcher = options.fetcher ?? vi.fn(async () => response(data));
    const addListeners = vi.spyOn(win, 'addEventListener');
    if (options.failDiagnostic)
        vi.spyOn(win.document.documentElement, 'setAttribute').mockImplementation(() => {
            throw Error('controlled DOM diagnostic fault');
        });
    const controller = createModeController({
        profile, window: win, fetch: fetcher, clock: c.api
    });
    cleanup.push(async () => {
        await controller.dispose();
        outer.window.close();
    });
    const message = (patch: Record<string, unknown> = {}, origin = M, source: MessageEventSource | null = win.parent) => {
        const Message = (win as unknown as {
            MessageEvent: typeof MessageEvent;
        }).MessageEvent;
        win.dispatchEvent(new Message('message', {
            data: {
                type: 'lumin:init', protocolVersion: 1, installationId: id, instanceId: 'a'.repeat(32), ...patch
            }, origin, source
        }));
    };
    return {
        win, c, controller, fetcher, post, disconnect, message, addListeners, measure: () => measure(), visible(value: boolean) {
            hidden = !value;
            win.document.dispatchEvent(new (win as unknown as {
                Event: typeof Event;
            }).Event('visibilitychange'));
        }
    };
}
describe('child distribution controller (controlled DOM/clock seams, not browser authentication proof)', () => {
    it('registers before pending policy, coalesces one init, emits one correlated ready and never becomes operational', async () => {
        const late = deferred<Response>();
        const x = setup({
            fetcher: vi.fn(() => late.promise)
        });
        x.message();
        x.message();
        expect(x.controller.state).toBe('STARTING_POLICY');
        expect(x.post).not.toHaveBeenCalled();
        late.resolve(response());
        await flush();
        expect(x.controller.state).toBe('READY');
        expect(x.post.mock.calls.filter(c => (c[0] as {
            type: string;
        }).type === 'lumin:ready')).toHaveLength(1);
        expect(x.post.mock.calls[0]).toEqual([{
                type: 'lumin:ready', protocolVersion: 1, installationId: id, instanceId: 'a'.repeat(32)
            }, M]);
        x.message();
        expect(x.post.mock.calls.filter(c => (c[0] as {
            type: string;
        }).type === 'lumin:ready')).toHaveLength(1);
        expect(x.controller.operational).toBe(false);
        expect(x.win.document.documentElement.dataset.bookingLuminState).toBe('ready');
        expect(x.win.document.documentElement.dataset.bookingLuminOperational).toBe('false');
        expect(x.fetcher).toHaveBeenCalledTimes(1);
    });
    it('hosted policy becomes ready without a channel, resize observer or parent message', async () => {
        const x = setup({
            mode: 'hosted'
        });
        await flush();
        expect(x.controller.state).toBe('READY');
        expect(x.post).not.toHaveBeenCalled();
        x.measure();
        expect(x.post).not.toHaveBeenCalled();
    });
    it('uses first fresh policy rather than historical bootstrap revisions', async () => {
        const x = setup({
            fetcher: vi.fn(async () => response(policy({
                targetRevision: 2, policyRevision: 2, currentVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
            })))
        });
        x.message();
        await flush();
        expect(x.controller.state).toBe('READY');
    });
    it.each([1999, 2000])('fresh response at%d respects one total read deadline', async (ms) => {
        const late = deferred<Response>();
        const x = setup({
            fetcher: () => late.promise
        });
        x.message();
        x.c.set(ms);
        late.resolve(response());
        await flush();
        expect(x.controller.state).toBe(ms === 1999 ? 'READY' : 'TERMINAL');
    });
    it.each([4999, 5000])('pending init at%d respects fixed child-entry handshake deadline', async (ms) => {
        const x = setup();
        await flush();
        expect(x.controller.state).toBe('AWAITING_INIT');
        x.c.set(ms);
        x.message();
        expect(x.controller.state).toBe(ms === 4999 ? 'READY' : 'TERMINAL');
    });
    it('no init times out once, removes listeners and cannot revive', async () => {
        const x = setup();
        await flush();
        x.c.advance(5000);
        expect(x.controller.state).toBe('TERMINAL');
        x.message();
        expect(x.post).not.toHaveBeenCalled();
        expect(x.c.timers.size).toBe(0);
    });
    it('bad messages cannot replace an admitted pending instance', async () => {
        const late = deferred<Response>();
        const x = setup({
            fetcher: () => late.promise
        });
        x.message({}, M, null);
        x.message({
            extra: 'x'
        });
        x.message({
            installationId: 'x'
        });
        x.message({}, 'null');
        x.message();
        x.message({
            instanceId: 'b'.repeat(32)
        });
        late.resolve(response());
        await flush();
        expect(x.controller.state).toBe('READY');
        expect(x.post.mock.calls[0]?.[0]).toMatchObject({
            instanceId: 'a'.repeat(32)
        });
    });
    it('ten structurally valid wrong-origin attempts consume the window without replacing pending state', async () => {
        const x = setup();
        await flush();
        for (let i = 0; i < 10; i++)
            x.message({}, profile.rendererOrigin);
        x.message();
        expect(x.controller.state).toBe('AWAITING_INIT');
        expect(x.post).not.toHaveBeenCalled();
        x.c.advance(5000);
        expect(x.controller.state).toBe('TERMINAL');
    });
    it.each([{
            enabled: false
        }, {
            policyRevision: 2
        }, {
            targetRevision: 2
        }, {
            currentVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        }])('observed policy transition is terminal: %j', async (change) => {
        const fetcher = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(policy(change)));
        const x = setup({
            fetcher
        });
        x.message();
        await flush();
        expect(x.controller.state).toBe('READY');
        x.c.advance(30000);
        await flush();
        expect(x.controller.state).toBe('TERMINAL');
        expect(fetcher).toHaveBeenCalledTimes(2);
        x.message();
        expect(x.post.mock.calls.filter(c => (c[0] as {
            type: string;
        }).type === 'lumin:ready')).toHaveLength(1);
    });
    it('suspends while hidden then coalesces one actual refresh, never another ready', async () => {
        const x = setup();
        x.message();
        await flush();
        x.visible(false);
        x.c.advance(30000);
        await flush();
        expect(x.fetcher).toHaveBeenCalledTimes(1);
        x.visible(true);
        await flush();
        expect(x.fetcher).toHaveBeenCalledTimes(2);
        expect(x.controller.state).toBe('READY');
        expect(x.post.mock.calls.filter(c => (c[0] as {
            type: string;
        }).type === 'lumin:ready')).toHaveLength(1);
    });
    it('hidden initial policy cannot release pending init until visible fresh policy completes', async () => {
        const first = deferred<Response>(), second = deferred<Response>();
        const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const x = setup({
            fetcher
        });
        x.message();
        x.visible(false);
        first.resolve(response());
        await flush();
        expect(x.post).not.toHaveBeenCalled();
        x.visible(true);
        await flush();
        expect(fetcher).toHaveBeenCalledTimes(2);
        second.resolve(response());
        await flush();
        expect(x.controller.state).toBe('READY');
    });
    it('visibility during a held refresh queues at most one further read', async () => {
        const late = deferred<Response>();
        const fetcher = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(late.promise).mockResolvedValue(response());
        const x = setup({
            fetcher
        });
        x.message();
        await flush();
        x.c.advance(30000);
        x.visible(false);
        x.visible(true);
        x.visible(false);
        x.visible(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
        late.resolve(response());
        await flush();
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it('limits resize to four fixed-window sends and one latest trailing value', async () => {
        const x = setup();
        let height = 400;
        Object.defineProperty(x.win.document.documentElement, 'scrollHeight', {
            get: () => height, configurable: true
        });
        x.message();
        await flush();
        for (height = 500; height <= 1000; height += 100)
            x.measure();
        const sizes = () => x.post.mock.calls.filter(c => (c[0] as {
            type: string;
        }).type === 'lumin:resize').map(c => (c[0] as {
            height: number;
        }).height);
        expect(sizes()).toEqual([400, 500, 600, 700]);
        x.c.advance(1000);
        expect(sizes()).toEqual([400, 500, 600, 700, 1000]);
        height = 3000;
        x.measure();
        expect(sizes().at(-1)).toBe(1600);
        height = 0;
        x.measure();
        expect(sizes().at(-1)).toBe(320);
    });
    it('dispose and pagehide invalidate late reads, timers, observers and repeated close', async () => {
        const late = deferred<Response>();
        const x = setup({
            fetcher: () => late.promise
        });
        x.message();
        const closing = x.controller.dispose();
        expect(x.controller.dispose()).toBe(closing);
        late.resolve(response());
        await closing;
        await flush();
        expect(x.controller.state).toBe('TERMINAL');
        expect(x.post).not.toHaveBeenCalled();
        expect(x.c.timers.size).toBe(0);
    });
    it('pagehide after ready disconnects observation and cannot be revived by persisted pageshow', async () => {
        const x = setup();
        x.message();
        await flush();
        x.win.dispatchEvent(new (x.win as unknown as {
            Event: typeof Event;
        }).Event('pagehide'));
        x.win.dispatchEvent(new (x.win as unknown as {
            Event: typeof Event;
        }).Event('pageshow'));
        expect(x.controller.state).toBe('TERMINAL');
        expect(x.disconnect).toHaveBeenCalledTimes(1);
        const count = x.post.mock.calls.length;
        x.measure();
        x.message();
        expect(x.post).toHaveBeenCalledTimes(count);
    });
    it('terminal backward clock cannot establish a new baseline', async () => {
        const x = setup();
        x.message();
        await flush();
        x.c.set(100);
        x.measure();
        x.c.set(99);
        x.measure();
        expect(x.controller.state).toBe('TERMINAL');
    });
});
describe('single child owner across bundle evaluations', () => {
    it('same factory and separately evaluated module reuse ready and terminal ownership without reads', async () => {
        const x = setup();
        x.message();
        await flush();
        const extra = vi.fn(async () => response());
        expect(createModeController({
            profile, window: x.win, fetch: extra, clock: x.c.api
        })).toBe(x.controller);
        vi.resetModules();
        const independent = await import('../src/modeController');
        expect(independent.createModeController({
            profile, window: x.win, fetch: extra, clock: x.c.api
        })).toBe(x.controller);
        expect(extra).not.toHaveBeenCalled();
        await x.controller.dispose();
        expect(independent.createModeController({
            profile, window: x.win, fetch: extra, clock: x.c.api
        })).toBe(x.controller);
        expect(extra).not.toHaveBeenCalled();
        const descriptor = Object.getOwnPropertyDescriptor(x.win, Symbol.for('booking-lumin.controller-owner.v1'))!;
        expect(descriptor).toMatchObject({
            writable: false, configurable: false, enumerable: false
        });
        expect(Object.isFrozen(descriptor.value)).toBe(true);
    });
    it('incompatible registration rejects without closing the first owner or reading', async () => {
        const x = setup();
        x.message();
        await flush();
        const extra = vi.fn(async () => response());
        expect(() => createModeController({
            profile: {
                ...profile, profileVersion: 'other'
            }, window: x.win, fetch: extra
        })).toThrow('INVALID_MODE_CONTROLLER_CONFIGURATION');
        expect(extra).not.toHaveBeenCalled();
        expect(x.controller.state).toBe('READY');
    });
    it.each(['accessor', 'unknown', 'writable'])('a%s coordinator collision cannot execute or start work', kind => {
        const dom = new JSDOM('<!doctype html><body></body>', {
            url: R + '/checkout/flow/' + id, pretendToBeVisual: true
        });
        const getter = vi.fn();
        Object.defineProperty(dom.window, Symbol.for('booking-lumin.controller-owner.v1'), kind === 'accessor' ? {
            get: getter
        } : {
            value: Object.freeze({
                unknown: true
            }), writable: kind === 'writable'
        });
        const fetcher = vi.fn(async () => response());
        expect(() => createModeController({
            profile, window: dom.window, fetch: fetcher
        })).toThrow();
        expect(fetcher).not.toHaveBeenCalled();
        expect(getter).not.toHaveBeenCalled();
        dom.window.close();
    });
});
it('initial diagnostic failure is terminal before any lifecycle or message listener is added', async () => {
    const x = setup({
        failDiagnostic: true
    });
    await flush();
    expect(x.controller.state).toBe('TERMINAL');
    expect(x.fetcher).not.toHaveBeenCalled();
    expect(x.addListeners.mock.calls.filter(call => call[0] === 'message' || call[0] === 'pagehide')).toHaveLength(0);
});
