/** Bounded owner-only loopback HTTP boundary. No customer capability or public policy route. */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';
import { createModeContracts, modeRecord, type ModeMethod } from './mode-installation-contracts';
import { copySessionValue, createModeSessionContracts, sessionUuid } from './mode-session-contracts';
import type { ModeOwnerComposition } from './mode-owner-composition';
const json = JSON.stringify, parse = JSON.parse, bytes = Buffer.byteLength.bind(Buffer), from = Buffer.from.bind(Buffer), concat = Buffer.concat.bind(Buffer), freeze = Object.freeze, nativeSet = setTimeout, nativeClear = clearTimeout;
const BASE = '/api/local/mode-owner/';
const routeMethods = { 'publish': 'publish', 'install': 'install', 'apply-version': 'applyVersion', 'update-policy': 'updatePolicy', 'installations': 'ownerInstallations', 'installation-history': 'ownerHistory', 'operation': 'ownerOperation', 'request-history': 'requestHistory' } as const;
export type ModeOwnerRoute = keyof typeof routeMethods;
const mutations = new Set<ModeOwnerRoute>(['publish', 'install', 'apply-version', 'update-policy']);
type HttpCode = 'INVALID_HTTP' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'BODY_TOO_LARGE' | 'RATE_LIMITED' | 'HTTP_DEADLINE' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';
const status: Record<HttpCode, number> = { INVALID_HTTP: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405, BODY_TOO_LARGE: 413, RATE_LIMITED: 429, HTTP_DEADLINE: 504, SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500 };
class HttpFailure extends Error {
    constructor(readonly code: HttpCode, readonly retry?: number) { super(code); }
}
const fail = (code: HttpCode): never => { throw new HttpFailure(code); };
const uncertain = { mutation: from('{"schemaVersion":1,"phase":"delivery_uncertain","operationKind":"mutation","code":"OUTCOME_UNAVAILABLE"}'), read: from('{"schemaVersion":1,"phase":"delivery_uncertain","operationKind":"read","code":"OUTCOME_UNAVAILABLE"}') };
const outcomeStatus: Record<string, number> = { INVALID_REQUEST: 400, FORBIDDEN: 403, CONFLICT: 409, NOT_FOUND: 404, UNAVAILABLE: 404, UNSUPPORTED: 422, LIMIT_EXCEEDED: 413, LOCK_TIMEOUT: 409, DEADLOCK: 409, SERVER_TIMEOUT: 504, DEADLINE: 504, ACQUISITION_TIMEOUT: 504, CLOSED: 503, CLOCK_UNAVAILABLE: 503, CONNECTION_FAILED: 503, INTERNAL_ERROR: 500, ABORTED: 409 };
const withheld = ['DEADLINE', 'ABORTED', 'CLOSED', 'CLOCK_UNAVAILABLE', 'CONNECTION_FAILED'];
export interface ModeOwnerHttp {
    server: Server;
    stopAdmission(): void;
}
export interface ModeOwnerHttpTestOptions {
    composition: ModeOwnerComposition;
    now?: () => number;
    serialize?: (value: unknown) => string;
    afterRepository?: (context: Readonly<{
        route: ModeOwnerRoute;
        request: unknown;
        outcome: unknown;
    }>) => void | Promise<void>;
}
/** Parse duplicate object names before normal JSON construction; body bytes are already bounded. */
function strictJson(text: string): unknown {
    let i = 0;
    const ws = () => {
        while (/[ \t\r\n]/.test(text[i] ?? 'x'))
            i++;
    };
    const string = () => {
        const start = i;
        if (text[i++] !== '"')
            fail('INVALID_HTTP');
        while (i < text.length) {
            if (text[i] === '\\') {
                i += 2;
                continue;
            }
            if (text[i++] === '"')
                return parse(text.slice(start, i)) as string;
        }
        return fail('INVALID_HTTP');
    };
    const value = (depth: number): void => {
        if (depth > 12)
            fail('INVALID_HTTP');
        ws();
        if (text[i] === '{') {
            i++;
            ws();
            const seen = new Set<string>();
            if (text[i] === '}') {
                i++;
                return;
            }
            for (;;) {
                ws();
                const key = string();
                if (seen.has(key))
                    fail('INVALID_HTTP');
                seen.add(key);
                ws();
                if (text[i++] !== ':')
                    fail('INVALID_HTTP');
                value(depth + 1);
                ws();
                const end = text[i++];
                if (end === '}')
                    return;
                if (end !== ',')
                    fail('INVALID_HTTP');
            }
        }
        else if (text[i] === '[') {
            i++;
            ws();
            if (text[i] === ']') {
                i++;
                return;
            }
            for (;;) {
                value(depth + 1);
                ws();
                const end = text[i++];
                if (end === ']')
                    return;
                if (end !== ',')
                    fail('INVALID_HTTP');
            }
        }
        else if (text[i] === '"')
            string();
        else {
            const start = i;
            while (i < text.length && !/[ \t\r\n,}\]]/.test(text[i]!))
                i++;
            if (i === start)
                fail('INVALID_HTTP');
        }
    };
    try {
        value(0);
        ws();
        if (i !== text.length)
            fail('INVALID_HTTP');
        return parse(text);
    }
    catch {
        return fail('INVALID_HTTP');
    }
}
function body(req: IncomingMessage, signal: AbortSignal, length: number, remaining: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let size = 0, done = false;
        const chunks: Buffer[] = [];
        const timer = nativeSet(() => finish(new HttpFailure('HTTP_DEADLINE')), Math.max(0, remaining));
        const cleanup = () => { nativeClear(timer); req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', error); req.removeListener('aborted', aborted); signal.removeEventListener('abort', aborted); };
        const finish = (e?: Error, v?: unknown) => {
            if (done)
                return;
            done = true;
            cleanup();
            if (e)
                reject(e);
            else
                resolve(v);
        };
        const data = (chunk: Buffer) => {
            size += chunk.length;
            if (size > 16384 || size > length) {
                finish(new HttpFailure('BODY_TOO_LARGE'));
                return;
            }
            chunks.push(chunk);
        };
        const end = () => {
            if (size !== length) {
                finish(new HttpFailure('INVALID_HTTP'));
                return;
            }
            try {
                finish(undefined, strictJson(new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks))));
            }
            catch (e) {
                finish(e instanceof HttpFailure ? e : new HttpFailure('INVALID_HTTP'));
            }
        };
        const error = () => finish(new HttpFailure('INVALID_HTTP')), aborted = () => finish(new HttpFailure('HTTP_DEADLINE'));
        req.on('data', data);
        req.once('end', end);
        req.once('error', error);
        req.once('aborted', aborted);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted)
            aborted();
    });
}
function headers(req: IncomingMessage, composition: ModeOwnerComposition): Record<string, string> {
    const sensitive = new Set(['host', 'origin', 'authorization', 'content-type', 'content-length', 'access-control-request-method', 'access-control-request-headers']);
    const values: Record<string, string> = Object.create(null);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]!.toLowerCase(), value = req.rawHeaders[i + 1]!;
        if (['transfer-encoding', 'content-encoding', 'cookie', 'proxy-authorization'].includes(name))
            fail('INVALID_HTTP');
        if (sensitive.has(name)) {
            if (Object.hasOwn(values, name))
                fail('INVALID_HTTP');
            values[name] = value;
        }
    }
    if (values.host !== new URL(composition.localOwnerApi).host)
        fail('FORBIDDEN');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''))
        fail('FORBIDDEN');
    if (values.origin !== composition.localPortalOrigin)
        fail('FORBIDDEN');
    return values;
}
function validateOutcome(raw: unknown, route: ModeOwnerRoute, copied: any, s1: ReturnType<typeof createModeContracts>, s2: ReturnType<typeof createModeSessionContracts>): {
    outcome: any;
    status: number;
} {
    const out = copySessionValue(raw, { depth: 8, nodes: 8192, props: 16, array: 100, string: 512, bytes: 1048576 });
    const isMutation = mutations.has(route), method = routeMethods[route];
    const data = (v: unknown) => method === 'requestHistory' ? s2.history(v, copied.request) : s1.parseResult(method as Exclude<ModeMethod, 'publicPolicy'>, { command: 'SELECT', rowCount: 1, rows: [{ result: v }] }, copied);
    if (out.kind === 'failed') {
        modeRecord(out, ['kind', 'code', 'transaction', 'backendMayStillRun']);
        if (typeof out.code !== 'string' || !Object.hasOwn(outcomeStatus, out.code) || (route === 'request-history' ? ['UNAVAILABLE', 'UNSUPPORTED'].includes(out.code) : out.code === 'NOT_FOUND') || !['not_started', 'no_commit_submitted', 'rolled_back'].includes(out.transaction) || out.backendMayStillRun !== (out.transaction === 'no_commit_submitted'))
            throw Error('INVALID_OUTCOME');
        return { outcome: out, status: outcomeStatus[out.code]! };
    }
    if (out.kind === 'unknown_commit' && isMutation) {
        modeRecord(out, ['kind', 'code', 'receipt', 'reconciliation']);
        if (out.code !== 'COMMIT_UNCERTAIN' || out.receipt !== null || out.reconciliation !== 'EXPLICIT_OWNER_OPERATION')
            throw Error('INVALID_OUTCOME');
        return { outcome: out, status: 202 };
    }
    if (out.kind === 'completion_uncertain' && !isMutation) {
        modeRecord(out, ['kind', 'code', 'data', 'backendMayStillRun']);
        if (out.code !== 'READ_COMPLETION_UNCERTAIN' || out.data !== null || out.backendMayStillRun !== true)
            throw Error('INVALID_OUTCOME');
        return { outcome: out, status: 202 };
    }
    if (out.kind !== (isMutation ? 'committed' : 'completed'))
        throw Error('INVALID_OUTCOME');
    const field = isMutation ? 'receipt' : 'data';
    if (out.delivery === 'withheld') {
        modeRecord(out, ['kind', 'delivery', field, 'reason']);
        if (out[field] !== null || !withheld.includes(out.reason))
            throw Error('INVALID_OUTCOME');
        return { outcome: out, status: 202 };
    }
    modeRecord(out, ['kind', 'delivery', field]);
    if (out.delivery !== (isMutation ? 'receipt' : 'data'))
        throw Error('INVALID_OUTCOME');
    return { outcome: freeze({ ...out, [field]: data(out[field]) }), status: 200 };
}
/** Controlled hooks never inspect headers/credentials and never replace the real repository result. */
export function __createModeOwnerHttpServerForTests({ composition, now = () => performance.now(), serialize = json, afterRepository }: ModeOwnerHttpTestOptions): ModeOwnerHttp {
    const s1 = createModeContracts(composition.profiles), s2 = createModeSessionContracts(composition.profiles), active = new Set<{
        stop: () => void;
    }>();
    let admitting = true, clockFailed = false, last = -Infinity;
    type Window = {
        start: number;
        count: number;
    };
    const addressRates = new Map<string, Window>(), readRates = new Map<string, Window>(), mutationRates = new Map<string, Window>(), globalRates = new Map<string, Window>();
    const maps = [addressRates, readRates, mutationRates, globalRates];
    const scopeActive = new Map<string, number>(), mutationActive = new Set<string>();
    const sample = () => {
        try {
            const n = now();
            if (!Number.isFinite(n) || n < 0 || n < last)
                throw Error();
            last = n;
            return n;
        }
        catch {
            clockFailed = true;
            admitting = false;
            // Terminal clock failure settles every admitted response before releasing its timer.
            for (const state of [...active])
                state.stop();
            throw new HttpFailure('SERVICE_UNAVAILABLE');
        }
    };
    const rate = (map: Map<string, Window>, key: string, limit: number, t: number) => {
        for (const m of maps)
            for (const [k, w] of m)
                if (t - w.start >= 60000)
                    m.delete(k);
        let w = map.get(key);
        if (!w) {
            if (maps.reduce((n, m) => n + m.size, 0) >= 1024)
                throw new HttpFailure('RATE_LIMITED', 60);
            w = { start: t, count: 0 };
            map.set(key, w);
        }
        if (w.count >= limit)
            throw new HttpFailure('RATE_LIMITED', Math.max(1, Math.ceil((60000 - (t - w.start)) / 1000)));
        w.count++;
    };
    const server = createServer({ maxHeaderSize: 8192, headersTimeout: 2000, requestTimeout: 15000, connectionsCheckingInterval: 1000 }, (req, res) => {
        let dispatchStarted = false, responded = false, released = false, repositoryPending = false, scope: string | undefined, mutationScope: string | undefined, route: ModeOwnerRoute | undefined, admitted = false, scopeCounted = false;
        const headerAt = performance.now();
        let requestAt = 0;
        const controller = new AbortController();
        let total: ReturnType<typeof setTimeout> | undefined;
        const common = () => {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Vary', 'Origin');
            if (req.headers.origin === composition.localPortalOrigin)
                res.setHeader('Access-Control-Allow-Origin', composition.localPortalOrigin);
        };
        const release = () => {
            if (released || repositoryPending)
                return;
            released = true;
            if (total)
                nativeClear(total);
            if (admitted)
                active.delete(state);
            if (scope && scopeCounted) {
                const n = (scopeActive.get(scope) ?? 1) - 1;
                if (n)
                    scopeActive.set(scope, n);
                else
                    scopeActive.delete(scope);
            }
            if (mutationScope)
                mutationActive.delete(mutationScope);
        };
        const send = (httpStatus: number, buffer: Buffer, extra?: Record<string, string>) => {
            if (responded || res.destroyed)
                return;
            responded = true;
            if (res.headersSent) {
                res.destroy();
                return;
            }
            common();
            for (const [k, v] of Object.entries(extra ?? {}))
                res.setHeader(k, v);
            res.writeHead(httpStatus);
            res.end(buffer);
        };
        const uncertainResponse = () => {
            if (res.headersSent || res.destroyed) {
                responded = true;
                res.destroy();
                return;
            }
            send(202, uncertain[route && mutations.has(route) ? 'mutation' : 'read']);
        };
        const reject = (e: HttpFailure) => {
            if (dispatchStarted) {
                uncertainResponse();
                return;
            }
            send(status[e.code], from(json({ schemaVersion: 1, phase: 'not_dispatched', error: { code: e.code } })), e.retry ? { 'Retry-After': String(e.retry) } : undefined);
        };
        const stop = () => {
            controller.abort();
            if (!responded)
                reject(new HttpFailure(admitting && !clockFailed ? 'HTTP_DEADLINE' : 'SERVICE_UNAVAILABLE'));
            release();
        };
        const state = { stop };
        res.once('close', () => {
            if (!res.writableFinished) {
                responded = true;
                controller.abort();
                release();
            }
        });
        void (async () => {
            try {
                const start = sample();
                requestAt = start;
                rate(globalRates, 'global', 600, start);
                rate(addressRates, req.socket.remoteAddress ?? 'unknown', 120, start);
                if (!admitting || clockFailed)
                    fail('SERVICE_UNAVAILABLE');
                if (active.size >= 16)
                    throw new HttpFailure('RATE_LIMITED', 1);
                active.add(state);
                admitted = true;
                total = nativeSet(stop, 15000);
                const h = headers(req, composition), target = req.url ?? '';
                if (!target.startsWith('/') || /[?#%]/.test(target) || target.includes('//') || target.endsWith('/'))
                    fail('INVALID_HTTP');
                const suffix = target.startsWith(BASE) ? target.slice(BASE.length) : '', profileRoute = target === BASE + 'profile';
                if (!profileRoute && !Object.hasOwn(routeMethods, suffix))
                    fail('NOT_FOUND');
                if (!profileRoute)
                    route = suffix as ModeOwnerRoute;
                const expectedMethod = profileRoute ? 'GET' : 'POST';
                if (req.method === 'OPTIONS') {
                    if (h.authorization !== undefined || h['access-control-request-method'] !== expectedMethod || (h['content-length'] !== undefined && h['content-length'] !== '0'))
                        fail('INVALID_HTTP');
                    const requested = (h['access-control-request-headers'] ?? '').split(',').map(x => x.trim().toLowerCase()), expected = profileRoute ? ['authorization'] : ['authorization', 'content-type'];
                    if (requested.length !== expected.length || new Set(requested).size !== requested.length || requested.some(x => !expected.includes(x)))
                        fail('FORBIDDEN');
                    send(204, from(''), { 'Access-Control-Allow-Methods': expectedMethod, 'Access-Control-Allow-Headers': expected.join(', '), 'Access-Control-Max-Age': '60' });
                    return;
                }
                if (req.method !== expectedMethod)
                    fail('METHOD_NOT_ALLOWED');
                if (h['access-control-request-method'] !== undefined || h['access-control-request-headers'] !== undefined)
                    fail('INVALID_HTTP');
                if (!h.authorization || !/^Bearer [A-Za-z0-9._~-]{16,256}$/.test(h.authorization))
                    fail('UNAUTHENTICATED');
                const auth = composition.authenticateOwner(h.authorization!.slice(7));
                let authTimer: ReturnType<typeof setTimeout> | undefined;
                let actor: string | null;
                try {
                    actor = await Promise.race([auth, new Promise<never>((_, reject) => { authTimer = nativeSet(() => reject(new HttpFailure('UNAUTHENTICATED')), 1000); })]);
                }
                finally {
                    if (authTimer)
                        nativeClear(authTimer);
                }
                if (responded || controller.signal.aborted)
                    return;
                if (!actor)
                    fail('UNAUTHENTICATED');
                sessionUuid(actor);
                let copied: any, request: any;
                if (profileRoute) {
                    if (h['content-length'] !== undefined && h['content-length'] !== '0')
                        fail('INVALID_HTTP');
                    scope = actor + '|profile';
                }
                else {
                    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(h['content-type'] ?? ''))
                        fail('INVALID_HTTP');
                    const rawLength = h['content-length'];
                    if (!rawLength || !/^[1-9][0-9]{0,4}$/.test(rawLength))
                        fail('INVALID_HTTP');
                    if (Number(rawLength) > 16384)
                        fail('BODY_TOO_LARGE');
                    const raw = await body(req, controller.signal, Number(rawLength), 2000 - (performance.now() - headerAt));
                    if (responded || controller.signal.aborted)
                        return;
                    const a = { mode: 'local_synthetic' as const, userId: actor };
                    try {
                        copied = route === 'request-history' ? s2.owner(a, raw) : s1.copyInput(routeMethods[route!] as Exclude<ModeMethod, 'publicPolicy'>, a, raw);
                    }
                    catch {
                        fail('INVALID_HTTP');
                    }
                    request = copied.request;
                    scope = actor + '|' + request.tenantId;
                }
                const t = sample();
                if (!admitting || controller.signal.aborted || responded)
                    return;
                const isMutation = route !== undefined && mutations.has(route);
                rate(isMutation ? mutationRates : readRates, scope!, isMutation ? 30 : 120, t);
                if ((scopeActive.get(scope!) ?? 0) >= 2)
                    throw new HttpFailure('RATE_LIMITED', 1);
                if (isMutation) {
                    mutationScope = scope + '|' + request.flowId;
                    if (mutationActive.has(mutationScope)) {
                        mutationScope = undefined;
                        throw new HttpFailure('RATE_LIMITED', 1);
                    }
                    mutationActive.add(mutationScope);
                }
                scopeActive.set(scope!, (scopeActive.get(scope!) ?? 0) + 1);
                scopeCounted = true;
                if (profileRoute) {
                    const text = json({ schemaVersion: 1, profile: composition.profile, deliveryEnabled: false });
                    if (bytes(text) > 16384)
                        fail('INTERNAL_ERROR');
                    send(200, from(text));
                    return;
                }
                if (!admitting || controller.signal.aborted || responded)
                    return;
                const method = routeMethods[route!], invoke = composition.owner[method] as (actor: unknown, request: unknown, options: {
                    signal: AbortSignal;
                }) => Promise<unknown>;
                if (sample() - requestAt >= 15000)
                    fail('HTTP_DEADLINE');
                dispatchStarted = true;
                repositoryPending = true;
                let raw: unknown;
                try {
                    raw = await invoke(copied.actor, request, { signal: controller.signal });
                }
                finally {
                    repositoryPending = false;
                    if (responded)
                        release();
                }
                if (responded || controller.signal.aborted)
                    return;
                if (afterRepository)
                    await afterRepository(freeze({ route: route!, request, outcome: raw }));
                if (responded || controller.signal.aborted)
                    return;
                const checked = validateOutcome(raw, route!, copied, s1, s2), text = serialize({ schemaVersion: 1, phase: 'repository_result', outcome: checked.outcome });
                if (typeof text !== 'string' || bytes(text, 'utf8') > 1048576)
                    throw Error('WIRE_LIMIT');
                if (sample() - requestAt >= 15000)
                    fail('HTTP_DEADLINE');
                if (responded || controller.signal.aborted)
                    return;
                send(checked.status, from(text));
            }
            catch (e) {
                if (!responded)
                    reject(e instanceof HttpFailure ? e : new HttpFailure('INTERNAL_ERROR'));
            }
            finally {
                release();
            }
        })();
    });
    server.on('clientError', (_error, socket) => { socket.destroy(); });
    return freeze({ server, stopAdmission() {
            if (!admitting && !active.size)
                return;
            admitting = false;
            for (const state of [...active])
                state.stop();
        } });
}
export function createModeOwnerHttpServer({ composition }: {
    composition: ModeOwnerComposition;
}): ModeOwnerHttp { return __createModeOwnerHttpServerForTests({ composition }); }
