/** Server-internal existing-session read. The supplied pool must be the shared admission view. */
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { modeCommand, safeModeError } from './mode-installation-contracts';
import { copySessionValue, createModeSessionContracts, modeRecord, sessionMicros, sessionResult, sessionUuid, type ModeSessionIssueReceipt, type ModeSessionIssueRequest } from './mode-session-contracts';
import type { ModeSessionClient, ModeSessionClock, ModeSessionOptions, ModeSessionPool } from './mode-session-repository';

export type ValidationReason = 'ABORTED' | 'DEADLINE' | 'CLOSED' | 'CLOCK_UNAVAILABLE' | 'CONNECTION_FAILED' | 'EXPIRED';
export type ValidationFailureCode = ValidationReason | 'INVALID_REQUEST' | 'CONTEXT_BUSY' | 'ACQUISITION_TIMEOUT' | 'FORBIDDEN' | 'DEADLOCK' | 'LOCK_TIMEOUT' | 'SERVER_TIMEOUT' | 'INTERNAL_ERROR';
export type ExistingSessionValidationOutcome = Readonly<
    { kind: 'completed'; delivery: 'data'; data: ModeSessionIssueReceipt } |
    { kind: 'completed'; delivery: 'withheld'; data: null; reason: ValidationReason } |
    { kind: 'completion_uncertain'; code: 'READ_COMPLETION_UNCERTAIN'; data: null; backendMayStillRun: true } |
    { kind: 'failed'; code: ValidationFailureCode; data: null; transaction: 'not_started' | 'no_commit_submitted' | 'rolled_back'; backendMayStillRun: boolean }
>;
export interface ExistingModeSessionValidator {
    validateExisting(input: unknown, options?: ModeSessionOptions): Promise<ExistingSessionValidationOutcome>;
    close(): void;
}
export const EXISTING_SESSION_VALIDATION_SQL = 'SELECT public.mode_validate_existing_flow_session($1::text,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::uuid,$8::bigint,$9::bigint,$10::timestamptz,$11::timestamptz) AS result';
const freeze = Object.freeze, isProxy = types.isProxy;
const nativeMono = performance.now.bind(performance), nativeWall = Date.now, nativeSet = setTimeout, nativeClear = clearTimeout;
const nativeClock: ModeSessionClock = { monotonic: nativeMono, wall: nativeWall, setTimer: (f, ms) => nativeSet(f, ms), clearTimer: h => nativeClear(h as ReturnType<typeof setTimeout>) };
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const signalAdd = EventTarget.prototype.addEventListener, signalRemove = EventTarget.prototype.removeEventListener;
const inputBounds = freeze({ depth: 2, nodes: 24, props: 7, array: 0, string: 300, bytes: 8192 });
const initialFailure = (code: ValidationFailureCode): ExistingSessionValidationOutcome => freeze({ kind: 'failed', code, data: null, transaction: 'not_started', backendMayStillRun: false });
function optionSignal(raw: unknown): AbortSignal | undefined {
    try { modeRecord(raw, []); return undefined; } catch { /* A nonempty option must contain exactly one native signal. */ }
    const value = modeRecord(raw, ['signal']).signal;
    if (!value || typeof value !== 'object' || isProxy(value)) throw Error();
    signalAborted.call(value);
    return value as AbortSignal;
}
function sqlCode(error: unknown): ValidationFailureCode {
    const pair = safeModeError(error);
    if (!pair) return 'INTERNAL_ERROR';
    const [code, label] = pair;
    if (code === '40P01') return 'DEADLOCK';
    if (code === '55P03') return 'LOCK_TIMEOUT';
    if (code === '57014') return 'SERVER_TIMEOUT';
    if (code === '42501' && label === 'MODE_SESSION_FORBIDDEN') return 'FORBIDDEN';
    if (code === '22023' && (label === 'MODE_SESSION_INVALID' || label === 'MODE_SESSION_INVALID_ORIGIN')) return 'INVALID_REQUEST';
    return 'INTERNAL_ERROR';
}
type Timer = { handle?: unknown; armed: boolean; live: boolean };
type Stop = (reason: ValidationReason | 'ACQUISITION_TIMEOUT') => void;

export function createExistingModeSessionValidator({ pool, profiles, clock = nativeClock }: {
    pool: ModeSessionPool; profiles: unknown; clock?: ModeSessionClock;
}): ExistingModeSessionValidator {
    const contracts = createModeSessionContracts(profiles);
    // These are trusted dependencies, captured once rather than looked up after an await.
    const monoMethod = clock.monotonic.bind(clock), wallMethod = clock.wall.bind(clock);
    const setTimer = clock.setTimer.bind(clock), clearTimer = clock.clearTimer.bind(clock);
    const connect = pool.connect.bind(pool), poolOn = pool.on.bind(pool), poolOff = pool.removeListener.bind(pool);
    const active = new Set<Stop>();
    let closed = false, clockFailed = false, lastMono = -Infinity, lastWall = -Infinity, poolRemoved = false;
    const onPoolError = () => { for (const stop of [...active]) { try { stop('CONNECTION_FAILED'); } catch { /* One consumer cannot prevent sibling stops. */ } } };
    function removePoolListener() {
        if (poolRemoved) return;
        poolRemoved = true;
        try { poolOff('error', onPoolError); } catch { /* Stop-only close cannot promise emitter repair. */ }
    }
    function breakClock() {
        clockFailed = true; closed = true;
        for (const stop of [...active]) { try { stop('CLOCK_UNAVAILABLE'); } catch { /* Continue every stop. */ } }
        removePoolListener();
    }
    function sample() {
        try {
            const mono = monoMethod(), wall = wallMethod();
            if (!Number.isFinite(mono) || mono < 0 || mono < lastMono || !Number.isSafeInteger(wall) || wall < lastWall) throw Error();
            lastMono = mono; lastWall = wall;
            return { mono, wall };
        } catch { breakClock(); throw Error('VALIDATION_CLOCK_FAILED'); }
    }
    try { poolOn('error', onPoolError); } catch { closed = true; removePoolListener(); }

    function validateExisting(input: unknown, options: ModeSessionOptions = {}): Promise<ExistingSessionValidationOutcome> {
        if (clockFailed) return Promise.resolve(initialFailure('CLOCK_UNAVAILABLE'));
        if (closed) return Promise.resolve(initialFailure('CLOSED'));
        if (active.size >= 2) return Promise.resolve(initialFailure('CONTEXT_BUSY'));
        return new Promise(resolve => {
            let settled = false, finishing = false, beginSent = false;
            let phase: 'acquiring' | 'transaction' | 'committing' | 'committed' | 'rolled_back' = 'acquiring';
            let start = 0, started = false, expiry: bigint | undefined, budgetMs = 10000;
            let signal: AbortSignal | undefined, signalAttached = false, client: ModeSessionClient | undefined;
            let released = false, discarding = false, errorAttached = false, endAttached = false, connectionFault = false;
            let request: ModeSessionIssueRequest, baseline: { sessionId: string; issuedAt: string; expiresAt: string }, values: unknown[];
            let data: ModeSessionIssueReceipt | undefined;
            const timers: Timer[] = [];
            const pendingReasons = new Set<ValidationReason | 'ACQUISITION_TIMEOUT'>();
            const failed = (code: ValidationFailureCode): ExistingSessionValidationOutcome => ({ kind: 'failed', code, data: null, transaction: beginSent ? 'no_commit_submitted' : 'not_started', backendMayStillRun: beginSent });
            const classify = (code: ValidationFailureCode): ExistingSessionValidationOutcome => {
                if (phase === 'rolled_back') return { kind: 'failed', code: 'INTERNAL_ERROR', data: null, transaction: 'rolled_back', backendMayStillRun: false };
                if (phase === 'committed') return { kind: 'completed', delivery: 'withheld', data: null, reason: code === 'ACQUISITION_TIMEOUT' ? 'DEADLINE' : code as ValidationReason };
                if (phase === 'committing') return { kind: 'completion_uncertain', code: 'READ_COMPLETION_UNCERTAIN', data: null, backendMayStillRun: true };
                return failed(code);
            };
            function observeStop(): ValidationReason | 'ACQUISITION_TIMEOUT' | undefined {
                let point: { mono: number; wall: number } | undefined;
                try { point = sample(); } catch { /* Terminal flag is authoritative. */ }
                if (clockFailed) return 'CLOCK_UNAVAILABLE';
                if (closed || pendingReasons.has('CLOSED')) return 'CLOSED';
                if (signal && signalAborted.call(signal) || pendingReasons.has('ABORTED')) return 'ABORTED';
                if (pendingReasons.has('DEADLINE') || point && started && point.mono - start >= 10000) return 'DEADLINE';
                if (phase === 'acquiring' && (pendingReasons.has('ACQUISITION_TIMEOUT') || point && started && point.mono - start >= 3000)) return 'ACQUISITION_TIMEOUT';
                if (pendingReasons.has('EXPIRED') || point && expiry !== undefined && (BigInt(point.wall) * 1000n >= expiry || point.mono - start >= budgetMs)) return 'EXPIRED';
                if (connectionFault || pendingReasons.has('CONNECTION_FAILED')) return 'CONNECTION_FAILED';
                return undefined;
            }
            function clearOwned(t: Timer) {
                if (!t.live) return;
                t.live = false;
                if (t.armed) { try { clearTimer(t.handle); } catch { breakClock(); } }
            }
            function detachClient() {
                if (!client) return;
                if (errorAttached) { errorAttached = false; try { client.removeListener('error', onClientError); } catch { connectionFault = true; } }
                if (endAttached) { endAttached = false; try { client.removeListener('end', onClientEnd); } catch { connectionFault = true; } }
            }
            function dispose(bad: boolean) {
                if (!client || released) return;
                released = true; discarding = bad;
                try { client.release(bad ? Error('VALIDATION_CLIENT_DISCARDED') : undefined); } catch { connectionFault = true; }
                if (!bad) detachClient();
            }
            function finish(out: ExistingSessionValidationOutcome, good = false) {
                if (settled || finishing) return;
                // Claim settlement before trusted cleanup can reenter. Keep the reservation until resolution.
                finishing = true;
                let reason = observeStop();
                if (reason) out = classify(reason);
                for (const timer of timers) clearOwned(timer);
                if (signal && signalAttached) {
                    signalAttached = false;
                    try { signalRemove.call(signal, 'abort', onAbort); } catch { connectionFault = true; }
                }
                dispose(!(good && out.kind === 'completed' && out.delivery === 'data'));
                reason = observeStop();
                if (reason) out = classify(reason);
                settled = true; finishing = false; active.delete(stop);
                resolve(freeze(out));
            }
            function stop(reason: ValidationReason | 'ACQUISITION_TIMEOUT') {
                if (settled) return;
                pendingReasons.add(reason);
                if (!finishing) finish(classify(reason));
            }
            function guard() {
                if (settled || finishing) return false;
                const reason = observeStop();
                if (reason) { stop(reason); return false; }
                return true;
            }
            function onAbort() { stop('ABORTED'); }
            function onClientError() { if (!discarding) { connectionFault = true; stop('CONNECTION_FAILED'); } }
            function onClientEnd() { if (!discarding) { connectionFault = true; stop('CONNECTION_FAILED'); } detachClient(); }
            function arm(ms: number, reason: ValidationReason | 'ACQUISITION_TIMEOUT') {
                const timer: Timer = { armed: false, live: true }; timers.push(timer);
                try {
                    timer.handle = setTimer(() => { if (timer.live) stop(reason); }, ms);
                    timer.armed = true;
                    if (!timer.live || settled) { timer.live = true; clearOwned(timer); }
                } catch { breakClock(); }
            }
            active.add(stop); // Atomic logical reservation, before parsing or any dependency callback.
            try {
                const first = sample(); start = first.mono; started = true;
                if (!guard()) return;
                signal = optionSignal(options);
                const copied = copySessionValue(input, inputBounds);
                const fields = modeRecord(copied, ['tokenHash', 'request', 'baseline']);
                if (typeof fields.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(fields.tokenHash)) throw Error();
                request = contracts.issue(fields.request);
                const rawBaseline = modeRecord(fields.baseline, ['sessionId', 'issuedAt', 'expiresAt']);
                sessionUuid(rawBaseline.sessionId);
                const issued = sessionMicros(rawBaseline.issuedAt), candidateExpiry = sessionMicros(rawBaseline.expiresAt);
                if (candidateExpiry - issued !== 900000000n) throw Error();
                expiry = candidateExpiry;
                baseline = rawBaseline as typeof baseline;
                const remaining = expiry - BigInt(first.wall) * 1000n;
                budgetMs = remaining <= 0n ? 0 : Number((remaining > 10000000n ? 10000000n : remaining) / 1000n);
                values = [fields.tokenHash, baseline.sessionId, request.installationId, request.rendererOrigin, request.parentOrigin, request.deploymentProfileVersion, request.expectedVersionId, request.expectedTargetRevision, request.expectedPolicyRevision, baseline.issuedAt, baseline.expiresAt];
                if (signal) { signalAttached = true; signalAdd.call(signal, 'abort', onAbort, { once: true }); }
                if (!guard()) return;
                arm(Math.max(0, 10000 - (sample().mono - start)), 'DEADLINE');
                if (!guard()) return;
                arm(Math.max(0, 3000 - (sample().mono - start)), 'ACQUISITION_TIMEOUT');
                if (!guard()) return;
                if (budgetMs < 10000) arm(Math.max(0, budgetMs - (sample().mono - start)), 'EXPIRED');
            } catch { if (!settled && !finishing) finish(failed(clockFailed ? 'CLOCK_UNAVAILABLE' : 'INVALID_REQUEST')); return; }
            if (!guard()) return;
            void (async () => {
                try {
                    try { client = await connect(); } catch { if (guard()) finish(failed('CONNECTION_FAILED')); return; }
                    try { errorAttached = true; client.on('error', onClientError); endAttached = true; client.on('end', onClientEnd); }
                    catch { connectionFault = true; if (!settled) stop('CONNECTION_FAILED'); dispose(true); return; }
                    if (!guard()) { dispose(true); return; }
                    clearOwned(timers[1]!); // Acquisition remains guarded through cleanup and the first BEGIN dispatch.
                    if (!guard()) return;
                    const command = async (sql: string, expected: string, parameters?: unknown[]) => {
                        if (!guard()) return false;
                        if (sql.startsWith('BEGIN')) { beginSent = true; phase = 'transaction'; }
                        const raw = await client!.query(sql, parameters);
                        if (!guard()) return false;
                        if (modeCommand(raw) !== expected) throw Error();
                        return raw;
                    };
                    if (!await command('BEGIN ISOLATION LEVEL READ COMMITTED', 'BEGIN')) return;
                    for (const sql of ["SET LOCAL statement_timeout='5s'", "SET LOCAL lock_timeout='5s'", "SET LOCAL idle_in_transaction_session_timeout='1s'", 'SET LOCAL ROLE service_role']) {
                        if (!await command(sql, 'SET')) return;
                    }
                    const raw = await command(EXISTING_SESSION_VALIDATION_SQL, 'SELECT', values);
                    if (!raw) return;
                    data = contracts.issueReceipt(sessionResult(raw), request);
                    if (data.sessionId !== baseline.sessionId || data.issuedAt !== baseline.issuedAt || data.expiresAt !== baseline.expiresAt) throw Error();
                    if (!guard() || !await command('SET CONSTRAINTS ALL IMMEDIATE', 'SET') || !guard()) return;
                    phase = 'committing';
                    const acknowledgement = await client.query('COMMIT');
                    if (settled || finishing) return;
                    const tag = modeCommand(acknowledgement);
                    if (tag === 'ROLLBACK') { phase = 'rolled_back'; finish(classify('INTERNAL_ERROR')); return; }
                    if (tag !== 'COMMIT') { finish(classify('INTERNAL_ERROR')); return; }
                    phase = 'committed';
                    finish({ kind: 'completed', delivery: 'data', data }, true);
                } catch (error) {
                    if (!settled && !finishing) {
                        if (phase === 'committing' || phase === 'committed') finish(classify('CONNECTION_FAILED'));
                        else if (guard()) finish(failed(sqlCode(error)));
                    }
                }
            })();
        });
    }
    return freeze({ validateExisting, close() {
        if (closed) return;
        closed = true;
        for (const stop of [...active]) { try { stop('CLOSED'); } catch { /* Continue all remaining stops and return void. */ } }
        removePoolListener();
    } });
}
