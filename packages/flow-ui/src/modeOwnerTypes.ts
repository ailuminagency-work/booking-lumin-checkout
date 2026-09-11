import { z } from 'zod';
import { createInstallationContracts, parseInstallationOrigin } from '@lumin/contracts';
export const modeUuid = z.string().length(36).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
function supportedOrigin(value: string) { try {
    if (value.length > 300 || !/^[\x00-\x7f]+$/.test(value) || parseInstallationOrigin(value) !== value)
        return false;
    const host = new URL(value).hostname, labels = host.split('.'), last = labels.at(-1)!;
    return !host.includes(':') && !host.startsWith('[') && labels.every(x => !x.startsWith('xn--')) && /[a-z]/.test(last) && !/^0x[0-9a-f]*$/.test(last);
}
catch {
    return false;
} }
const profileId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]{0,63}$/);
const parents = z.array(z.string().max(300).refine(supportedOrigin)).max(20).refine(v => new Set(v).size === v.length && v.every((x, i) => i === 0 || x > v[i - 1]!) && new TextEncoder().encode(JSON.stringify(v)).length <= 8192);
const common = { schemaVersion: z.literal(1), actorId: modeUuid, flowId: modeUuid };
export const operationReceipt = z.discriminatedUnion('operation', [
    z.object({ ...common, operation: z.literal('publish'), versionId: modeUuid, sourceRevision: revision, renderSchemaVersion: z.union([z.literal(1), z.literal(2)]) }).strict(),
    z.object({ ...common, operation: z.literal('install'), installationId: modeUuid, mode: z.enum(['hosted', 'iframe']), deploymentProfileVersion: profileId, currentVersionId: modeUuid, targetRevision: z.literal(1), policyRevision: z.literal(1), enabled: z.literal(true), allowedParentOrigins: parents, changed: z.literal(true) }).strict(),
    z.object({ ...common, operation: z.literal('apply'), installationId: modeUuid, previousVersionId: modeUuid, currentVersionId: modeUuid, targetRevision: revision, policyRevision: revision, changed: z.boolean() }).strict(),
    z.object({ ...common, operation: z.literal('policy'), installationId: modeUuid, currentVersionId: modeUuid, targetRevision: revision, policyRevision: revision, enabled: z.boolean(), allowedParentOrigins: parents, changed: z.boolean() }).strict()
]).refine(v => v.operation === 'apply' ? (v.changed === (v.previousVersionId !== v.currentVersionId) && (!v.changed || v.targetRevision >= 2)) : v.operation === 'policy' ? (!v.changed || v.policyRevision >= 2) : v.operation === 'install' ? (v.mode === 'hosted' ? v.allowedParentOrigins.length === 0 : v.allowedParentOrigins.length >= 1) : true);
export const installationRow = z.object({ installationId: modeUuid, flowId: modeUuid, mode: z.enum(['hosted', 'iframe']), deploymentProfileVersion: profileId, currentVersionId: modeUuid, targetRevision: revision, policyRevision: revision, enabled: z.boolean(), allowedParentOrigins: parents }).strict().refine(v => v.mode === 'hosted' ? v.allowedParentOrigins.length === 0 : v.allowedParentOrigins.length >= 1);
export const installationPage = z.object({ installations: z.array(installationRow).max(100), nextCursor: modeUuid.nullable() }).strict();
export const installationHistory = z.object({ history: z.array(z.object({ sequence: revision, operation: z.enum(['install', 'apply', 'policy']), currentVersionId: modeUuid, targetRevision: revision, policyRevision: revision, enabled: z.boolean(), allowedParentOrigins: parents }).strict().refine(v => BigInt(v.sequence) === BigInt(v.targetRevision) + BigInt(v.policyRevision) - 1n && (v.operation === 'install' ? (v.sequence === 1 && v.targetRevision === 1 && v.policyRevision === 1 && v.enabled) : (v.sequence > 1 && (v.operation === 'apply' ? v.targetRevision >= 2 : v.policyRevision >= 2))))).max(100), nextCursor: revision.nullable() }).strict();
const micros = z.string().length(27).regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/).refine(v => { const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10), h = +v.slice(11, 13), n = +v.slice(14, 16), s = +v.slice(17, 19); if (y < 1 || m < 1 || m > 12 || d < 1 || h > 23 || n > 59 || s > 59)
    return false; const date = new Date(0); date.setUTCFullYear(y, m - 1, d); date.setUTCHours(h, n, s, 0); return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d; });
export const requestPage = z.object({ schemaVersion: z.literal(1), requests: z.array(z.object({ bookingId: modeUuid, reference: z.string().min(6).max(128), state: z.enum(['draft', 'pending_payment', 'confirmed', 'completed', 'cancelled', 'refunded', 'failed']), slotStart: micros, createdAt: micros }).strict()).max(100), nextCursor: z.object({ createdAt: micros, bookingId: modeUuid }).strict().nullable() }).strict();
export const profileResponse = z.object({ schemaVersion: z.literal(1), profile: z.object({ profileVersion: profileId, rendererOrigin: z.string().url().max(300), apiOrigin: z.string().url().max(300), portalOrigin: z.string().url().max(300), loaderUrl: z.string().url().max(512) }).strict().nullable(), deliveryEnabled: z.literal(false) }).strict().refine(v => { if (!v.profile)
    return true; try {
    createInstallationContracts([v.profile]);
    return [v.profile.rendererOrigin, v.profile.apiOrigin, v.profile.portalOrigin].every(supportedOrigin);
}
catch {
    return false;
} });
export type OperationReceipt = z.infer<typeof operationReceipt>;
export type InstallationRow = z.infer<typeof installationRow>;
export type InstallationPage = z.infer<typeof installationPage>;
export type InstallationHistory = z.infer<typeof installationHistory>;
export type RequestPage = z.infer<typeof requestPage>;
export type ModeProfile = z.infer<typeof profileResponse>['profile'];
export type Mutation = 'publish' | 'install' | 'apply-version' | 'update-policy';
export type OwnerRead = 'installations' | 'installation-history' | 'operation' | 'request-history';
export type OwnerMethod = Mutation | OwnerRead;
export type Scope = {
    tenantId: string;
    flowId: string;
};
export type MutationBodies = {
    publish: Scope & {
        expectedDraftRevision: number;
        idempotencyKey: string;
    };
    install: Scope & {
        versionId: string;
        expectedPublishedVersionId: string;
        mode: 'hosted' | 'iframe';
        deploymentProfileVersion: string;
        allowedParentOrigins: string[];
        idempotencyKey: string;
    };
    'apply-version': Scope & {
        installationId: string;
        expectedTargetRevision: number;
        expectedCurrentVersionId: string;
        newVersionId: string;
        idempotencyKey: string;
    };
    'update-policy': Scope & {
        installationId: string;
        expectedPolicyRevision: number;
        enabled: boolean;
        allowedParentOrigins: string[];
        idempotencyKey: string;
    };
};
export type OwnerBodies = MutationBodies & {
    installations: Scope & {
        afterId: string | null;
        limit: number;
    };
    'installation-history': Scope & {
        installationId: string;
        beforeSequence: number | null;
        limit: number;
    };
    operation: Scope & {
        operation: OperationReceipt['operation'];
        idempotencyKey: string;
    };
    'request-history': {
        tenantId: string;
        flowId: string | null;
        beforeCreatedAt: string | null;
        beforeBookingId: string | null;
        limit: number;
    };
};
export type OwnerData = {
    publish: OperationReceipt;
    install: OperationReceipt;
    'apply-version': OperationReceipt;
    'update-policy': OperationReceipt;
    installations: InstallationPage;
    'installation-history': InstallationHistory;
    operation: OperationReceipt;
    'request-history': RequestPage;
};
export const failureCode = z.enum(['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT', 'UNAVAILABLE', 'NOT_FOUND', 'UNSUPPORTED', 'LIMIT_EXCEEDED', 'INTERNAL_ERROR', 'CONNECTION_FAILED', 'ACQUISITION_TIMEOUT', 'ABORTED', 'DEADLINE', 'CLOSED', 'CLOCK_UNAVAILABLE', 'SERVER_TIMEOUT', 'LOCK_TIMEOUT', 'DEADLOCK']);
export const failed = z.object({ kind: z.literal('failed'), code: failureCode, transaction: z.enum(['not_started', 'no_commit_submitted', 'rolled_back']), backendMayStillRun: z.boolean() }).strict().refine(v => v.backendMayStillRun === (v.transaction === 'no_commit_submitted'));
const reason = z.enum(['ABORTED', 'DEADLINE', 'CLOCK_UNAVAILABLE', 'CLOSED', 'CONNECTION_FAILED']);
export const httpFailure = z.object({ schemaVersion: z.literal(1), phase: z.literal('not_dispatched'), error: z.object({ code: z.enum(['INVALID_HTTP', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'METHOD_NOT_ALLOWED', 'BODY_TOO_LARGE', 'RATE_LIMITED', 'HTTP_DEADLINE', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR']) }).strict() }).strict();
export function outcomeSchema<T extends z.ZodTypeAny>(schema: T, mutation: boolean) { return mutation ? z.union([failed, z.object({ kind: z.literal('committed'), delivery: z.literal('receipt'), receipt: schema }).strict(), z.object({ kind: z.literal('committed'), delivery: z.literal('withheld'), receipt: z.null(), reason }).strict(), z.object({ kind: z.literal('unknown_commit'), code: z.literal('COMMIT_UNCERTAIN'), receipt: z.null(), reconciliation: z.literal('EXPLICIT_OWNER_OPERATION') }).strict()]) : z.union([failed, z.object({ kind: z.literal('completed'), delivery: z.literal('data'), data: schema }).strict(), z.object({ kind: z.literal('completed'), delivery: z.literal('withheld'), data: z.null(), reason }).strict(), z.object({ kind: z.literal('completion_uncertain'), code: z.literal('READ_COMPLETION_UNCERTAIN'), data: z.null(), backendMayStillRun: z.literal(true) }).strict()]); }
export type OwnerResult<T> = {
    kind: 'committed';
    delivery: 'receipt';
    receipt: T;
} | {
    kind: 'completed';
    delivery: 'data';
    data: T;
} | z.infer<typeof failed> | {
    kind: 'committed' | 'completed';
    delivery: 'withheld';
    reason: string;
    receipt?: null;
    data?: null;
} | {
    kind: 'unknown_commit' | 'completion_uncertain';
};
export type OwnerDelivery<T> = {
    phase: 'repository_result';
    outcome: OwnerResult<T>;
} | {
    phase: 'not_dispatched';
    error: {
        code: string;
    };
} | {
    phase: 'delivery_uncertain';
    operationKind: 'mutation' | 'read';
    code: 'OUTCOME_UNAVAILABLE';
};
/** Optional browser-only editor adapter. Publication never calls the legacy publish route. */
export type ModeEditorAdapter = {
    active?(): boolean;
    locked: boolean;
    publish(flowId: string, revision: number): Promise<void>;
    selection(flowId: string, dirty: boolean): void;
    beforeDiscard?(): boolean;
    changed(): Promise<void>;
};
