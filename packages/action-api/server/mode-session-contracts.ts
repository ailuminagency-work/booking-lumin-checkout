/** Server-only, local disposable mode-session contracts. No authentication or HTTP surface. */
import { types } from 'node:util';
import { createHash } from 'node:crypto';
import { createInstallationContracts, parseInstallationOrigin, type InstallationProfile } from '@lumin/contracts';
import { normalizeConfigurablePublication } from '@lumin/workflow';
import { modeRecord, modeMetadata } from './mode-installation-contracts';
export { modeRecord, modeMetadata };
const charCode = String.prototype.charCodeAt, objectKeys = Object.keys;
const proxy = types.isProxy, keys = Reflect.ownKeys, desc = Object.getOwnPropertyDescriptor, proto = Object.getPrototypeOf, isArray = Array.isArray, freeze = Object.freeze, json = JSON.stringify, bytes = Buffer.byteLength.bind(Buffer);
export type ModeSessionFailureCode = 'INVALID_REQUEST' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND' | 'LIMIT_EXCEEDED' | 'DEADLOCK' | 'LOCK_TIMEOUT' | 'SERVER_TIMEOUT' | 'INTERNAL_ERROR' | 'CONNECTION_FAILED' | 'ACQUISITION_TIMEOUT' | 'DEADLINE' | 'ABORTED' | 'CLOSED' | 'CLOCK_UNAVAILABLE' | 'EXPIRED' | 'ENTROPY_UNAVAILABLE' | 'CONTEXT_BUSY';
export type ModeSessionWithheldReason = 'DEADLINE' | 'ABORTED' | 'CLOSED' | 'CLOCK_UNAVAILABLE' | 'CONNECTION_FAILED' | 'EXPIRED';
export type ModeSessionFailure = Readonly<{
    kind: 'failed';
    code: ModeSessionFailureCode;
    transaction: 'not_started' | 'no_commit_submitted' | 'rolled_back';
    backendMayStillRun: boolean;
}>;
export type ModeSessionContext = Readonly<Record<never, never>>;
export type ModeSessionIssueRequest = Readonly<{
    installationId: string;
    deploymentProfileVersion: string;
    rendererOrigin: string;
    parentOrigin: string | null;
    expectedVersionId: string;
    expectedTargetRevision: number;
    expectedPolicyRevision: number;
}>;
export type ModeSessionIssueReceipt = Readonly<{
    schemaVersion: 1;
    sessionId: string;
    installationId: string;
    mode: 'hosted' | 'iframe';
    deploymentProfileVersion: string;
    rendererOrigin: string;
    parentOrigin: string | null;
    versionId: string;
    targetRevision: number;
    policyRevision: number;
    issuedAt: string;
    expiresAt: string;
    render: any;
}>;
export type ModeSessionSubmitReceipt = Readonly<{
    schemaVersion: 1;
    reference: string;
    initialState: 'draft';
    state: string;
    requestAccepted: true;
    replayed: boolean;
}>;
export type ModeSessionHistoryRequest = Readonly<{
    tenantId: string;
    flowId: string | null;
    beforeCreatedAt: string | null;
    beforeBookingId: string | null;
    limit: number;
}>;
export type ModeSessionHistoryPage = Readonly<{
    schemaVersion: 1;
    requests: readonly Readonly<{
        bookingId: string;
        reference: string;
        state: string;
        slotStart: string;
        createdAt: string;
    }>[];
    nextCursor: Readonly<{
        createdAt: string;
        bookingId: string;
    }> | null;
}>;
export type ModeSessionIssueOutcome = Readonly<{
    kind: 'committed';
    delivery: 'session';
    token: string;
    session: ModeSessionContext;
    receipt: ModeSessionIssueReceipt;
}> | Readonly<{
    kind: 'committed';
    delivery: 'withheld';
    token: null;
    receipt: null;
    reason: ModeSessionWithheldReason;
    attempt: ModeSessionContext | null;
}> | Readonly<{
    kind: 'unknown_commit';
    code: 'COMMIT_UNCERTAIN';
    token: null;
    receipt: null;
    attempt: ModeSessionContext | null;
    reconciliation: 'EXPLICIT_SAME_ATTEMPT';
}> | ModeSessionFailure;
export type ModeSessionSubmitOutcome = Readonly<{
    kind: 'committed';
    delivery: 'receipt';
    receipt: ModeSessionSubmitReceipt;
}> | Readonly<{
    kind: 'committed';
    delivery: 'withheld';
    receipt: null;
    reason: ModeSessionWithheldReason;
}> | Readonly<{
    kind: 'unknown_commit';
    code: 'COMMIT_UNCERTAIN';
    receipt: null;
    reconciliation: 'EXPLICIT_SAME_SESSION_REQUEST';
}> | ModeSessionFailure;
export type ModeSessionReadOutcome = Readonly<{
    kind: 'completed';
    delivery: 'data';
    data: ModeSessionHistoryPage;
}> | Readonly<{
    kind: 'completed';
    delivery: 'withheld';
    data: null;
    reason: ModeSessionWithheldReason;
}> | Readonly<{
    kind: 'completion_uncertain';
    code: 'READ_COMPLETION_UNCERTAIN';
    data: null;
    backendMayStillRun: true;
}> | ModeSessionFailure;
export type ModeSessionRecoveryOutcome = Readonly<{
    priorIssuance: 'known_committed' | 'unknown' | null;
    outcome: ModeSessionIssueOutcome;
}>;
export class ModeSessionInputError extends Error {
    constructor(readonly code: ModeSessionFailureCode = 'INVALID_REQUEST') { super(code); }
}
function need(value: unknown): asserts value {
    if (!value)
        throw new ModeSessionInputError();
}
export type SessionBounds = {
    depth: number;
    nodes: number;
    props: number;
    array: number;
    string: number;
    bytes: number;
    units?: number;
};
function fixedBounds<T extends Record<string, SessionBounds>>(records: T): Readonly<T> {
    for (const record of Object.values(records))
        freeze(record);
    return freeze(records);
}
export const SESSION_BOUNDS = fixedBounds({ actor: { depth: 1, nodes: 8, props: 2, array: 0, string: 36, bytes: 256 }, issue: { depth: 1, nodes: 16, props: 7, array: 0, string: 300, bytes: 4096 }, submit: { depth: 5, nodes: 10000, props: 50, array: 50, string: 4096, bytes: 32768 }, customer: { depth: 1, nodes: 3, props: 2, array: 0, string: 4096, bytes: 4096 }, owner: { depth: 3, nodes: 32, props: 6, array: 0, string: 36, bytes: 4096 }, registry: { depth: 4, nodes: 1024, props: 8, array: 64, string: 512, bytes: 131072 }, issueResult: { depth: 10, nodes: 30000, props: 50, array: 50, string: 1000, bytes: 1048576 }, submitResult: { depth: 1, nodes: 8, props: 6, array: 0, string: 128, bytes: 2048 }, page: { depth: 4, nodes: 1024, props: 5, array: 100, string: 128, bytes: 1048576 } });
export function sessionScalar(v: string): boolean {
    for (let i = 0; i < v.length; i++) {
        const c = charCode.call(v, i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const n = charCode.call(v, ++i);
            if (!(n >= 0xdc00 && n <= 0xdfff))
                return false;
        }
        else if (c >= 0xdc00 && c <= 0xdfff)
            return false;
    }
    return true;
}
/** Descriptor-only bounded copy. No callbacks or coercion on untrusted values. */
export function copySessionValue(value: unknown, b: SessionBounds): any {
    let nodes = 0, units = 0;
    const seen = new WeakSet<object>();
    const walk = (v: unknown, d: number): any => {
        need(++nodes <= b.nodes && d <= b.depth);
        if (v === null || typeof v === 'boolean')
            return v;
        if (typeof v === 'number') {
            need(Number.isFinite(v));
            return v;
        }
        if (typeof v === 'string') {
            need(v.length <= b.string && sessionScalar(v));
            units += v.length;
            need(b.units === undefined || units <= b.units);
            return v;
        }
        need(typeof v === 'object' && v !== null && !proxy(v) && !seen.has(v));
        seen.add(v);
        if (isArray(v)) {
            need(proto(v) === Array.prototype);
            const len = desc(v, 'length');
            need(len && 'value' in len && Number.isSafeInteger(len.value) && len.value >= 0 && len.value <= b.array);
            need(keys(v).length === len.value + 1);
            const out = [];
            for (let i = 0; i < len.value; i++) {
                const x = desc(v, String(i));
                need(x && 'value' in x && x.enumerable);
                out.push(walk(x.value, d + 1));
            }
            return freeze(out);
        }
        need(proto(v) === Object.prototype || proto(v) === null);
        const names = keys(v);
        need(names.length <= b.props);
        const out: Record<string, unknown> = {};
        for (const k of names) {
            need(typeof k === 'string' && k.length <= b.string && sessionScalar(k));
            units += k.length;
            need(b.units === undefined || units <= b.units);
            const x = desc(v, k);
            need(x && 'value' in x && x.enumerable);
            Object.defineProperty(out, k, { value: walk(x.value, d + 1), enumerable: true });
        }
        return freeze(out);
    };
    const out = walk(value, 0);
    need(bytes(json(out), 'utf8') <= b.bytes);
    return out;
}
export function sessionCanonical(value: any): string {
    const visit = (v: any): any => {
        if (isArray(v))
            return v.map(visit);
        if (v && typeof v === 'object') {
            const o = Object.create(null);
            for (const k of objectKeys(v).sort())
                o[k] = visit(v[k]);
            return o;
        }
        return v;
    };
    return json(visit(value));
}
export function sessionUuid(v: unknown): asserts v is string { need(typeof v === 'string' && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)); }
function integer(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): asserts v is number { need(Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max); }
function text(v: unknown, min: number, max: number, pg = false): asserts v is string {
    need(typeof v === 'string' && sessionScalar(v));
    let n = v.length;
    if (pg) {
        n = 0;
        for (let i = 0; i < v.length; i++, n++) {
            const c = charCode.call(v, i);
            if (c >= 0xd800 && c <= 0xdbff)
                i++;
        }
    }
    need(n >= min && n <= max);
}
export function sessionMicros(v: unknown): bigint { need(typeof v === 'string' && v.length === 27 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/.test(v)); const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10), h = +v.slice(11, 13), n = +v.slice(14, 16), s = +v.slice(17, 19); need(y >= 1 && m >= 1 && m <= 12 && d >= 1 && h <= 23 && n <= 59 && s <= 59); const date = new Date(0); date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, n, s, 0); need(date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d); return BigInt(date.getTime()) * 1000n + BigInt(v.slice(20, 26)); }
export function sessionOrigin(v: unknown): asserts v is string { text(v, 1, 300); need(/^[\x00-\x7f]+$/.test(v) && parseInstallationOrigin(v) === v); const h = new URL(v).hostname, labels = h.split('.'), last = labels[labels.length - 1]!; need(!h.includes(':') && !h.startsWith('[') && labels.every(x => !x.startsWith('xn--')) && /[a-z]/.test(last) && !/^0x[0-9a-f]*$/.test(last)); }
const states = ['draft', 'pending_payment', 'confirmed', 'completed', 'cancelled', 'refunded', 'failed'];
function catalog(v: any, pg: boolean) {
    modeRecord(v, ['id', 'name', 'durationMinutes', 'questions']);
    sessionUuid(v.id);
    text(v.name, 1, 200, pg);
    integer(v.durationMinutes, 5, 1440);
    need(isArray(v.questions) && v.questions.length >= 1 && v.questions.length <= 50);
    const ids = new Set();
    for (const q of v.questions) {
        modeRecord(q, q.kind === 'quantity' ? ['id', 'prompt', 'kind', 'required', 'choices', 'minQty', 'maxQty'] : ['id', 'prompt', 'kind', 'required', 'choices']);
        text(q.id, 1, 100, pg);
        need(!['__proto__', 'constructor', 'prototype'].includes(q.id) && !ids.has(q.id));
        ids.add(q.id);
        text(q.prompt, 1, 500, pg);
        need(typeof q.required === 'boolean' && ['quantity', 'single_choice', 'multi_choice'].includes(q.kind) && isArray(q.choices));
        if (q.kind === 'quantity') {
            integer(q.minQty, 0, 10000);
            integer(q.maxQty, q.minQty, 10000);
            need(q.choices.length === 0);
        }
        else {
            need(q.choices.length >= 1 && q.choices.length <= 50);
            const choices = new Set();
            for (const c of q.choices) {
                modeRecord(c, ['id', 'label']);
                text(c.id, 1, 100, pg);
                text(c.label, 1, 200, pg);
                need(!choices.has(c.id));
                choices.add(c.id);
            }
        }
    }
}
function render(v: any, version: string) {
    const v2 = v.renderSchemaVersion === 2;
    modeRecord(v, v2 ? ['versionId', 'renderSchemaVersion', 'config', 'service', 'submissionMode'] : ['versionId', 'config', 'service']);
    need(v.versionId === version);
    catalog(v.service, !v2);
    if (v2) {
        need(v.submissionMode === 'unconfirmed_request');
        const snapshot = { renderSchemaVersion: 2, config: v.config, service: v.service, submissionMode: 'unconfirmed_request' };
        copySessionValue(snapshot, { depth: 9, nodes: 10000, props: 50, array: 50, string: 1000, bytes: 524288, units: 65536 });
        const normalized = normalizeConfigurablePublication(v.service, { authoringVersion: 2, config: v.config, questionOverrides: {} });
        need(sessionCanonical(normalized.snapshot) === sessionCanonical(snapshot));
    }
    else {
        need(bytes(json(v.service), 'utf8') <= 131072 && bytes(json(v.service.questions), 'utf8') <= 126000);
        modeRecord(v.config, ['key', 'steps']);
        text(v.config.key, 1, 200, true);
        need(isArray(v.config.steps) && v.config.steps.length === v.service.questions.length);
        const stepKeys = new Set(), questionKeys = new Set();
        for (const step of v.config.steps) {
            modeRecord(step, ['key', 'questionKey', 'kind', 'required']);
            text(step.key, 1, 200, true);
            need(!stepKeys.has(step.key) && !questionKeys.has(step.questionKey) && step.kind === 'question');
            stepKeys.add(step.key);
            questionKeys.add(step.questionKey);
            const q = v.service.questions.find((q: any) => q.id === step.questionKey);
            need(q && step.required === q.required);
        }
    }
}
export function createModeSessionContracts(rawProfiles: unknown) {
    const registry = copySessionValue({ profiles: rawProfiles }, SESSION_BOUNDS.registry);
    modeRecord(registry, ['profiles']);
    need(isArray(registry.profiles));
    const profiles = new Map<string, InstallationProfile>();
    const publicContracts = createInstallationContracts(registry.profiles);
    for (const raw of registry.profiles) {
        modeRecord(raw, ['profileVersion', 'rendererOrigin', 'apiOrigin', 'portalOrigin', 'loaderUrl']);
        for (const k of ['rendererOrigin', 'apiOrigin', 'portalOrigin'])
            sessionOrigin(raw[k]);
        need(!profiles.has(raw.profileVersion));
        profiles.set(raw.profileVersion, raw);
    }
    void publicContracts;
    function issue(raw: unknown): ModeSessionIssueRequest {
        const r = copySessionValue(raw, SESSION_BOUNDS.issue);
        modeRecord(r, ['installationId', 'deploymentProfileVersion', 'rendererOrigin', 'parentOrigin', 'expectedVersionId', 'expectedTargetRevision', 'expectedPolicyRevision']);
        sessionUuid(r.installationId);
        sessionUuid(r.expectedVersionId);
        integer(r.expectedTargetRevision, 1);
        integer(r.expectedPolicyRevision, 1);
        const p = profiles.get(r.deploymentProfileVersion);
        need(p && r.rendererOrigin === p.rendererOrigin);
        if (r.parentOrigin !== null) {
            sessionOrigin(r.parentOrigin);
            need(![p.rendererOrigin, p.apiOrigin, p.portalOrigin].includes(r.parentOrigin));
        }
        return r;
    }
    function issueReceipt(raw: unknown, r: ModeSessionIssueRequest): ModeSessionIssueReceipt { const v = copySessionValue(raw, SESSION_BOUNDS.issueResult); modeRecord(v, ['schemaVersion', 'sessionId', 'installationId', 'mode', 'deploymentProfileVersion', 'rendererOrigin', 'parentOrigin', 'versionId', 'targetRevision', 'policyRevision', 'issuedAt', 'expiresAt', 'render']); need(v.schemaVersion === 1); sessionUuid(v.sessionId); need(v.installationId === r.installationId && v.deploymentProfileVersion === r.deploymentProfileVersion && v.rendererOrigin === r.rendererOrigin && v.parentOrigin === r.parentOrigin && v.mode === (r.parentOrigin === null ? 'hosted' : 'iframe') && v.versionId === r.expectedVersionId && v.targetRevision === r.expectedTargetRevision && v.policyRevision === r.expectedPolicyRevision); need(sessionMicros(v.expiresAt) - sessionMicros(v.issuedAt) === 900000000n); render(v.render, v.versionId); return v; }
    function submit(raw: unknown, receipt: ModeSessionIssueReceipt) {
        const fields = modeRecord(raw, ['token', 'idempotencyKey', 'answers', 'customer', 'requestedStart']);
        const v2 = receipt.render.renderSchemaVersion === 2;
        const answers = copySessionValue(fields.answers, { depth: 3, nodes: 10000, props: 50, array: 50, string: v2 ? 100 : 200, bytes: 16384, units: 65536 });
        need(answers !== null && typeof answers === 'object' && !isArray(answers));
        for (const [id, a] of Object.entries(answers)) {
            text(id, 1, 100, !v2);
            need(!['__proto__', 'constructor', 'prototype'].includes(id));
            const val = a as any;
            if (Object.prototype.hasOwnProperty.call(val, 'quantity')) {
                modeRecord(val, ['quantity']);
                integer(val.quantity, 0, 10000);
            }
            else {
                modeRecord(val, ['choiceIds']);
                need(isArray(val.choiceIds) && val.choiceIds.length >= 1 && val.choiceIds.length <= 50 && new Set(val.choiceIds).size === val.choiceIds.length);
                for (const c of val.choiceIds)
                    text(c, 1, 100, !v2);
            }
        }
        const customer = copySessionValue(fields.customer, SESSION_BOUNDS.customer);
        modeRecord(customer, ['name', 'email']);
        text(customer.name, 0, 4096);
        text(customer.email, 0, 4096);
        const normalized = freeze({ name: customer.name.replace(/^ +| +$/g, ''), email: customer.email.replace(/^ +| +$/g, '') });
        text(normalized.name, 1, 200);
        text(normalized.email, 3, 254);
        const r = copySessionValue(raw, SESSION_BOUNDS.submit);
        text(r.token, 43, 43);
        text(r.idempotencyKey, 16, 128);
        need(/^[A-Za-z0-9_-]{16,128}$/.test(r.idempotencyKey));
        sessionMicros(r.requestedStart);
        // SQL owns required/hidden/choice membership and semantic answer validation.
        return freeze({ ...r, answers, customer: normalized });
    }
    function submitReceipt(raw: unknown): ModeSessionSubmitReceipt { const v = copySessionValue(raw, SESSION_BOUNDS.submitResult); modeRecord(v, ['schemaVersion', 'reference', 'initialState', 'state', 'requestAccepted', 'replayed']); need(v.schemaVersion === 1 && v.initialState === 'draft' && v.requestAccepted === true && typeof v.replayed === 'boolean' && states.includes(v.state) && typeof v.reference === 'string' && v.reference.length === 36 && /^LMN-[0-9A-F]{32}$/.test(v.reference) && (v.replayed || v.state === 'draft')); return v; }
    function owner(actorRaw: unknown, raw: unknown) {
        const actor = copySessionValue(actorRaw, SESSION_BOUNDS.actor);
        modeRecord(actor, ['mode', 'userId']);
        need(actor.mode === 'local_synthetic');
        sessionUuid(actor.userId);
        const v = copySessionValue(raw, SESSION_BOUNDS.owner);
        modeRecord(v, ['tenantId', 'flowId', 'beforeCreatedAt', 'beforeBookingId', 'limit']);
        sessionUuid(v.tenantId);
        if (v.flowId !== null)
            sessionUuid(v.flowId);
        need((v.beforeCreatedAt === null) === (v.beforeBookingId === null));
        if (v.beforeCreatedAt !== null) {
            sessionMicros(v.beforeCreatedAt);
            sessionUuid(v.beforeBookingId);
        }
        integer(v.limit, 1, 100);
        copySessionValue({ actor, request: v }, SESSION_BOUNDS.owner);
        return freeze({ actor, request: v as ModeSessionHistoryRequest });
    }
    function history(raw: unknown, r: ModeSessionHistoryRequest): ModeSessionHistoryPage {
        const v = copySessionValue(raw, SESSION_BOUNDS.page);
        modeRecord(v, ['schemaVersion', 'requests', 'nextCursor']);
        need(v.schemaVersion === 1 && isArray(v.requests) && v.requests.length <= r.limit);
        const ids = new Set();
        let prior = r.beforeCreatedAt === null ? null : { time: sessionMicros(r.beforeCreatedAt), id: r.beforeBookingId! };
        for (const row of v.requests) {
            modeRecord(row, ['bookingId', 'reference', 'state', 'slotStart', 'createdAt']);
            sessionUuid(row.bookingId);
            text(row.reference, 6, 128);
            need(states.includes(row.state) && !ids.has(row.bookingId));
            ids.add(row.bookingId);
            sessionMicros(row.slotStart);
            const t = sessionMicros(row.createdAt);
            need(!prior || t < prior.time || (t === prior.time && row.bookingId < prior.id));
            prior = { time: t, id: row.bookingId };
        }
        if (v.nextCursor !== null) {
            modeRecord(v.nextCursor, ['createdAt', 'bookingId']);
            need(v.requests.length === r.limit && v.requests.length > 0);
            const last = v.requests[v.requests.length - 1];
            need(v.nextCursor.createdAt === last.createdAt && v.nextCursor.bookingId === last.bookingId);
        }
        return v;
    }
    return freeze({ issue, issueReceipt, submit, submitReceipt, owner, history });
}
export function sessionResult(raw: unknown): unknown { need(modeMetadata(raw, 'command') === 'SELECT' && modeMetadata(raw, 'rowCount') === 1); const rows = modeMetadata(raw, 'rows'); need(isArray(rows) && !proxy(rows) && proto(rows) === Array.prototype && keys(rows).length === 2); const length = desc(rows, 'length'), first = desc(rows, '0'); need(length?.value === 1 && first && 'value' in first && first.enumerable); return modeRecord(first.value, ['result']).result; }
/** Internal copied-RPC tuple boundary, stricter than SQL semantic answer equivalence. */
export function sessionIntent(values: unknown): Readonly<{
    tuple: readonly unknown[];
    hash: string;
}> {
    const tuple = copySessionValue(values, { depth: 1, nodes: 8, props: 0, array: 7, string: 65536, bytes: 65536 });
    need(isArray(tuple) && tuple.length === 7 && tuple.every((v: any, i: number) => typeof v === 'string' || i === 2 && v === null));
    return freeze({ tuple, hash: createHash('sha256').update(sessionCanonical(tuple), 'utf8').digest('hex') });
}
