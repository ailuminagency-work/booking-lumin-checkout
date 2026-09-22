/** Local disposable transport only. Opaque contexts are not production authentication. */
import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { modeCommand, safeModeError } from './mode-installation-contracts';
import { createModeSessionContracts, ModeSessionInputError, modeRecord, sessionResult, sessionMicros, sessionCanonical, sessionIntent, type ModeSessionContext, type ModeSessionIssueRequest, type ModeSessionIssueReceipt, type ModeSessionSubmitReceipt, type ModeSessionFailureCode, type ModeSessionWithheldReason, type ModeSessionIssueOutcome, type ModeSessionSubmitOutcome, type ModeSessionReadOutcome, type ModeSessionRecoveryOutcome } from './mode-session-contracts';
export type * from './mode-session-contracts';
export interface ModeSessionClient {
    query(text: string, values?: unknown[]): Promise<any>;
    release(error?: Error): void;
    on(event: string, listener: (...args: any[]) => void): any;
    removeListener(event: string, listener: (...args: any[]) => void): any;
}
export interface ModeSessionPool {
    connect(): Promise<ModeSessionClient>;
    end(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): any;
    removeListener(event: string, listener: (...args: any[]) => void): any;
}
export interface ModeSessionClock {
    monotonic(): number;
    wall(): number;
    setTimer(callback: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}
export interface ModeSessionOptions {
    signal?: AbortSignal;
}
export interface ModeSessionRepository {
    issue(request: unknown, options?: ModeSessionOptions): Promise<ModeSessionIssueOutcome>;
    recoverIssue(attempt: unknown, options?: ModeSessionOptions): Promise<ModeSessionRecoveryOutcome>;
    submit(session: unknown, request: unknown, options?: ModeSessionOptions): Promise<ModeSessionSubmitOutcome>;
    ownerHistory(actor: unknown, request: unknown, options?: ModeSessionOptions): Promise<ModeSessionReadOutcome>;
    close(): Promise<void>;
}
const frozen = Object.freeze, isProxy = types.isProxy, random = randomBytes, hash = createHash, from = Buffer.from.bind(Buffer), isBuffer = Buffer.isBuffer.bind(Buffer), bufferString = Buffer.prototype.toString, byteLength = Buffer.byteLength.bind(Buffer), nativeNow = Date.now, nativeSet = setTimeout, nativeClear = clearTimeout;
const defaultClock: ModeSessionClock = { monotonic: () => performance.now(), wall: () => nativeNow(), setTimer: (f, ms) => nativeSet(f, ms), clearTimer: h => nativeClear(h as ReturnType<typeof setTimeout>) };
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
function signalOption(value: unknown): AbortSignal | undefined {
    let r: Record<string, unknown>;
    try {
        modeRecord(value, []);
        return undefined;
    }
    catch {
        r = modeRecord(value, ['signal']);
    }
    const s = r.signal;
    if (!s || typeof s !== 'object' || isProxy(s))
        throw new ModeSessionInputError();
    aborted.call(s);
    return s as AbortSignal;
}
const SQL = { issue: 'SELECT public.mode_issue_flow_session($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::uuid,$7::bigint,$8::bigint) AS result', submit: 'SELECT public.mode_submit_flow_request($1::text,$2::text,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::timestamptz) AS result', owner: 'SELECT public.mode_owner_request_history($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::uuid,$6::integer) AS result' } as const;
type Method = keyof typeof SQL;
type Entry = {
    handle: ModeSessionContext;
    started: number;
    timer: unknown;
    state: 'issuing' | 'uncertain' | 'withheld' | 'recovering' | 'accepted';
    busy?: symbol;
    stop?: (reason: ModeSessionWithheldReason) => void;
    request: ModeSessionIssueRequest;
    secret?: string;
    tokenHash: string;
    receipt?: ModeSessionIssueReceipt;
    prior: 'known_committed' | 'unknown';
    reference?: string;
    pending?: Readonly<{
        tuple: readonly unknown[];
        hash: string;
    }>;
};
type Plan = {
    entry?: Entry;
    values: unknown[];
    parse: (value: unknown) => any;
    intent?: Readonly<{
        tuple: readonly unknown[];
        hash: string;
    }>;
};
const digest = (value: string) => hash('sha256').update(value, 'utf8').digest('hex');
const failure = (code: ModeSessionFailureCode) => frozen({ kind: 'failed' as const, code, transaction: 'not_started' as const, backendMayStillRun: false });
function sqlFailure(method: Method, error: unknown): ModeSessionFailureCode {
    const pair = safeModeError(error);
    if (!pair)
        return 'INTERNAL_ERROR';
    const [code, label] = pair;
    if (code === '40P01')
        return 'DEADLOCK';
    if (code === '55P03')
        return 'LOCK_TIMEOUT';
    if (code === '57014')
        return 'SERVER_TIMEOUT';
    if (code === '42501' && (label === 'MODE_SESSION_FORBIDDEN' || method === 'owner' && label === 'FORBIDDEN'))
        return 'FORBIDDEN';
    if (code === '22023' && (['MODE_SESSION_INVALID', 'MODE_SESSION_INVALID_ORIGIN'].includes(label) || method === 'submit' && ['MODE_REQUEST_INVALID_ANSWERS', 'MODE_REQUEST_INVALID_CUSTOMER', 'MODE_REQUEST_INVALID_TIME'].includes(label)))
        return 'INVALID_REQUEST';
    if (code === '40001' && label === (method === 'issue' ? 'MODE_SESSION_CONFLICT' : 'MODE_REQUEST_CONFLICT') && method !== 'owner')
        return 'CONFLICT';
    if (code === 'P0002' && label === 'MODE_REQUEST_NOT_FOUND' && method === 'owner')
        return 'NOT_FOUND';
    if (code === '54000' && label === 'MODE_SESSION_LIMIT')
        return 'LIMIT_EXCEEDED';
    return 'INTERNAL_ERROR';
}
/** Trusted driver/clock/entropy seams, deliberately not exported through a browser surface. */
export function __createModeSessionRepositoryForTests({ pool, clock = defaultClock, profiles, entropy = () => random(32) }: {
    pool: ModeSessionPool;
    clock?: ModeSessionClock;
    profiles: unknown;
    entropy?: () => Buffer;
}): ModeSessionRepository {
    const contracts = createModeSessionContracts(profiles), entries = new Map<object, Entry>(), active = new Set<(reason: ModeSessionWithheldReason) => void>();
    let closed = false, clockFailed = false, closing: Promise<void> | undefined, lastGlobal = -Infinity, lastRepositoryWall = -Infinity, reserved = 0;
    pool.on('error', () => { });
    function drain() {
        if (closing)
            return closing;
        closing = new Promise<void>(resolve => {
            let done = false;
            const timer = nativeSet(() => complete(), 10000);
            function complete() {
                if (done)
                    return;
                done = true;
                nativeClear(timer);
                resolve();
            }
            try {
                Promise.resolve(pool.end()).then(complete, complete);
            }
            catch {
                complete();
            }
        });
        return closing;
    }
    function forget(e: Entry) {
        if (!entries.delete(e.handle))
            return;
        e.secret = undefined;
        e.pending = undefined;
        e.receipt = undefined;
        e.reference = undefined;
        e.busy = undefined;
        e.stop = undefined;
        try {
            clock.clearTimer(e.timer);
        }
        catch {
            breakClock();
        }
    }
    function breakClock() {
        if (clockFailed)
            return;
        clockFailed = true;
        for (const stop of [...active])
            stop('CLOCK_UNAVAILABLE');
        for (const e of [...entries.values()])
            forget(e);
        void drain();
    }
    function mono() {
        try {
            const n = clock.monotonic();
            if (!Number.isFinite(n) || n < 0 || n < lastGlobal)
                throw Error();
            lastGlobal = n;
            return n;
        }
        catch {
            breakClock();
            throw new ModeSessionInputError('CLOCK_UNAVAILABLE');
        }
    }
    function entryFor(handle: unknown, expected: 'accepted' | 'recoverable', start: number, wall: number): Entry {
        if (handle === null || typeof handle !== 'object' || isProxy(handle))
            throw new ModeSessionInputError();
        const e = entries.get(handle);
        if (!e)
            throw new ModeSessionInputError();
        if (start - e.started >= 900000 || (e.receipt && BigInt(wall) * 1000n >= sessionMicros(e.receipt.expiresAt))) {
            forget(e);
            throw new ModeSessionInputError('EXPIRED');
        }
        if (e.busy)
            throw new ModeSessionInputError('CONTEXT_BUSY');
        if (expected === 'accepted' ? e.state !== 'accepted' : !['uncertain', 'withheld'].includes(e.state))
            throw new ModeSessionInputError();
        return e;
    }
    function invoke(method: Method, prepare: (start: number, wall: number, identity: symbol) => Plan, options: unknown = {}): Promise<any> {
        if (clockFailed)
            return Promise.resolve(failure('CLOCK_UNAVAILABLE'));
        if (closed)
            return Promise.resolve(failure('CLOSED'));
        let start: number;
        try {
            start = mono();
        }
        catch {
            return Promise.resolve(failure('CLOCK_UNAVAILABLE'));
        }
        return new Promise(resolve => {
            const identity = Symbol();
            let phase: 'acquiring' | 'acquired' | 'transaction' | 'committing' | 'committed' = 'acquiring', settled = false, disposed = false, beginSent = false, lastWall = -Infinity;
            let stoppedBy: ModeSessionWithheldReason | 'ACQUISITION_TIMEOUT' | undefined;
            let client: ModeSessionClient | undefined, signal: AbortSignal | undefined, total: unknown, acquisition: unknown, plan: Plan | undefined, data: any;
            const owns = () => !settled && (!plan?.entry || entries.get(plan.entry.handle) === plan.entry && plan.entry.busy === identity);
            const failed = (code: ModeSessionFailureCode) => ({ kind: 'failed', code, transaction: beginSent ? 'no_commit_submitted' : 'not_started', backendMayStillRun: beginSent });
            const uncertain = () => method === 'owner' ? { kind: 'completion_uncertain', code: 'READ_COMPLETION_UNCERTAIN', data: null, backendMayStillRun: true } : method === 'issue' ? { kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', token: null, receipt: null, attempt: null, reconciliation: 'EXPLICIT_SAME_ATTEMPT' } : { kind: 'unknown_commit', code: 'COMMIT_UNCERTAIN', receipt: null, reconciliation: 'EXPLICIT_SAME_SESSION_REQUEST' };
            const withheld = (reason: ModeSessionWithheldReason) => method === 'owner' ? { kind: 'completed', delivery: 'withheld', data: null, reason } : method === 'issue' ? { kind: 'committed', delivery: 'withheld', token: null, receipt: null, attempt: null, reason } : { kind: 'committed', delivery: 'withheld', receipt: null, reason };
            const onEnd = () => { client?.removeListener('error', onError); client?.removeListener('end', onEnd); };
            const dispose = (bad: boolean) => {
                if (!client || disposed)
                    return;
                disposed = true;
                if (bad) {
                    client.on('end', onEnd);
                    try {
                        client.release(Error('MODE_SESSION_CONNECTION_DISCARDED'));
                    }
                    catch { }
                }
                else {
                    client.removeListener('error', onError);
                    try {
                        client.release();
                    }
                    catch { }
                }
            };
            const finish = (out: any, bad = true) => {
                if (settled)
                    return;
                const e = plan?.entry, owned = !e || entries.get(e.handle) === e && e.busy === identity;
                settled = true;
                active.delete(stop);
                let retain = true;
                if (owned) {
                    try {
                        const n = mono(), w = wall();
                        // Candidate expiry is operation-local evidence, never an issuance identity baseline.
                        const candidate = method === 'issue' ? data as ModeSessionIssueReceipt | undefined : e?.receipt;
                        retain = !e || n - e.started < 900000 && (!candidate || BigInt(w) * 1000n < sessionMicros(candidate.expiresAt));
                        if (phase === 'committed') {
                            if (closed)
                                out = withheld('CLOSED');
                            else if (signal && aborted.call(signal))
                                out = withheld('ABORTED');
                            else if (n - start >= 10000)
                                out = withheld('DEADLINE');
                            else if (!retain)
                                out = withheld('EXPIRED');
                        }
                    }
                    catch {
                        retain = false;
                        breakClock();
                    }
                    if (clockFailed)
                        out = phase === 'committed' ? withheld('CLOCK_UNAVAILABLE') : phase === 'committing' ? uncertain() : failed('CLOCK_UNAVAILABLE');
                }
                try {
                    clock.clearTimer(total);
                    clock.clearTimer(acquisition);
                }
                catch {
                    breakClock();
                    out = phase === 'committed' ? withheld('CLOCK_UNAVAILABLE') : phase === 'committing' ? uncertain() : failed('CLOCK_UNAVAILABLE');
                }
                if (signal)
                    remove.call(signal, 'abort', onAbort);
                if (e && owned && entries.get(e.handle) === e) {
                    if (method === 'issue') {
                        if (out.kind === 'committed' && out.delivery === 'session') {
                            e.state = 'accepted';
                            e.secret = undefined;
                        }
                        else if (out.kind === 'unknown_commit' || out.kind === 'committed' && out.delivery === 'withheld' && ['DEADLINE', 'ABORTED', 'CONNECTION_FAILED'].includes(out.reason)) {
                            if (retain && !closed && !clockFailed && e.secret && !['EXPIRED', 'CLOSED', 'CLOCK_UNAVAILABLE'].includes(stoppedBy ?? '')) {
                                e.state = out.kind === 'unknown_commit' ? 'uncertain' : 'withheld';
                                out = { ...out, attempt: e.handle };
                            }
                            else
                                forget(e);
                        }
                        else
                            forget(e);
                    }
                    else if (method === 'submit') {
                        if (out.kind === 'unknown_commit' && plan?.intent)
                            e.pending = plan.intent;
                        if (phase === 'committed' && data)
                            e.pending = undefined;
                        if (!retain || ['EXPIRED', 'CLOSED', 'CLOCK_UNAVAILABLE'].includes(out.reason ?? out.code))
                            forget(e);
                    }
                    if (entries.get(e.handle) === e) {
                        e.busy = undefined;
                        e.stop = undefined;
                    }
                }
                dispose(bad);
                resolve(frozen(out));
            };
            const stop = (reason: ModeSessionWithheldReason | 'ACQUISITION_TIMEOUT') => {
                if (settled)
                    return;
                stoppedBy = reason;
                finish(phase === 'committed' ? withheld(reason === 'ACQUISITION_TIMEOUT' ? 'DEADLINE' : reason) : phase === 'committing' ? uncertain() : failed(reason));
            };
            const onError = () => stop('CONNECTION_FAILED'), onAbort = () => stop('ABORTED');
            const wall = () => {
                try {
                    const n = clock.wall();
                    if (!Number.isSafeInteger(n) || n < lastWall || n < lastRepositoryWall)
                        throw Error();
                    lastWall = n;
                    lastRepositoryWall = n;
                    return n;
                }
                catch {
                    breakClock();
                    throw new ModeSessionInputError('CLOCK_UNAVAILABLE');
                }
            };
            const guard = () => {
                if (settled)
                    return false;
                try {
                    const now = mono(), w = wall();
                    if (clockFailed) {
                        stop('CLOCK_UNAVAILABLE');
                        return false;
                    }
                    if (closed) {
                        stop('CLOSED');
                        return false;
                    }
                    if (signal && aborted.call(signal)) {
                        stop('ABORTED');
                        return false;
                    }
                    if (now - start >= 10000) {
                        stop('DEADLINE');
                        return false;
                    }
                    if (phase === 'acquiring' && now - start >= 3000) {
                        stop('ACQUISITION_TIMEOUT');
                        return false;
                    }
                    const e = plan?.entry;
                    if (e && (entries.get(e.handle) !== e || e.busy !== identity || now - e.started >= 900000 || (e.receipt && BigInt(w) * 1000n >= sessionMicros(e.receipt.expiresAt)))) {
                        stop('EXPIRED');
                        return false;
                    }
                }
                catch {
                    breakClock();
                    if (!settled)
                        stop('CLOCK_UNAVAILABLE');
                    return false;
                }
                return true;
            };
            active.add(stop);
            try {
                total = clock.setTimer(() => stop('DEADLINE'), Math.max(0, 10000 - (mono() - start)));
                acquisition = clock.setTimer(() => {
                    if (phase === 'acquiring')
                        stop('ACQUISITION_TIMEOUT');
                }, Math.max(0, 3000 - (mono() - start)));
            }
            catch {
                breakClock();
                return;
            }
            try {
                signal = signalOption(options);
                if (signal)
                    add.call(signal, 'abort', onAbort, { once: true });
                if (!guard())
                    return;
                plan = prepare(start, lastWall, identity);
                if (plan.entry)
                    plan.entry.stop = stop;
            }
            catch (error) {
                if (guard())
                    finish(failed(error instanceof ModeSessionInputError ? error.code : 'INVALID_REQUEST'));
                return;
            }
            if (!guard())
                return;
            void (async () => {
                try {
                    let acquired: ModeSessionClient;
                    try {
                        acquired = await pool.connect();
                    }
                    catch {
                        if (guard())
                            finish(failed('CONNECTION_FAILED'));
                        return;
                    }
                    client = acquired;
                    client.on('error', onError);
                    if (!owns()) {
                        dispose(true);
                        return;
                    }
                    if (!guard())
                        return;
                    try {
                        clock.clearTimer(acquisition);
                    }
                    catch {
                        breakClock();
                        return;
                    }
                    phase = 'acquired';
                    const command = async (text: string, tag: string, values?: unknown[]) => {
                        if (!guard())
                            return undefined;
                        if (text === 'BEGIN ISOLATION LEVEL READ COMMITTED') {
                            beginSent = true;
                            phase = 'transaction';
                        }
                        const r = await client!.query(text, values);
                        if (!guard())
                            return undefined;
                        if (modeCommand(r) !== tag)
                            throw Error();
                        return r;
                    };
                    if (!await command('BEGIN ISOLATION LEVEL READ COMMITTED', 'BEGIN'))
                        return;
                    for (const text of ["SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", "SET LOCAL ROLE service_role"]) {
                        if (!await command(text, 'SET'))
                            return;
                    }
                    const raw = await command(SQL[method], 'SELECT', plan!.values);
                    if (!raw)
                        return;
                    try {
                        data = plan!.parse(sessionResult(raw));
                    }
                    catch {
                        if (guard())
                            finish(failed('INTERNAL_ERROR'));
                        return;
                    }
                    // Only a known-committed baseline may constrain recovery; SELECT-only data is speculative.
                    const e = plan!.entry;
                    if (e && method === 'issue' && e.receipt && sessionCanonical(e.receipt) !== sessionCanonical(data)) {
                        if (guard())
                            finish(failed('INTERNAL_ERROR'));
                        return;
                    }
                    if (e && method === 'submit' && e.reference && e.reference !== data.reference) {
                        if (guard())
                            finish(failed('INTERNAL_ERROR'));
                        return;
                    }
                    // Validate candidate issuance expiry before COMMIT without storing a speculative identity.
                    if (method === 'issue' && BigInt(wall()) * 1000n >= sessionMicros(data.expiresAt)) {
                        stop('EXPIRED');
                        return;
                    }
                    if (!guard() || !await command('SET CONSTRAINTS ALL IMMEDIATE', 'SET') || !guard())
                        return;
                    phase = 'committing';
                    const ack = await client.query('COMMIT');
                    if (!owns())
                        return;
                    const tag = modeCommand(ack);
                    if (tag === 'ROLLBACK') {
                        finish({ kind: 'failed', code: 'INTERNAL_ERROR', transaction: 'rolled_back', backendMayStillRun: false });
                        return;
                    }
                    if (tag !== 'COMMIT') {
                        finish(uncertain());
                        return;
                    }
                    phase = 'committed';
                    if (e) {
                        if (method === 'issue') {
                            e.receipt = data;
                            e.prior = 'known_committed';
                        }
                        else if (method === 'submit') {
                            e.reference = data.reference;
                            e.pending = undefined;
                        }
                    }
                    if (!guard())
                        return;
                    if (method === 'issue')
                        finish({ kind: 'committed', delivery: 'session', token: e!.secret, session: e!.handle, receipt: data }, false);
                    else if (method === 'submit')
                        finish({ kind: 'committed', delivery: 'receipt', receipt: data }, false);
                    else
                        finish({ kind: 'completed', delivery: 'data', data }, false);
                }
                catch (error) {
                    if (!owns())
                        return;
                    if (phase === 'committing')
                        finish(uncertain());
                    else if (guard())
                        finish(failed(sqlFailure(method, error)));
                }
            })();
        });
    }
    function issueValues(e: Entry): unknown[] { const r = e.request; return [e.request.installationId, e.tokenHash, r.rendererOrigin, r.parentOrigin, r.deploymentProfileVersion, r.expectedVersionId, r.expectedTargetRevision, r.expectedPolicyRevision]; }
    return frozen({
        issue(request: unknown, options?: ModeSessionOptions) {
            return invoke('issue', (start, _wall, id) => {
                const r = contracts.issue(request);
                if (entries.size + reserved >= 64)
                    throw new ModeSessionInputError('LIMIT_EXCEEDED');
                const handle = frozen(Object.create(null)) as ModeSessionContext;
                let secret: string;
                reserved++;
                try {
                    const result = entropy();
                    if (!isBuffer(result) || isProxy(result) || result.length !== 32)
                        throw Error();
                    secret = bufferString.call(from(result), 'base64url');
                }
                catch {
                    throw new ModeSessionInputError('ENTROPY_UNAVAILABLE');
                }
                finally {
                    reserved--;
                }
                if (closed || clockFailed)
                    throw new ModeSessionInputError(clockFailed ? 'CLOCK_UNAVAILABLE' : 'CLOSED');
                const e: Entry = { handle, started: start, timer: undefined, state: 'issuing', busy: id, request: r, secret, tokenHash: digest('mode-flow-session:v1:' + secret), prior: 'unknown' };
                entries.set(handle, e);
                try {
                    e.timer = clock.setTimer(() => {
                        if (!entries.has(handle))
                            return;
                        e.stop?.('EXPIRED');
                        forget(e);
                    }, Math.max(0, 900000 - (mono() - start)));
                }
                catch {
                    forget(e);
                    breakClock();
                    throw new ModeSessionInputError('CLOCK_UNAVAILABLE');
                }
                return { entry: e, values: issueValues(e), parse: v => contracts.issueReceipt(v, r) };
            }, options);
        },
        async recoverIssue(handle: unknown, options?: ModeSessionOptions) { let prior: 'known_committed' | 'unknown' | null = null; const outcome = await invoke('issue', (start, wall, id) => { const e = entryFor(handle, 'recoverable', start, wall); prior = e.prior; e.busy = id; e.state = 'recovering'; return { entry: e, values: issueValues(e), parse: v => contracts.issueReceipt(v, e.request) }; }, options); return frozen({ priorIssuance: prior, outcome }); },
        submit(handle: unknown, request: unknown, options?: ModeSessionOptions) {
            return invoke('submit', (start, wall, id) => {
                const e = entryFor(handle, 'accepted', start, wall), r = contracts.submit(request, e.receipt!);
                let tokenHash: string;
                try {
                    const b = from(r.token, 'base64url');
                    if (b.length !== 32 || bufferString.call(b, 'base64url') !== r.token)
                        throw Error();
                    tokenHash = digest('mode-flow-session:v1:' + r.token);
                }
                catch {
                    throw new ModeSessionInputError();
                }
                if (tokenHash !== e.tokenHash)
                    throw new ModeSessionInputError();
                const values = [tokenHash, e.request.rendererOrigin, e.request.parentOrigin, r.idempotencyKey, sessionCanonical(r.answers), sessionCanonical(r.customer), r.requestedStart];
                const intent = sessionIntent(values);
                if (e.pending && (e.pending.hash !== intent.hash || e.pending.tuple.some((v, i) => v !== values[i])))
                    throw new ModeSessionInputError('CONFLICT');
                e.busy = id;
                return { entry: e, values, intent, parse: v => contracts.submitReceipt(v) };
            }, options);
        },
        ownerHistory(actor: unknown, request: unknown, options?: ModeSessionOptions) { return invoke('owner', () => { const c = contracts.owner(actor, request), r = c.request; return { values: [c.actor.userId, r.tenantId, r.flowId, r.beforeCreatedAt, r.beforeBookingId, r.limit], parse: v => contracts.history(v, r) }; }, options); },
        close() {
            if (!closed) {
                closed = true;
                for (const stop of [...active])
                    stop('CLOSED');
                for (const e of [...entries.values()])
                    forget(e);
            }
            return drain();
        }
    });
}
export function createLocalModeSessionRepository(config: unknown = { profiles: [] }): ModeSessionRepository {
    const c = modeRecord(config, ['profiles']);
    createModeSessionContracts(c.profiles);
    const e = process.env, host = e.PGHOST, port = e.PGPORT, database = e.PGDATABASE, password = e.PGPASSWORD ?? '';
    if (e.LOCAL_HARNESS !== '1' || e.FLOW_TEST_DISPOSABLE !== '1' || e.MODE_SESSIONS_TEST_DISPOSABLE !== '1' || !['127.0.0.1', 'localhost'].includes(host ?? '') || !port || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535 || e.PGUSER !== 'postgres' || !database || database.length > 63 || !/^lumin_mode_session_transport_[a-z0-9_]+$/.test(database) || !['', 'postgres'].includes(password) || ['DATABASE_URL', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS'].some(k => Boolean(e[k])))
        throw Error('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');
    const pool = new Pool({ host, port: Number(port), user: 'postgres', database, password: () => password, ssl: false, pipeline: false, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 5000, statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 1000, query_timeout: 0, application_name: 'mode-session-local-transport' });
    return __createModeSessionRepositoryForTests({ pool, profiles: c.profiles });
}
