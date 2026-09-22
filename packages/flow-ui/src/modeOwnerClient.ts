import { z } from 'zod';
import { operationReceipt, installationPage, installationHistory, requestPage, profileResponse, httpFailure, outcomeSchema, type OwnerMethod, type OwnerBodies, type OwnerData, type OwnerDelivery } from './modeOwnerTypes';
const schemas = { publish: operationReceipt, install: operationReceipt, 'apply-version': operationReceipt, 'update-policy': operationReceipt, installations: installationPage, 'installation-history': installationHistory, operation: operationReceipt, 'request-history': requestPage };
export const isModeMutation = (method: OwnerMethod) => ['publish', 'install', 'apply-version', 'update-policy'].includes(method);
export class ModeReadError extends Error {
    constructor() { super('Read outcome unavailable. Refresh to try again.'); }
}
export function createModeOwnerClient(base: string, fetcher: typeof fetch = fetch) {
    const url = new URL(base);
    if (url.origin !== base || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024 || url.username || url.password)
        throw new Error('Local owner API unavailable.');
    let generation = 0;
    const active = new Set<AbortController>();
    function invalidate() {
        generation++;
        for (const c of active)
            c.abort();
        active.clear();
    }
    async function wire(path: string, token: string, body: unknown, limit: number): Promise<unknown> {
        const at = generation, c = new AbortController(), started = performance.now();
        const check = () => {
            const now = performance.now();
            if (!Number.isFinite(now) || now < started || now - started >= 16000 || at !== generation || c.signal.aborted)
                throw new Error('Request unavailable');
        };
        active.add(c);
        let rejectDeadline!: (e: Error) => void;
        const stopped = new Promise<never>((_, reject) => { rejectDeadline = reject; });
        const onAbort = () => rejectDeadline(new Error('Request unavailable'));
        c.signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => c.abort(), 16000);
        const bounded = <T>(promise: Promise<T>) => Promise.race([promise, stopped]);
        try {
            if (!/^[A-Za-z0-9._~-]{16,256}$/.test(token))
                throw new Error('Invalid credential');
            const encoded = body === undefined ? undefined : JSON.stringify(body);
            if (encoded !== undefined && new TextEncoder().encode(encoded).length > 16384)
                throw new Error('Request too large');
            if (at !== generation || c.signal.aborted)
                throw new Error('Stale request');
            check();
            const fetching = fetcher(base + '/api/local/mode-owner/' + path, { method: encoded === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: encoded, signal: c.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
            void fetching.then(response => {
                if (c.signal.aborted || at !== generation)
                    void response.body?.cancel().catch(() => { });
            }, () => { });
            const response = await bounded(fetching);
            check();
            if (response.redirected || !response.body)
                throw new Error('Invalid response');
            const reader = response.body.getReader(), buffer = new Uint8Array(limit);
            let count = 0;
            try {
                for (;;) {
                    check();
                    const { done, value } = await bounded(reader.read());
                    check();
                    if (at !== generation || c.signal.aborted)
                        throw new Error('Stale response');
                    if (done)
                        break;
                    if (value.length > limit - count)
                        throw new Error('Response too large');
                    buffer.set(value, count);
                    count += value.length;
                }
            }
            catch (e) {
                void reader.cancel().catch(() => { });
                throw e;
            }
            finally {
                try {
                    reader.releaseLock();
                }
                catch { }
            }
            if (at !== generation || c.signal.aborted)
                throw new Error('Stale response');
            const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count)));
            check();
            return parsed;
        }
        finally {
            clearTimeout(timer);
            c.signal.removeEventListener('abort', onAbort);
            active.delete(c);
        }
    }
    return { invalidate,
        async profile(token: string) {
            try {
                return profileResponse.parse(await wire('profile', token, undefined, 16384));
            }
            catch {
                throw new ModeReadError();
            }
        },
        async call<M extends OwnerMethod>(method: M, token: string, body: OwnerBodies[M]): Promise<OwnerDelivery<OwnerData[M]>> {
            const mutation = isModeMutation(method);
            try {
                const raw = await wire(method, token, body, 1048576);
                const rejection = httpFailure.safeParse(raw);
                if (rejection.success)
                    return rejection.data;
                const uncertain = z.object({ schemaVersion: z.literal(1), phase: z.literal('delivery_uncertain'), operationKind: z.literal(mutation ? 'mutation' : 'read'), code: z.literal('OUTCOME_UNAVAILABLE') }).strict().safeParse(raw);
                if (uncertain.success)
                    return uncertain.data;
                const parsed = z.object({ schemaVersion: z.literal(1), phase: z.literal('repository_result'), outcome: outcomeSchema(schemas[method], mutation) }).strict().parse(raw);
                const outcome = parsed.outcome;
                if (outcome.kind === 'failed' && (method === 'request-history' ? ['UNAVAILABLE', 'UNSUPPORTED'].includes(outcome.code) : outcome.code === 'NOT_FOUND'))
                    throw new Error('Invalid failure code');
                const data = 'receipt' in outcome ? outcome.receipt : 'data' in outcome ? outcome.data : null;
                if (data && typeof data === 'object') {
                    const d = data as Record<string, unknown>, r = body as unknown as Record<string, unknown>;
                    const require = (ok: unknown) => {
                        if (!ok)
                            throw new Error('Mismatched response');
                    };
                    if ('operation' in d) {
                        require(d.flowId === r.flowId);
                        require(d.operation === ({ publish: 'publish', install: 'install', 'apply-version': 'apply', 'update-policy': 'policy', operation: r.operation } as Record<string, unknown>)[method]);
                        if (method === 'publish')
                            require(d.sourceRevision === r.expectedDraftRevision);
                        if (method === 'install')
                            require(d.currentVersionId === r.versionId && d.mode === r.mode && d.deploymentProfileVersion === r.deploymentProfileVersion && JSON.stringify(d.allowedParentOrigins) === JSON.stringify(r.allowedParentOrigins));
                        if (method === 'apply-version')
                            require(d.installationId === r.installationId && d.previousVersionId === r.expectedCurrentVersionId && d.currentVersionId === r.newVersionId && d.changed === (r.newVersionId !== r.expectedCurrentVersionId) && d.targetRevision === Number(r.expectedTargetRevision) + (d.changed ? 1 : 0));
                        if (method === 'update-policy')
                            require(d.installationId === r.installationId && d.enabled === r.enabled && JSON.stringify(d.allowedParentOrigins) === JSON.stringify(r.allowedParentOrigins) && d.policyRevision === Number(r.expectedPolicyRevision) + (d.changed ? 1 : 0));
                    }
                    if (method === 'installations') {
                        const page = installationPage.parse(d);
                        let previous = r.afterId as string | null;
                        require(page.installations.length <= Number(r.limit));
                        for (const row of page.installations) {
                            require(row.flowId === r.flowId && (!previous || row.installationId > previous));
                            previous = row.installationId;
                        }
                        require(page.nextCursor === null || (page.installations.length === r.limit && page.nextCursor === previous));
                    }
                    if (method === 'installation-history') {
                        const page = installationHistory.parse(d);
                        let previous = r.beforeSequence as number | null;
                        require(page.history.length <= Number(r.limit));
                        for (const row of page.history) {
                            require((previous === null || row.sequence < previous) && BigInt(row.sequence) === BigInt(row.targetRevision) + BigInt(row.policyRevision) - 1n);
                            previous = row.sequence;
                        }
                        require(page.nextCursor === null || (page.history.length === r.limit && page.nextCursor === previous));
                    }
                    if (method === 'request-history') {
                        const page = requestPage.parse(d);
                        let previous = r.beforeCreatedAt === null ? null : { createdAt: r.beforeCreatedAt as string, bookingId: r.beforeBookingId as string };
                        require(page.requests.length <= Number(r.limit));
                        for (const row of page.requests) {
                            require(previous === null || row.createdAt < previous.createdAt || (row.createdAt === previous.createdAt && row.bookingId < previous.bookingId));
                            previous = row;
                        }
                        require(page.nextCursor === null || (page.requests.length === r.limit && page.nextCursor.createdAt === previous?.createdAt && page.nextCursor.bookingId === previous?.bookingId));
                    }
                }
                return parsed as OwnerDelivery<OwnerData[M]>;
            }
            catch {
                return { phase: 'delivery_uncertain', operationKind: mutation ? 'mutation' : 'read', code: 'OUTCOME_UNAVAILABLE' };
            }
        }
    };
}
export type ModeOwnerClient = ReturnType<typeof createModeOwnerClient>;
