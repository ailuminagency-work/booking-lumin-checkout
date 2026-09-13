/** Memory-only internal delivery coordination. No HTTP, submission or pool ownership. */
import { randomBytes, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { createModeSessionContracts, modeRecord, sessionCanonical, sessionMicros, type ModeSessionContext, type ModeSessionIssueReceipt, type ModeSessionIssueRequest } from './mode-session-contracts';
import type { ModeSessionClock, ModeSessionOptions, ModeSessionRepository } from './mode-session-repository';
import type { ExistingModeSessionValidator } from './mode-session-validation';

export type DeliveryState = 'prepared' | 'issuing' | 'recoverable' | 'recovering' | 'accepted' | 'validating' | 'acked' | 'terminal' | 'unavailable';
export type DeliveryCertainty = 'not_observed' | 'unknown' | 'known_committed' | 'unavailable';
export type DeliveryCode = 'READY' | 'BUSY' | 'WAIT_CANCELLED' | 'WAIT_DEADLINE' | 'RECOVERY_REQUIRED' | 'REDELIVERY_REQUIRED' | 'ACKED' | 'INVALID_REQUEST' | 'UNAVAILABLE' | 'CAPACITY' | 'ENTROPY_UNAVAILABLE' | 'OPERATION_FAILED' | 'OPERATION_DEADLINE' | 'VALIDATION_UNAVAILABLE' | 'COMMITTED_UNAVAILABLE' | 'CLOSED' | 'CLOCK_UNAVAILABLE' | 'EXPIRED';
export type DeliveryStatus = Readonly<{ kind: 'status'; state: DeliveryState; issuance: DeliveryCertainty; code: DeliveryCode }>;
export type DeliveryResult = DeliveryStatus | Readonly<{ kind: 'delivery'; issuance: 'known_committed'; deliveryId: string; body: string }>;
export type PreparationResult = DeliveryStatus | Readonly<{ kind: 'prepared'; capability: string }>;
export interface ModeSessionDeliveryCoordinator {
    prepare(request: unknown): PreparationResult;
    issue(capability: unknown, options?: ModeSessionOptions): Promise<DeliveryResult>;
    recover(capability: unknown, options?: ModeSessionOptions): Promise<DeliveryResult>;
    deliver(capability: unknown, options?: ModeSessionOptions): Promise<DeliveryResult>;
    wait(capability: unknown, options?: ModeSessionOptions): Promise<DeliveryResult>;
    acknowledge(capability: unknown, deliveryId: unknown): DeliveryStatus;
    close(): void;
}
export const DELIVERY_BOUNDS = Object.freeze({ entries: 16, owners: 2, receiptBytes: 1048576, bodyBytes: 1049600, metadataBytes: 8192, entryBytes: 2106368, ownerBytes: 2099200, totalBytes: 37900288, lifetimeMs: 900000, operationMs: 10000 });
const freeze = Object.freeze, descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys;
const isProxy = types.isProxy, isBuffer = Buffer.isBuffer, from = Buffer.from.bind(Buffer);
const stringify = JSON.stringify, byteLength = Buffer.byteLength.bind(Buffer), bufferString = Buffer.prototype.toString;
const random = randomBytes, hash = createHash;
const nativeMono = performance.now.bind(performance), nativeWall = Date.now.bind(Date);
const nativeSet = setTimeout.bind(globalThis), nativeClear = clearTimeout.bind(globalThis);
const nativeClock: ModeSessionClock = { monotonic: nativeMono, wall: nativeWall, setTimer: (fn, ms) => nativeSet(fn, ms), clearTimer: h => nativeClear(h as ReturnType<typeof setTimeout>) };
const signalGet = descriptor(AbortSignal.prototype, 'aborted')!.get!;
const signalOn = EventTarget.prototype.addEventListener, signalOff = EventTarget.prototype.removeEventListener;
const signalAbort = AbortController.prototype.abort;
const digest = (text: string) => hash('sha256').update(text, 'utf8').digest('hex');
const status = (state: DeliveryState, issuance: DeliveryCertainty, code: DeliveryCode): DeliveryStatus => freeze({ kind: 'status', state, issuance, code });
const unavailable = () => status('unavailable', 'unavailable', 'UNAVAILABLE');
function canonicalSecret(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error();
    const bytes = from(value, 'base64url');
    if (bytes.length !== 32 || bufferString.call(bytes, 'base64url') !== value) throw Error();
    return value;
}
function signalOption(value: unknown): AbortSignal | undefined {
    try { modeRecord(value, []); return undefined; } catch { /* Nonempty options require one native signal. */ }
    const signal = modeRecord(value, ['signal']).signal;
    if (!signal || typeof signal !== 'object' || isProxy(signal)) throw Error();
    signalGet.call(signal);
    return signal as AbortSignal;
}
function opaque(value: unknown): ModeSessionContext {
    modeRecord(value, []);
    return value as ModeSessionContext;
}
function field(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object' || isProxy(value)) throw Error();
    const d = descriptor(value, key);
    if (!d || !('value' in d) || !d.enumerable) throw Error();
    return d.value;
}
type Timer = { live: boolean; armed: boolean; handle?: unknown };
type Method = 'issue' | 'recover' | 'deliver';
type Owner = { method: Method; controller: AbortController; started?: number; dispatched: boolean; consumed: boolean; finishing: boolean; timer?: Timer };
type Waiter = { live: boolean; resolve: (value: DeliveryResult) => void; signal?: AbortSignal; listener?: () => void; attached: boolean; timer?: Timer };
type Entry = {
    state: DeliveryState; certainty: Exclude<DeliveryCertainty, 'unavailable'>; code: DeliveryCode;
    request?: ModeSessionIssueRequest; key?: string; deliveryKey?: string; deliveryId?: string; mono?: number; wall?: bigint;
    expiry?: bigint; expiryMono?: number; expiryBudget?: number; expiryTimer?: Timer; timer?: Timer; owner?: Owner; waiter?: Waiter; offered: boolean;
    token?: string; session?: ModeSessionContext; attempt?: ModeSessionContext;
    baseline?: Readonly<{ sessionId: string; issuedAt: string; expiresAt: string }>;
    canonical?: string; body?: string;
};

export function createModeSessionDeliveryCoordinator({ repository, validator, profiles, clock = nativeClock, entropy = () => random(32) }: {
    repository: Pick<ModeSessionRepository, 'issue' | 'recoverIssue'>;
    validator: Pick<ExistingModeSessionValidator, 'validateExisting'>;
    profiles: unknown; clock?: ModeSessionClock; entropy?: () => Buffer;
}): ModeSessionDeliveryCoordinator {
    const contracts = createModeSessionContracts(profiles);
    const issue = repository.issue.bind(repository), recover = repository.recoverIssue.bind(repository);
    const validate = validator.validateExisting.bind(validator);
    const mono = clock.monotonic.bind(clock), wall = clock.wall.bind(clock);
    const setTimer = clock.setTimer.bind(clock), clearTimer = clock.clearTimer.bind(clock), entropyCall = entropy;
    const entries = new Set<Entry>(), byCapability = new Map<string, Entry>(), identities = new Set<string>(), owners = new Set<Owner>();
    let reservedBytes = 0, closed = false, clockFailed = false, stopping = false;
    let lastMono = -Infinity, lastWall: bigint | undefined;
    const own = (e: Entry, o?: Owner) => entries.has(e) && (!o || e.owner === o && owners.has(o) && !o.consumed);
    const snapshot = (e: Entry, code = e.code) => status(e.state, e.certainty, code);
    function clear(t?: Timer) {
        if (!t) return;
        t.live = false;
        if (!t.armed) return;
        t.armed = false;
        try { clearTimer(t.handle); } catch { stopAll('CLOCK_UNAVAILABLE'); }
        t.handle = undefined;
    }
    function forgetCredentials(e: Entry) {
        e.token = undefined; e.session = undefined; e.attempt = undefined;
        e.baseline = undefined; e.canonical = undefined; e.body = undefined;
    }
    function releaseEntry(e: Entry) {
        if (!entries.has(e) || e.owner) return;
        entries.delete(e);
        if (e.key && byCapability.get(e.key) === e) byCapability.delete(e.key);
        if (e.key) identities.delete(e.key);
        if (e.deliveryKey) identities.delete(e.deliveryKey);
        reservedBytes -= DELIVERY_BOUNDS.entryBytes;
        clear(e.timer); clear(e.expiryTimer); forgetCredentials(e); e.request = undefined;
    }
    function cleanupWaiter(w: Waiter) {
        clear(w.timer);
        if (w.attached && w.signal && w.listener) {
            w.attached = false;
            try { signalOff.call(w.signal, 'abort', w.listener); } catch { stopAll('CLOCK_UNAVAILABLE'); }
        }
    }
    function takeWaiter(e: Entry): Waiter | undefined {
        const w = e.waiter;
        if (!w?.live) return undefined;
        w.live = false; e.waiter = undefined;
        return w;
    }
    function settleStatus(e: Entry, code = e.code) {
        const w = takeWaiter(e);
        if (!w) return;
        cleanupWaiter(w);
        if (!closed && own(e) && e.state !== 'terminal') check(e, e.owner);
        w.resolve(snapshot(e, e.state === 'terminal' ? e.code : code));
    }
    function latchTerminal(e: Entry, reason: DeliveryCode) {
        if (!entries.has(e)) return;
        if (e.state !== 'terminal') {
            e.state = 'terminal'; e.code = reason;
            if (e.certainty !== 'known_committed' && e.owner?.dispatched && e.owner.method !== 'deliver') e.certainty = 'unknown';
        }
        forgetCredentials(e);
    }
    function terminal(e: Entry, reason: DeliveryCode) {
        if (!entries.has(e)) return;
        latchTerminal(e, reason);
        settleStatus(e);
        clear(e.expiryTimer);
        if (closed) clear(e.timer);
        clear(e.owner?.timer);
        if (e.owner) {
            try { signalAbort.call(e.owner.controller); } catch { /* Stop is already latched. */ }
        }
    }
    function stopAll(reason: 'CLOSED' | 'CLOCK_UNAVAILABLE') {
        if (reason === 'CLOCK_UNAVAILABLE') clockFailed = true;
        closed = true;
        if (stopping) return;
        stopping = true;
        const stopped = [...entries];
        for (const e of stopped) latchTerminal(e, reason);
        for (const e of stopped) terminal(e, reason);
        stopping = false;
    }
    function sample(): { mono: number; wall: bigint } {
        if (closed) throw Error();
        try {
            const m = mono();
            if (closed) throw Error();
            const w = wall();
            if (closed) throw Error();
            if (!Number.isFinite(m) || m < 0 || m < lastMono || !Number.isSafeInteger(w)) throw Error();
            const b = BigInt(w);
            if (lastWall !== undefined && b < lastWall) throw Error();
            lastMono = m; lastWall = b;
            return { mono: m, wall: b };
        } catch {
            if (!closed) stopAll('CLOCK_UNAVAILABLE');
            throw Error();
        }
    }
    function retentionEnded(e: Entry, now: { mono: number; wall: bigint }) {
        return e.mono !== undefined && (now.mono - e.mono >= 900000 || now.wall - e.wall! >= 900000n);
    }
    function expired(e: Entry, now: { mono: number; wall: bigint }) {
        return retentionEnded(e, now) || e.expiry !== undefined && now.wall * 1000n >= e.expiry
            || e.expiryMono !== undefined && now.mono - e.expiryMono >= e.expiryBudget!;
    }
    function prune(now: { mono: number; wall: bigint }) {
        for (const e of [...entries]) {
            if (expired(e, now)) {
                terminal(e, 'EXPIRED');
                if (!e.owner && retentionEnded(e, now)) releaseEntry(e);
            }
        }
    }
    function check(e: Entry, o?: Owner): boolean {
        if (closed || !own(e, o)) return false;
        let now;
        try { now = sample(); } catch { return false; }
        if (closed || !own(e, o)) return false;
        if (expired(e, now)) terminal(e, 'EXPIRED');
        else if (o?.started !== undefined && now.mono - o.started >= 10000) terminal(e, 'OPERATION_DEADLINE');
        return !closed && own(e, o) && e.state !== 'terminal';
    }
    function arm(install: (timer: Timer) => void, callback: () => void, delay: number) {
        const timer: Timer = { live: true, armed: false };
        install(timer);
        try {
            const handle = setTimer(() => {
                if (!timer.live) return;
                timer.live = false;
                callback();
            }, Math.max(0, delay));
            timer.handle = handle; timer.armed = true;
            if (!timer.live) clear(timer);
        } catch { timer.live = false; stopAll('CLOCK_UNAVAILABLE'); }
    }
    function entropyValue(): string {
        const value = entropyCall();
        if (closed) throw Error();
        if (!value || isProxy(value) || !isBuffer(value) || ownKeys(value).length !== 32) throw Error();
        const bytes: number[] = [];
        for (let i = 0; i < 32; i++) {
            const d = descriptor(value, String(i));
            if (!d || !('value' in d) || !Number.isInteger(d.value) || d.value < 0 || d.value > 255) throw Error();
            bytes.push(d.value);
        }
        return bufferString.call(from(bytes), 'base64url');
    }
    function prepare(raw: unknown): PreparationResult {
        const failed = (code: DeliveryCode) => status('unavailable', 'not_observed', code);
        if (closed) return failed(clockFailed ? 'CLOCK_UNAVAILABLE' : 'CLOSED');
        if (entries.size >= 16 || reservedBytes + DELIVERY_BOUNDS.entryBytes > DELIVERY_BOUNDS.totalBytes) return failed('CAPACITY');
        const e: Entry = { state: 'prepared', certainty: 'not_observed', code: 'READY', offered: false };
        entries.add(e); reservedBytes += DELIVERY_BOUNDS.entryBytes;
        let failure: DeliveryCode = 'INVALID_REQUEST';
        try {
            e.request = contracts.issue(raw);
            const now = sample();
            prune(now);
            if (closed || !own(e) || e.state !== 'prepared') throw Error();
            e.mono = now.mono; e.wall = now.wall;
            failure = 'ENTROPY_UNAVAILABLE';
            const capability = entropyValue();
            if (closed || !own(e) || e.state !== 'prepared') throw Error();
            const id = entropyValue();
            if (closed || !own(e) || e.state !== 'prepared') throw Error();
            const key = digest('mode-session-delivery-capability:v1:' + capability);
            const deliveryKey = digest('mode-session-delivery-capability:v1:' + id);
            if (capability === id || identities.has(key) || identities.has(deliveryKey)) throw Error();
            e.key = key; e.deliveryKey = deliveryKey; e.deliveryId = id;
            byCapability.set(key, e); identities.add(key); identities.add(deliveryKey);
            failure = 'CLOCK_UNAVAILABLE';
            arm(t => e.timer = t, () => { if (own(e)) { terminal(e, 'EXPIRED'); try { if (retentionEnded(e, sample()) && !e.owner) releaseEntry(e); } catch { /* Global stop owns cleanup. */ } } }, 900000 - (sample().mono - e.mono));
            if (!check(e) || e.state !== 'prepared') throw Error();
            return freeze({ kind: 'prepared', capability });
        } catch {
            const code = e.state === 'terminal' ? e.code : closed ? clockFailed ? 'CLOCK_UNAVAILABLE' : 'CLOSED' : failure;
            releaseEntry(e);
            return failed(code);
        }
    }
    function find(capability: unknown): Entry | undefined {
        try { return byCapability.get(digest('mode-session-delivery-capability:v1:' + canonicalSecret(capability))); } catch { return undefined; }
    }
    function attach(e: Entry, o: Owner, signal?: AbortSignal): Promise<DeliveryResult> {
        return new Promise(resolve => {
            const w: Waiter = { live: true, resolve, signal, attached: false };
            e.waiter = w;
            if (signal) {
                w.listener = () => { if (e.waiter === w && w.live) settleStatus(e, 'WAIT_CANCELLED'); };
                try { signalOn.call(signal, 'abort', w.listener); w.attached = true; } catch { stopAll('CLOCK_UNAVAILABLE'); }
                if (signalGet.call(signal) && e.waiter === w) settleStatus(e, 'WAIT_CANCELLED');
            }
            try {
            if (!closed && own(e, o) && e.waiter === w && w.live) {
                arm(t => w.timer = t, () => { if (e.waiter === w && w.live) settleStatus(e, 'WAIT_DEADLINE'); }, Math.max(0, 10000 - (sample().mono - o.started!)));
            }
            } catch { if (!closed) stopAll('CLOCK_UNAVAILABLE'); }
            if (closed || !own(e, o) || e.state === 'terminal') settleStatus(e);
        });
    }
    function readyCode(e: Entry): DeliveryCode {
        if (e.state === 'accepted') return 'REDELIVERY_REQUIRED';
        if (e.state === 'recoverable') return 'RECOVERY_REQUIRED';
        if (e.state === 'acked') return 'ACKED';
        if (e.state === 'terminal') return e.code;
        return 'READY';
    }
    function withheldEnvelope(raw: unknown) {
        const r = modeRecord(raw, ['kind', 'delivery', 'token', 'receipt', 'reason', 'attempt']);
        if (r.kind !== 'committed' || r.delivery !== 'withheld' || r.token !== null || r.receipt !== null
            || !['DEADLINE', 'ABORTED', 'CLOSED', 'CLOCK_UNAVAILABLE', 'CONNECTION_FAILED', 'EXPIRED'].includes(r.reason as string)) throw Error();
        if (r.attempt !== null) {
            if (!['DEADLINE', 'ABORTED', 'CONNECTION_FAILED'].includes(r.reason as string)) throw Error();
            opaque(r.attempt);
        }
        return r;
    }
    function committedEnvelope(raw: unknown): void {
        if (field(raw, 'delivery') === 'withheld') { withheldEnvelope(raw); return; }
        const r = modeRecord(raw, ['kind', 'delivery', 'token', 'session', 'receipt']);
        if (r.kind !== 'committed' || r.delivery !== 'session') throw Error();
        // This exact successful envelope proves historical acknowledgement. Its
        // credential/receipt payload is separately validated before any delivery.
    }
    function terminalHistory(e: Entry, raw: unknown, method: Method) {
        if (method === 'deliver') return;
        try {
            if (method === 'recover') {
                const wrapper = modeRecord(raw, ['priorIssuance', 'outcome']);
                if (wrapper.priorIssuance !== null && wrapper.priorIssuance !== 'known_committed' && wrapper.priorIssuance !== 'unknown') throw Error();
                if (wrapper.priorIssuance === 'known_committed') e.certainty = 'known_committed';
                raw = wrapper.outcome;
            }
            if (field(raw, 'kind') === 'committed') { committedEnvelope(raw); e.certainty = 'known_committed'; }
        } catch { /* Never inspect arbitrary errors or accessor data. */ }
    }
    function accept(e: Entry, o: Owner, raw: unknown) {
        const value = modeRecord(raw, ['kind', 'delivery', 'token', 'session', 'receipt']);
        e.certainty = 'known_committed';
        const token = canonicalSecret(value.token), session = opaque(value.session);
        const receipt = contracts.issueReceipt(value.receipt, e.request!);
        const canonical = sessionCanonical(receipt);
        if (byteLength(canonical, 'utf8') > DELIVERY_BOUNDS.receiptBytes) throw Error();
        const body = '{"schemaVersion":1,"deliveryId":' + stringify(e.deliveryId) + ',"token":' + stringify(token) + ',"receipt":' + canonical + '}';
        if (byteLength(body, 'utf8') > DELIVERY_BOUNDS.bodyBytes) throw Error();
        const expiry = sessionMicros(receipt.expiresAt);
        const now = sample();
        if (!check(e, o)) throw Error();
        const remainingUs = expiry - now.wall * 1000n;
        const preparationRemaining = Math.max(0, Math.min(900000 - (now.mono - e.mono!), Number(900000n - (now.wall - e.wall!))));
        const sqlBudget = remainingUs <= 0n ? 0 : Number((remainingUs > 900000000n ? 900000000n : remainingUs) / 1000n);
        e.expiry = expiry; e.expiryMono = now.mono; e.expiryBudget = Math.min(preparationRemaining, sqlBudget);
        if (e.expiryBudget <= 0) { terminal(e, 'EXPIRED'); throw Error(); }
        if (sqlBudget < preparationRemaining) {
            let installed: Timer | undefined;
            arm(t => { installed = t; e.expiryTimer = t; }, () => {
                if (own(e) && e.expiryTimer === installed) terminal(e, 'EXPIRED');
            }, e.expiryBudget);
        }
        // Timer setup may synchronously stop or expire this exact owner.
        if (!check(e, o)) throw Error();
        e.token = token; e.session = session; e.attempt = undefined;
        e.baseline = freeze({ sessionId: receipt.sessionId, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt });
        e.canonical = canonical; e.body = body; e.state = 'accepted'; e.code = 'REDELIVERY_REQUIRED';
    }
    function processOutcome(e: Entry, o: Owner, raw: unknown, prior: Entry['certainty']): boolean {
        if (o.method === 'deliver') {
            if (field(raw, 'kind') === 'completed' && field(raw, 'delivery') === 'data') {
                const value = modeRecord(raw, ['kind', 'delivery', 'data']);
                const canonical = sessionCanonical(contracts.issueReceipt(value.data, e.request!));
                if (canonical !== e.canonical) throw Error();
                e.state = 'accepted'; e.code = 'REDELIVERY_REQUIRED';
                return true;
            }
            e.state = 'accepted'; e.code = 'VALIDATION_UNAVAILABLE';
            return false;
        }
        if (o.method === 'recover') {
            const wrapper = modeRecord(raw, ['priorIssuance', 'outcome']);
            if (wrapper.priorIssuance !== null && wrapper.priorIssuance !== 'known_committed' && wrapper.priorIssuance !== 'unknown') throw Error();
            if (prior === 'known_committed' && wrapper.priorIssuance === 'unknown') throw Error();
            if (wrapper.priorIssuance === 'known_committed') e.certainty = 'known_committed';
            raw = wrapper.outcome;
        }
        const kind = field(raw, 'kind');
        if (kind === 'committed' && field(raw, 'delivery') === 'session') { accept(e, o, raw); return true; }
        if (kind === 'committed' && field(raw, 'delivery') === 'withheld') {
            const r = withheldEnvelope(raw);
            e.certainty = 'known_committed';
            if (r.token !== null || r.receipt !== null) throw Error();
            if (r.attempt === null) terminal(e, 'COMMITTED_UNAVAILABLE');
            else { e.attempt = opaque(r.attempt); e.state = 'recoverable'; e.code = 'RECOVERY_REQUIRED'; }
            return false;
        }
        if (kind === 'unknown_commit') {
            const r = modeRecord(raw, ['kind', 'code', 'token', 'receipt', 'attempt', 'reconciliation']);
            if (r.code !== 'COMMIT_UNCERTAIN' || r.token !== null || r.receipt !== null || r.reconciliation !== 'EXPLICIT_SAME_ATTEMPT') throw Error();
            if (e.certainty !== 'known_committed') e.certainty = 'unknown';
            if (r.attempt === null) terminal(e, e.certainty === 'known_committed' ? 'COMMITTED_UNAVAILABLE' : 'UNAVAILABLE');
            else { e.attempt = opaque(r.attempt); e.state = 'recoverable'; e.code = 'RECOVERY_REQUIRED'; }
            return false;
        }
        if (kind === 'failed') {
            const r = modeRecord(raw, ['kind', 'code', 'transaction', 'backendMayStillRun']);
            if (!['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT', 'LIMIT_EXCEEDED', 'DEADLOCK', 'LOCK_TIMEOUT', 'SERVER_TIMEOUT', 'INTERNAL_ERROR', 'CONNECTION_FAILED', 'ACQUISITION_TIMEOUT', 'DEADLINE', 'ABORTED', 'CLOSED', 'CLOCK_UNAVAILABLE', 'EXPIRED', 'ENTROPY_UNAVAILABLE', 'CONTEXT_BUSY'].includes(r.code as string)
                || !['not_started', 'no_commit_submitted', 'rolled_back'].includes(r.transaction as string)
                || typeof r.backendMayStillRun !== 'boolean'
                || r.backendMayStillRun !== (r.transaction === 'no_commit_submitted')
                || r.transaction === 'rolled_back' && r.code !== 'INTERNAL_ERROR') throw Error();
            // A consumed initial failure is an observation, not an unresolved issuance.
            if (o.method === 'issue') o.dispatched = false;
            terminal(e, e.certainty === 'known_committed' ? 'COMMITTED_UNAVAILABLE' : 'OPERATION_FAILED');
            return false;
        }
        throw Error();
    }
    function deliverWaiter(e: Entry, o: Owner) {
        const w = takeWaiter(e);
        if (!w) return;
        cleanupWaiter(w);
        if (!check(e, o) || e.state !== 'accepted' || !e.body || !e.deliveryId) { w.resolve(snapshot(e)); return; }
        if (w.signal && signalGet.call(w.signal)) { w.resolve(snapshot(e, 'WAIT_CANCELLED')); return; }
        e.offered = true;
        w.resolve(freeze({ kind: 'delivery', issuance: 'known_committed', deliveryId: e.deliveryId, body: e.body }));
    }
    function consume(e: Entry, o: Owner, raw: unknown, rejected: boolean) {
        if (!own(e, o)) return;
        o.finishing = true;
        const prior = e.certainty;
        terminalHistory(e, raw, o.method);
        let deliver = false;
        if (!closed && e.state !== 'terminal' && e.state !== 'acked' && check(e, o)) {
            try {
                if (rejected) throw Error();
                deliver = processOutcome(e, o, raw, prior);
            } catch {
                if (o.method === 'deliver') { e.state = 'accepted'; e.code = 'VALIDATION_UNAVAILABLE'; }
                else terminal(e, e.certainty === 'known_committed' ? 'COMMITTED_UNAVAILABLE' : 'OPERATION_FAILED');
            }
        }
        clear(o.timer);
        if (deliver) deliverWaiter(e, o); else settleStatus(e, e.code);
        let retire = closed;
        if (!closed) {
            try {
                const now = sample();
                if (expired(e, now)) { terminal(e, 'EXPIRED'); retire = retentionEnded(e, now); }
            } catch { /* Global stop already latched. */ }
        }
        retire = retire || closed;
        if (retire) { clear(e.timer); clear(e.expiryTimer); }
        // All trusted callbacks and raw-result inspection finish while the original
        // owner/scratch reservation remains charged. The tail is callback-free.
        raw = undefined;
        o.consumed = true; owners.delete(o); reservedBytes -= DELIVERY_BOUNDS.ownerBytes;
        if (e.owner === o) e.owner = undefined;
        if (retire) releaseEntry(e);
    }
    function call(method: Method | 'wait', capability: unknown, options: ModeSessionOptions = {}): Promise<DeliveryResult> {
        let signal: AbortSignal | undefined;
        try { signal = signalOption(options); } catch { const e = find(capability); return Promise.resolve(e ? snapshot(e, 'INVALID_REQUEST') : unavailable()); }
        const e = find(capability);
        if (!e) return Promise.resolve(unavailable());
        if (signal && signalGet.call(signal)) return Promise.resolve(snapshot(e, 'WAIT_CANCELLED'));
        if (closed) return Promise.resolve(snapshot(e, e.state === 'terminal' ? e.code : clockFailed ? 'CLOCK_UNAVAILABLE' : 'CLOSED'));
        if (!check(e, e.owner)) return Promise.resolve(snapshot(e));
        if (e.owner) {
            if (method !== 'wait' || e.waiter || e.owner.finishing || e.state === 'terminal' || e.state === 'acked') return Promise.resolve(snapshot(e, e.state === 'terminal' ? e.code : e.state === 'acked' ? 'ACKED' : 'BUSY'));
            if (!check(e, e.owner)) return Promise.resolve(snapshot(e));
            return attach(e, e.owner, signal);
        }
        if (method === 'wait') { check(e); return Promise.resolve(snapshot(e, readyCode(e))); }
        const allowed = method === 'issue' ? e.state === 'prepared' : method === 'recover' ? e.state === 'recoverable' : e.state === 'accepted';
        if (!allowed) return Promise.resolve(snapshot(e, e.state === 'prepared' ? 'INVALID_REQUEST' : readyCode(e)));
        if (owners.size >= 2 || reservedBytes + DELIVERY_BOUNDS.ownerBytes > DELIVERY_BOUNDS.totalBytes) return Promise.resolve(snapshot(e, 'CAPACITY'));
        const previous = e.state;
        const o: Owner = { method, controller: new AbortController(), dispatched: false, consumed: false, finishing: false };
        owners.add(o); reservedBytes += DELIVERY_BOUNDS.ownerBytes; e.owner = o;
        e.state = method === 'issue' ? 'issuing' : method === 'recover' ? 'recovering' : 'validating';
        let result: Promise<DeliveryResult>;
        try {
            o.started = sample().mono;
            if (!check(e, o)) throw Error();
            result = attach(e, o, signal);
            if (!own(e, o) || closed || (e.state as DeliveryState) === 'terminal') throw Error();
            const abandonUnstarted = () => {
                clear(o.timer);
                if (!closed && own(e, o) && (e.state as DeliveryState) !== 'terminal') e.state = previous;
                o.consumed = true; owners.delete(o); reservedBytes -= DELIVERY_BOUNDS.ownerBytes;
                if (e.owner === o) e.owner = undefined;
                return result;
            };
            if (!e.waiter) return abandonUnstarted();
            const beforeTimer = sample();
            if (!own(e, o) || closed || (e.state as DeliveryState) === 'terminal') throw Error();
            if (!e.waiter) return abandonUnstarted();
            arm(t => o.timer = t, () => { if (own(e, o)) terminal(e, 'OPERATION_DEADLINE'); }, 10000 - (beforeTimer.mono - o.started));
            if (!check(e, o)) throw Error();
            if (!e.waiter) return abandonUnstarted();
            o.dispatched = true;
            let pending: Promise<unknown>;
            if (method === 'issue') pending = issue(e.request!, { signal: o.controller.signal });
            else if (method === 'recover') pending = recover(e.attempt!, { signal: o.controller.signal });
            else pending = validate({ tokenHash: digest('mode-flow-session:v1:' + e.token!), request: e.request!, baseline: e.baseline! }, { signal: o.controller.signal });
            Promise.resolve(pending).then(value => consume(e, o, value, false), () => consume(e, o, undefined, true));
            return result;
        } catch {
            if ((e.state as DeliveryState) !== 'terminal') terminal(e, closed ? clockFailed ? 'CLOCK_UNAVAILABLE' : 'CLOSED' : 'OPERATION_FAILED');
            const out = snapshot(e);
            consume(e, o, undefined, true);
            return Promise.resolve(out);
        }
    }
    function acknowledge(capability: unknown, id: unknown): DeliveryStatus {
        const e = find(capability);
        if (!e) return unavailable();
        if (!check(e)) return snapshot(e);
        if (id !== e.deliveryId || !e.offered || !['accepted', 'validating', 'acked'].includes(e.state)) return snapshot(e, 'INVALID_REQUEST');
        e.state = 'acked'; e.code = 'ACKED'; e.body = undefined;
        settleStatus(e, 'ACKED');
        clear(e.owner?.timer);
        if (e.owner) { try { signalAbort.call(e.owner.controller); } catch { /* Ack state wins before callbacks. */ } }
        return snapshot(e);
    }
    return freeze<ModeSessionDeliveryCoordinator>({ prepare, issue: (cap, options) => call('issue', cap, options), recover: (cap, options) => call('recover', cap, options), deliver: (cap, options) => call('deliver', cap, options), wait: (cap, options) => call('wait', cap, options), acknowledge, close: () => stopAll('CLOSED') });
}
