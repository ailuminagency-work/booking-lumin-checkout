/** Trusted local composition seam only. No transaction-certainty or physical-drain claim. */
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { safeModeError } from './mode-installation-contracts';
import type { ModeSessionClient, ModeSessionPool } from './mode-session-repository';

export interface AdmissionClock {
    monotonic(): number;
    setTimer(callback: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}
export interface AdmissionSnapshot {
    capacity: 8; active: number; quarantined: number; free: number; accepting: boolean;
}
export interface CloseObservation { driverEnd: 'fulfilled' | 'rejected' | 'unobserved'; }
export interface LocalModeSessionAdmission {
    pool: ModeSessionPool;
    snapshot(): Readonly<AdmissionSnapshot>;
    close(): Promise<Readonly<CloseObservation>>;
}
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
const prototype = Object.getPrototypeOf, isProxy = types.isProxy, freeze = Object.freeze;
const nativeClearTimeout = clearTimeout.bind(globalThis);
const nativeClock: AdmissionClock = {
    monotonic: performance.now.bind(performance),
    setTimer: setTimeout.bind(globalThis),
    clearTimer: h => nativeClearTimeout(h as ReturnType<typeof setTimeout>),
};
type Method = (...args: any[]) => any;
type Captured = Record<string, Method>;
type Listener = (...args: any[]) => void;
const owners = new WeakMap<object, { state: 'constructing' | 'failed' | 'ready'; value?: LocalModeSessionAdmission }>();
function safeError(code: string): Error { return new Error(code); }

const queryPairs = new Set([
    '42501/MODE_SESSION_FORBIDDEN', '42501/FORBIDDEN',
    '22023/MODE_SESSION_INVALID', '22023/MODE_SESSION_INVALID_ORIGIN',
    '22023/MODE_REQUEST_INVALID_ANSWERS', '22023/MODE_REQUEST_INVALID_CUSTOMER', '22023/MODE_REQUEST_INVALID_TIME',
    '40001/MODE_SESSION_CONFLICT', '40001/MODE_REQUEST_CONFLICT',
    'P0002/MODE_REQUEST_NOT_FOUND', '54000/MODE_SESSION_LIMIT',
]);
const queryCodes: Readonly<Record<string, string>> = freeze({ '40P01': 'DEADLOCK', '55P03': 'LOCK_TIMEOUT', '57014': 'SERVER_TIMEOUT' });
function queryError(value: unknown): Error {
    const pair = safeModeError(value);
    if (!pair) return safeError('ADMISSION_QUERY_FAILED');
    const [code, label] = pair;
    const canonical = Object.hasOwn(queryCodes, code) ? queryCodes[code] : queryPairs.has(code + '/' + label) ? label : undefined;
    if (!canonical) return safeError('ADMISSION_QUERY_FAILED');
    return Object.assign(new Error(canonical), { code });
}

function capture(value: unknown, names: readonly string[]): Captured {
    if (!value || typeof value !== 'object' || isProxy(value)) throw safeError('ADMISSION_CONSTRUCTION_FAILED');
    const result: Captured = Object.create(null);
    for (const name of names) {
        let cursor: object | null = value;
        for (let depth = 0; cursor && depth < 8; depth++, cursor = prototype(cursor)) {
            if (isProxy(cursor)) throw safeError('ADMISSION_CONSTRUCTION_FAILED');
            const d = descriptor(cursor, name);
            if (!d) continue;
            if (!('value' in d) || typeof d.value !== 'function' || isProxy(d.value)) throw safeError('ADMISSION_CONSTRUCTION_FAILED');
            const method = d.value;
            result[name] = (...args: unknown[]) => apply(method, value, args);
            break;
        }
        if (!result[name]) throw safeError('ADMISSION_CONSTRUCTION_FAILED');
    }
    return result;
}
interface Lease {
    slot: number; state: 'acquiring' | 'client' | 'quarantined';
    delivered: boolean; released: boolean; pending: boolean; ended: boolean;
    raw?: Captured; view?: ModeSessionClient;
    error?: Listener; end?: Listener;
    listeners: { error?: Listener; end?: Listener };
    detachAttempted?: boolean; repairEnd?: boolean; repairError?: boolean;
}

/** Supply one fresh, exclusively owned pool. Never rebuild a pool to evade quarantine. */
export function createLocalModeSessionAdmission(pool: ModeSessionPool, closeClock: AdmissionClock = nativeClock): LocalModeSessionAdmission {
    if (!pool || typeof pool !== 'object' || isProxy(pool)) throw safeError('ADMISSION_CONSTRUCTION_FAILED');
    const prior = owners.get(pool);
    if (prior) {
        if (prior.state === 'ready') return prior.value!;
        throw safeError('ADMISSION_CONSTRUCTION_FAILED');
    }
    // No driver invocation until the complete method sets have been captured.
    const raw = capture(pool, ['connect', 'end', 'on', 'removeListener']);
    const clock = capture(closeClock, ['monotonic', 'setTimer', 'clearTimer']);
    const owned: { state: 'constructing' | 'failed' | 'ready'; value?: LocalModeSessionAdmission } = { state: 'constructing' };
    owners.set(pool, owned);
    const slots: Array<Lease | undefined> = Array(8).fill(undefined);
    const poolListeners = new Set<Listener>();
    let accepting = true;
    let closePromise: Promise<Readonly<CloseObservation>> | undefined;
    let endPromise: Promise<void> | undefined;
    const current = (l: Lease) => slots[l.slot] === l;
    function quarantine(l: Lease) { if (current(l)) l.state = 'quarantined'; }
    function detach(l: Lease): boolean {
        if (!l.raw || l.detachAttempted) return false;
        l.detachAttempted = true;
        const before = l.state;
        const attempted: Array<'end' | 'error'> = [];
        for (const event of ['end', 'error'] as const) {
            const fn = l[event];
            if (!fn) continue;
            attempted.push(event);
            try {
                l.raw.removeListener!(event, fn);
                if (l.state !== before) throw safeError('ADMISSION_DETACH_AMBIGUOUS');
            } catch {
                quarantine(l);
                accepting = false;
                // Broken emitters have only a best-effort bound: at most one repair
                // per possibly removed dispatcher, even if on() attaches then throws.
                for (const repair of attempted) {
                    const flag = repair === 'end' ? 'repairEnd' : 'repairError';
                    if (l[flag]) continue;
                    l[flag] = true;
                    try { l.raw.on!(repair, l[repair]); } catch { /* Never retry. */ }
                }
                void close();
                return false;
            }
        }
        return true;
    }
    function dispatch(l: Lease, event: 'error' | 'end') {
        if (!current(l)) return;
        quarantine(l); // Private observer always runs before a consumer callback.
        if (event === 'end') l.ended = true;
        const fn = l.listeners[event];
        if (fn) { try { apply(fn, l.view, []); } catch { /* Fixed bounded consumer registry; no raw errors. */ } }
        if (event === 'end') detach(l); // Never releases the quarantined charge.
    }
    function release(l: Lease, error?: Error) {
        if (!current(l)) throw safeError('LEASE_INVALID');
        if (l.released) { quarantine(l); throw safeError('LEASE_INVALID'); }
        l.released = true;
        const ordinary = accepting && l.state === 'client' && l.delivered && !l.pending && error === undefined;
        if (!ordinary) quarantine(l);
        try { l.raw!.release!(ordinary ? undefined : safeError('ADMISSION_DISCARDED')); }
        catch { quarantine(l); }
        if (ordinary && l.state === 'client') {
            if (detach(l) && l.state === 'client') {
                slots[l.slot] = undefined;
                l.listeners = {};
                l.raw = undefined;
            } else quarantine(l);
        }
    }
    function clientView(l: Lease): ModeSessionClient {
        const view: ModeSessionClient = {
            query(text, values) {
                if (!current(l) || l.released) return Promise.reject(safeError('LEASE_INVALID'));
                if (!accepting || l.state !== 'client' || l.pending) {
                    quarantine(l); return Promise.reject(safeError('LEASE_INVALID'));
                }
                l.pending = true;
                let pending: unknown;
                try { pending = l.raw!.query!(text, values); }
                catch (error) { quarantine(l); l.pending = false; return Promise.reject(queryError(error)); }
                return Promise.resolve(pending).then(value => {
                    l.pending = false;
                    return value;
                }, error => {
                    l.pending = false; quarantine(l); throw queryError(error);
                });
            },
            release(error) { release(l, error); },
            on(event, fn) {
                if (!current(l) || l.released || l.ended) throw safeError('LEASE_INVALID');
                if ((event !== 'error' && event !== 'end') || typeof fn !== 'function') throw safeError('LEASE_INVALID');
                const old = l.listeners[event];
                if (old && old !== fn) throw safeError('LEASE_INVALID');
                l.listeners[event] = fn;
                return view;
            },
            removeListener(event, fn) {
                if (event !== 'error' && event !== 'end') throw safeError('LEASE_INVALID');
                if (l.listeners[event] === fn) delete l.listeners[event];
                return view;
            },
        };
        return freeze(view);
    }
    function close(): Promise<Readonly<CloseObservation>> {
        if (closePromise) return closePromise;
        let resolveClose!: (v: Readonly<CloseObservation>) => void;
        let resolveEnd!: () => void;
        closePromise = new Promise(r => { resolveClose = r; });
        endPromise = new Promise(r => { resolveEnd = r; });
        accepting = false;
        for (const l of slots) if (l) quarantine(l);
        let settled = false, timer: unknown, hasTimer = false, cleaned = false;
        let last = -Infinity, cutoff = 0;
        const sample = () => {
            const n = clock.monotonic!();
            if (!Number.isFinite(n) || n < 0 || n < last) throw safeError('ADMISSION_CLOCK_FAILED');
            last = n; return n as number;
        };
        const cleanup = () => {
            if (!hasTimer || cleaned) return;
            cleaned = true;
            try { clock.clearTimer!(timer); } catch { /* Observation fact is already settled. */ }
        };
        const finish = (driverEnd: CloseObservation['driverEnd']) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolveClose(freeze({ driverEnd })); resolveEnd();
        };
        try {
            cutoff = sample() + 10000;
            if (!Number.isFinite(cutoff)) throw safeError('ADMISSION_CLOCK_FAILED');
            let arming = true;
            try {
                timer = clock.setTimer!(() => {
                    if (settled) return;
                    if (!arming) { try { sample(); } catch { /* Unobserved either way. */ } }
                    finish('unobserved');
                }, Math.max(0, cutoff - sample()));
                hasTimer = true;
            } finally { arming = false; }
            if (settled) cleanup();
        } catch { finish('unobserved'); }
        const outcome = (kind: 'fulfilled' | 'rejected') => {
            if (settled) return;
            try { finish(sample() < cutoff ? kind : 'unobserved'); }
            catch { finish('unobserved'); }
        };
        try {
            const result = raw.end!();
            if (!result || typeof result.then !== 'function') outcome('rejected');
            else Promise.resolve(result).then(() => outcome('fulfilled'), () => outcome('rejected'));
        } catch { outcome('rejected'); }
        return closePromise;
    }
    const poolView: ModeSessionPool = freeze({
        async connect() {
            if (!accepting) throw safeError('ADMISSION_CLOSED');
            const slot = slots.findIndex(v => v === undefined);
            if (slot < 0) throw safeError('ADMISSION_EXHAUSTED');
            const l: Lease = { slot, state: 'acquiring', delivered: false, released: false, pending: false, ended: false, listeners: {} };
            slots[slot] = l;
            let client: unknown;
            try { client = await raw.connect!(); }
            catch { quarantine(l); throw safeError('ADMISSION_ACQUISITION_FAILED'); }
            try {
                l.raw = capture(client, ['query', 'release', 'on', 'removeListener']);
                l.view = clientView(l);
                l.error = () => dispatch(l, 'error'); l.end = () => dispatch(l, 'end');
                l.raw.on!('error', l.error); l.raw.on!('end', l.end);
                if (!accepting || l.state === 'quarantined') {
                    quarantine(l); release(l, safeError('ADMISSION_CLOSED')); throw safeError('ADMISSION_CLOSED');
                }
                l.state = 'client'; l.delivered = true;
                return l.view;
            } catch {
                quarantine(l);
                if (l.raw && !l.released) { try { release(l, safeError('ADMISSION_DISCARDED')); } catch { /* Permanent charge. */ } }
                throw safeError('ADMISSION_ACQUISITION_FAILED');
            }
        },
        end() { close(); return endPromise!; },
        on(event: string, fn: Listener) {
            if (event !== 'error' || typeof fn !== 'function') throw safeError('LEASE_INVALID');
            if (!poolListeners.has(fn) && poolListeners.size >= 2) throw safeError('LEASE_INVALID');
            poolListeners.add(fn); return poolView;
        },
        removeListener(event: string, fn: Listener) {
            if (event !== 'error') throw safeError('LEASE_INVALID');
            poolListeners.delete(fn); return poolView;
        },
    });
    const poolError = () => { for (const fn of [...poolListeners]) { try { apply(fn, poolView, []); } catch { /* No reflection. */ } } };
    const facade: LocalModeSessionAdmission = freeze({
        pool: poolView, close,
        snapshot() {
            const active = slots.filter(l => l && l.state !== 'quarantined').length;
            const quarantined = slots.filter(l => l?.state === 'quarantined').length;
            return freeze({ capacity: 8 as const, active, quarantined, free: 8 - active - quarantined, accepting });
        },
    });
    try { raw.on!('error', poolError); }
    catch {
        owned.state = 'failed'; accepting = false;
        try { raw.removeListener!('error', poolError); } catch { /* Safe private consumer may remain. */ }
        void close(); throw safeError('ADMISSION_CONSTRUCTION_FAILED');
    }
    owned.state = 'ready'; owned.value = facade;
    return facade;
}
